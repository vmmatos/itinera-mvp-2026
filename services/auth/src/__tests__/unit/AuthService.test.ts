import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { AuthService } from '@/services/AuthService';
import { UnauthorizedError, ConflictError, NotFoundError, ValidationError } from '@itinera/shared';
import type { User } from '@/entities/User';

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mocked.jwt.token'),
  },
}));

vi.mock('@/config', () => ({
  config: {
    JWT_SECRET: 'test-secret-at-least-32-chars-long!!',
    JWT_CONSUMER_KEY: 'itinera',
  },
}));

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const buildUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-uuid-1',
    email: 'alice@example.com',
    name: 'Alice',
    passwordHash: '$2b$12$validbcrypthashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    role: 'user',
    language: 'en',
    hasSeenWalkthrough: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User);

describe('AuthService', () => {
  let authService: AuthService;
  let mockFindOne: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockSave: ReturnType<typeof vi.fn>;
  let mockRepo: Partial<Repository<User>>;
  let mockDataSource: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFindOne = vi.fn();
    mockCreate = vi.fn();
    mockSave = vi.fn();

    mockRepo = { findOne: mockFindOne, create: mockCreate, save: mockSave };
    mockDataSource = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
    } as unknown as DataSource;

    authService = new AuthService(mockDataSource);
  });

  describe('login()', () => {
    it('returns token and user when credentials are valid', async () => {
      const user = buildUser();
      mockFindOne.mockResolvedValue(user);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await authService.login('alice@example.com', 'correct-password');

      expect(result.token).toBe('mocked.jwt.token');
      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language: user.language,
        hasSeenWalkthrough: user.hasSeenWalkthrough,
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', user.passwordHash);
    });

    it('throws UnauthorizedError when user is not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(authService.login('unknown@example.com', 'password')).rejects.toThrow(
        UnauthorizedError,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when password is incorrect', async () => {
      mockFindOne.mockResolvedValue(buildUser());
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(authService.login('alice@example.com', 'wrong-password')).rejects.toThrow(
        UnauthorizedError,
      );
    });

    it('throws UnauthorizedError when account uses social login', async () => {
      const oauthUser = buildUser({ passwordHash: 'oauth:google:123456' });
      mockFindOne.mockResolvedValue(oauthUser);

      await expect(authService.login('alice@example.com', 'any-password')).rejects.toThrow(
        UnauthorizedError,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('register()', () => {
    it('creates user and returns token when email is new', async () => {
      const newUser = buildUser({ id: 'new-user-id', email: 'bob@example.com', name: 'Bob' });
      mockFindOne.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('$2b$12$hashed' as never);
      mockCreate.mockReturnValue(newUser);
      mockSave.mockResolvedValue(newUser);

      const result = await authService.register('bob@example.com', 'secure-pass', 'Bob');

      expect(result.token).toBe('mocked.jwt.token');
      expect(result.user.email).toBe('bob@example.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('secure-pass', 12);
      expect(mockSave).toHaveBeenCalled();
    });

    it('throws ConflictError when email is already in use', async () => {
      mockFindOne.mockResolvedValue(buildUser());

      await expect(authService.register('alice@example.com', 'pass', 'Alice')).rejects.toThrow(
        ConflictError,
      );
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe('updateLanguage()', () => {
    it('persists and returns the new language when valid', async () => {
      const user = buildUser({ language: 'en' });
      mockFindOne.mockResolvedValue(user);
      mockSave.mockResolvedValue({ ...user, language: 'pt' });

      const result = await authService.updateLanguage(user.id, 'pt');

      expect(result).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language: 'pt',
        hasSeenWalkthrough: user.hasSeenWalkthrough,
      });
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ language: 'pt' }));
    });

    it('throws ValidationError when the language is not supported', async () => {
      await expect(authService.updateLanguage('user-uuid-1', 'fr')).rejects.toThrow(ValidationError);
      expect(mockFindOne).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the user does not exist', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(authService.updateLanguage('unknown-id', 'pt')).rejects.toThrow(NotFoundError);
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe('completeWalkthrough()', () => {
    it('persists and returns hasSeenWalkthrough=true when the user exists', async () => {
      const user = buildUser({ hasSeenWalkthrough: false });
      mockFindOne.mockResolvedValue(user);
      mockSave.mockResolvedValue({ ...user, hasSeenWalkthrough: true });

      const result = await authService.completeWalkthrough(user.id);

      expect(result).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language: user.language,
        hasSeenWalkthrough: true,
      });
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ hasSeenWalkthrough: true }));
    });

    it('throws NotFoundError when the user does not exist', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(authService.completeWalkthrough('unknown-id')).rejects.toThrow(NotFoundError);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('is idempotent — calling it again on an already-completed user does not throw', async () => {
      const user = buildUser({ hasSeenWalkthrough: true });
      mockFindOne.mockResolvedValue(user);
      mockSave.mockResolvedValue(user);

      const result = await authService.completeWalkthrough(user.id);

      expect(result.hasSeenWalkthrough).toBe(true);
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateToken()', () => {
    it('signs JWT with correct claims and returns token', () => {
      const user = buildUser();

      const token = authService.generateToken(user);

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: user.id, role: user.role, iss: 'itinera', email: user.email, name: user.name },
        'test-secret-at-least-32-chars-long!!',
        { expiresIn: '15m' },
      );
      expect(token).toBe('mocked.jwt.token');
    });
  });
});
