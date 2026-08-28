import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import type { Profile as GoogleProfile } from 'passport-google-oauth20';
import type Redis from 'ioredis';
import { User } from '@/entities/User';
import { config } from '@/config';
import { UnauthorizedError, ConflictError, NotFoundError, ValidationError } from '@itinera/shared';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

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
    }
    return token;
  }

  async rotateRefreshToken(
    oldToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: PublicUser } | null> {
    if (!this.redis) return null;
    const userId = await this.redis.getdel(`auth:refresh:${oldToken}`);
    if (!userId) return null;

    const userRepo = this.dataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    const accessToken = this.generateToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);
    return { accessToken, refreshToken, user: this.toPublicUser(user) };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(`auth:refresh:${token}`);
    }
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
