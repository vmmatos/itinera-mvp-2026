import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes, createHash } from 'crypto';
import type { DataSource } from 'typeorm';
import type { Profile as GoogleProfile } from 'passport-google-oauth20';
import type Redis from 'ioredis';
import { User } from '@/entities/User';
import { config } from '@/config';
import { createLogger, UnauthorizedError, ConflictError, NotFoundError, ValidationError } from '@itinera/shared';
import type { EmailPublisher } from '@/services/EmailPublisher';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const RESET_REQUEST_THROTTLE_TTL = 60; // seconds — one reset email per email address per minute

const logger = createLogger('auth');

const INVALID_RESET_LINK = 'This reset link is invalid or has expired.';

export const SUPPORTED_LANGUAGES = ['en', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const SUPPORTED_THEMES = ['dark', 'light'] as const;
export type SupportedTheme = (typeof SUPPORTED_THEMES)[number];

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  language: string;
  theme: string;
  hasSeenWalkthrough: boolean;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface UserSettingsPatch {
  language?: string;
  theme?: string;
}

export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis?: Redis,
    private readonly emailPublisher?: EmailPublisher,
  ) {}

  async login(email: string, password: string): Promise<AuthResult> {
    const repo = this.dataSource.getRepository(User);
    const user = await repo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedError('Invalid credentials');

    if (!user.passwordHash.startsWith('$2')) {
      throw new UnauthorizedError('Account uses social login. Please sign in with Google.');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid credentials');

    return this.buildResult(user);
  }

  async register(email: string, password: string, name: string): Promise<AuthResult> {
    const repo = this.dataSource.getRepository(User);
    const existing = await repo.findOne({ where: { email } });
    if (existing) throw new ConflictError('Email already in use');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = repo.create({ email, passwordHash, name, role: 'user' });
    await repo.save(user);

    return this.buildResult(user);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({ where: { id } });
  }

  /**
   * Starts the forgot-password flow. Always resolves without throwing and
   * without revealing whether the address maps to an account — callers return
   * the same generic response regardless of outcome.
   *
   * A reset email is sent only when the address belongs to a password account
   * (social-login users have no password to reset) and no other reset was
   * requested for it in the last minute.
   */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      const repo = this.dataSource.getRepository(User);
      const user = await repo.findOne({ where: { email } });
      if (!user || !user.passwordHash.startsWith('$2')) return;

      if (this.redis) {
        const throttleKey = `auth:reset:req:${email}`;
        const fresh = await this.redis.set(throttleKey, '1', 'EX', RESET_REQUEST_THROTTLE_TTL, 'NX');
        if (fresh === null) {
          logger.info('Password reset throttled for address');
          return;
        }
      }

      const rawToken = randomBytes(32).toString('base64url');
      const ttl = config.PASSWORD_RESET_TOKEN_TTL;
      if (this.redis) {
        await this.redis.setex(`auth:reset:${this.hashResetToken(rawToken)}`, ttl, user.id);
      }

      this.emailPublisher?.publishEmail(
        {
          type: 'password-reset',
          to: email,
          data: {
            name: user.name,
            resetUrl: `${config.FRONTEND_URL}/auth/reset-password?token=${rawToken}`,
            expiresInMinutes: Math.round(ttl / 60),
          },
        },
        'notification.email.password-reset',
      );
      logger.info('Password reset email requested');
    } catch (err: unknown) {
      // Never surface internal failures to the caller — the response must be
      // constant whether or not the account exists.
      logger.error('requestPasswordReset failed', { error: String(err) });
    }
  }

  /**
   * Completes the forgot-password flow: consumes a single-use token, sets the
   * new password, revokes every active session, and sends a confirmation
   * email. Throws {@link ValidationError} for any bad/expired/used token
   * without disclosing which.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!this.redis) throw new ValidationError(INVALID_RESET_LINK);

    const userId = await this.redis.getdel(`auth:reset:${this.hashResetToken(token)}`);
    if (!userId) throw new ValidationError(INVALID_RESET_LINK);

    const repo = this.dataSource.getRepository(User);
    const user = await repo.findOne({ where: { id: userId } });
    if (!user) throw new ValidationError(INVALID_RESET_LINK);

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await repo.save(user);

    await this.revokeAllRefreshTokens(userId);

    this.emailPublisher?.publishEmail(
      { type: 'password-changed', to: user.email, data: { name: user.name } },
      'notification.email.password-changed',
    );
    logger.info('Password reset completed');
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async findOrCreateGoogleUser(profile: GoogleProfile): Promise<User> {
    const repo = this.dataSource.getRepository(User);
    const email = profile.emails?.[0]?.value;
    if (!email) throw new UnauthorizedError('Google profile is missing an email address');

    let user = await repo.findOne({ where: { email } });
    if (!user) {
      user = repo.create({
        email,
        name: profile.displayName ?? email,
        passwordHash: `oauth:google:${profile.id}`,
        role: 'user',
      });
      await repo.save(user);
    }
    return user;
  }

  generateToken(user: User): string {
    return jwt.sign(
      { sub: user.id, role: user.role, iss: config.JWT_CONSUMER_KEY, email: user.email, name: user.name },
      config.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY },
    );
  }

  async generateRefreshToken(userId: string): Promise<string> {
    const token = randomUUID();
    if (this.redis) {
      await this.redis.setex(`auth:refresh:${token}`, REFRESH_TOKEN_TTL, userId);
      // Index the token under its owner so a password reset can revoke every
      // active session in one step (see revokeAllRefreshTokens).
      await this.redis.sadd(`auth:refresh:uid:${userId}`, token);
      await this.redis.expire(`auth:refresh:uid:${userId}`, REFRESH_TOKEN_TTL);
    }
    return token;
  }

  async rotateRefreshToken(
    oldToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser } | null> {
    if (!this.redis) return null;
    const userId = await this.redis.getdel(`auth:refresh:${oldToken}`);
    if (!userId) return null;
    await this.redis.srem(`auth:refresh:uid:${userId}`, oldToken);

    const userRepo = this.dataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    const accessToken = this.generateToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);
    return { accessToken, refreshToken, user: this.toPublicUser(user) };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    if (!this.redis) return;
    const userId = await this.redis.getdel(`auth:refresh:${token}`);
    if (userId) await this.redis.srem(`auth:refresh:uid:${userId}`, token);
  }

  /** Revokes every active refresh token for a user (called on password reset). */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    if (!this.redis) return;
    const tokens = await this.redis.smembers(`auth:refresh:uid:${userId}`);
    const pipeline = this.redis.pipeline();
    for (const token of tokens) pipeline.del(`auth:refresh:${token}`);
    pipeline.del(`auth:refresh:uid:${userId}`);
    await pipeline.exec();
  }

  async getMe(userId: string): Promise<PublicUser> {
    const repo = this.dataSource.getRepository(User);
    const user = await repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');
    return this.toPublicUser(user);
  }

  async updateSettings(userId: string, patch: UserSettingsPatch): Promise<PublicUser> {
    if (patch.language === undefined && patch.theme === undefined) {
      throw new ValidationError('No settings provided');
    }
    if (
      patch.language !== undefined &&
      !SUPPORTED_LANGUAGES.includes(patch.language as SupportedLanguage)
    ) {
      throw new ValidationError(`Unsupported language: ${patch.language}`);
    }
    if (patch.theme !== undefined && !SUPPORTED_THEMES.includes(patch.theme as SupportedTheme)) {
      throw new ValidationError(`Unsupported theme: ${patch.theme}`);
    }

    const repo = this.dataSource.getRepository(User);
    const user = await repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    if (patch.language !== undefined) user.language = patch.language;
    if (patch.theme !== undefined) user.theme = patch.theme;
    await repo.save(user);

    return this.toPublicUser(user);
  }

  async completeWalkthrough(userId: string): Promise<PublicUser> {
    const repo = this.dataSource.getRepository(User);
    const user = await repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    user.hasSeenWalkthrough = true;
    await repo.save(user);

    return this.toPublicUser(user);
  }

  private buildResult(user: User): AuthResult {
    return {
      token: this.generateToken(user),
      user: this.toPublicUser(user),
    };
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      language: user.language,
      theme: user.theme,
      hasSeenWalkthrough: user.hasSeenWalkthrough,
    };
  }
}
