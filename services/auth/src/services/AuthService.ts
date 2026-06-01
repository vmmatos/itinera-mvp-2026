import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { DataSource } from 'typeorm';
import type { Profile as GoogleProfile } from 'passport-google-oauth20';
import { User } from '@/entities/User';
import { config } from '@/config';
import { UnauthorizedError, ConflictError } from '@itinera/shared';

const BCRYPT_ROUNDS = 12;

export interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string; role: string };
}

export class AuthService {
  constructor(private readonly dataSource: DataSource) {}

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
      { expiresIn: '8h' },
    );
  }

  private buildResult(user: User): AuthResult {
    return {
      token: this.generateToken(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
