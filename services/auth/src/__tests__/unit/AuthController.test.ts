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
    authService = { updateLanguage: vi.fn() };
    controller = new AuthController(authService as AuthService);
    res = { json: jsonMock, status: vi.fn().mockReturnThis() } as unknown as Response;
    next = vi.fn() as unknown as NextFunction;
  });

  const buildReq = (body: unknown, userId = 'user-uuid-1'): Request =>
    ({ body, user: { sub: userId, role: 'user' } } as unknown as Request);

  describe('updateLanguage()', () => {
    it('calls authService.updateLanguage with the authenticated user id and responds with the result', async () => {
      const updated = { id: 'user-uuid-1', email: 'a@b.com', name: 'Alice', role: 'user', language: 'pt' };
      vi.mocked(authService.updateLanguage!).mockResolvedValue(updated);

      await controller.updateLanguage(buildReq({ language: 'pt' }), res, next);

      expect(authService.updateLanguage).toHaveBeenCalledWith('user-uuid-1', 'pt');
      expect(jsonMock).toHaveBeenCalledWith({ success: true, data: updated });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an unsupported language without calling the service', async () => {
      await controller.updateLanguage(buildReq({ language: 'fr' }), res, next);

      expect(authService.updateLanguage).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(jsonMock).not.toHaveBeenCalled();
    });

    it('rejects a missing language field without calling the service', async () => {
      await controller.updateLanguage(buildReq({}), res, next);

      expect(authService.updateLanguage).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('forwards service errors to next', async () => {
      vi.mocked(authService.updateLanguage!).mockRejectedValue(new NotFoundError('User not found'));

      await controller.updateLanguage(buildReq({ language: 'pt' }), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
      expect(jsonMock).not.toHaveBeenCalled();
    });
  });
});
