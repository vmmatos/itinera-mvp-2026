import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@itinera/shared';

vi.mock('@/config', () => ({
  config: {
    JWT_SECRET: 'test-secret-at-least-32-chars-long!!',
    JWT_CONSUMER_KEY: 'itinera',
  },
}));

import { AuthController } from '@/controllers/AuthController';
import type { AuthService } from '@/services/AuthService';

describe('AuthController', () => {
  let authService: Partial<AuthService>;
  let controller: AuthController;
  let res: Response;
  let next: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    authService = { getMe: vi.fn(), updateSettings: vi.fn(), completeWalkthrough: vi.fn() };
    controller = new AuthController(authService as AuthService);
    res = { json: jsonMock, status: vi.fn().mockReturnThis() } as unknown as Response;
    next = vi.fn() as unknown as NextFunction;
  });

  const buildReq = (body: unknown, userId = 'user-uuid-1'): Request =>
    ({ body, user: { sub: userId, role: 'user' } } as unknown as Request);

  const publicUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'user-uuid-1', email: 'a@b.com', name: 'Alice', role: 'user',
    language: 'en', theme: 'dark', hasSeenWalkthrough: false, ...overrides,
  });

  describe('getMe()', () => {
    it('responds with the public user for the authenticated user id', async () => {
      const me = publicUser({ language: 'pt', theme: 'light' });
      vi.mocked(authService.getMe!).mockResolvedValue(me as never);

      await controller.getMe(buildReq(undefined), res, next);

      expect(authService.getMe).toHaveBeenCalledWith('user-uuid-1');
      expect(jsonMock).toHaveBeenCalledWith({ success: true, data: me });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      vi.mocked(authService.getMe!).mockRejectedValue(new NotFoundError('User not found'));

      await controller.getMe(buildReq(undefined), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
      expect(jsonMock).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings()', () => {
    it('calls authService.updateSettings with the authenticated user id and the parsed patch', async () => {
      const updated = publicUser({ language: 'pt' });
      vi.mocked(authService.updateSettings!).mockResolvedValue(updated as never);

      await controller.updateSettings(buildReq({ language: 'pt' }), res, next);

      expect(authService.updateSettings).toHaveBeenCalledWith('user-uuid-1', { language: 'pt' });
      expect(jsonMock).toHaveBeenCalledWith({ success: true, data: updated });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes a theme-only patch through', async () => {
      vi.mocked(authService.updateSettings!).mockResolvedValue(publicUser({ theme: 'light' }) as never);

      await controller.updateSettings(buildReq({ theme: 'light' }), res, next);

      expect(authService.updateSettings).toHaveBeenCalledWith('user-uuid-1', { theme: 'light' });
    });

    it('rejects an unsupported language without calling the service', async () => {
      await controller.updateSettings(buildReq({ language: 'fr' }), res, next);

      expect(authService.updateSettings).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(jsonMock).not.toHaveBeenCalled();
    });

    it('rejects an unsupported theme without calling the service', async () => {
      await controller.updateSettings(buildReq({ theme: 'sepia' }), res, next);

      expect(authService.updateSettings).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('rejects an empty body without calling the service', async () => {
      await controller.updateSettings(buildReq({}), res, next);

      expect(authService.updateSettings).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('forwards service errors to next', async () => {
      vi.mocked(authService.updateSettings!).mockRejectedValue(new NotFoundError('User not found'));

      await controller.updateSettings(buildReq({ language: 'pt' }), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
      expect(jsonMock).not.toHaveBeenCalled();
    });
  });

  describe('completeWalkthrough()', () => {
    it('calls authService.completeWalkthrough with the authenticated user id and responds with the result', async () => {
      const updated = publicUser({ hasSeenWalkthrough: true });
      vi.mocked(authService.completeWalkthrough!).mockResolvedValue(updated as never);

      await controller.completeWalkthrough(buildReq({}), res, next);

      expect(authService.completeWalkthrough).toHaveBeenCalledWith('user-uuid-1');
      expect(jsonMock).toHaveBeenCalledWith({ success: true, data: updated });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards service errors to next', async () => {
      vi.mocked(authService.completeWalkthrough!).mockRejectedValue(new NotFoundError('User not found'));

      await controller.completeWalkthrough(buildReq({}), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
      expect(jsonMock).not.toHaveBeenCalled();
    });
  });
});
