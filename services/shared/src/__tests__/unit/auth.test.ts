import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SECRET = 'test-secret-min-32-chars-xxxxxxxxx';

const makeReq = (authHeader?: string): Request =>
  ({ headers: { authorization: authHeader } } as unknown as Request);

const makeRes = (): Response => ({} as unknown as Response);

const makeNext = (): NextFunction => vi.fn() as unknown as NextFunction;

vi.stubEnv('JWT_SECRET', SECRET);

import { authMiddleware, requireRole } from '../../middleware/auth';

describe('authMiddleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('JWT_SECRET', SECRET);
  });

  it('happy path: valid token populates req.user and calls next()', () => {
    const payload = { sub: 'user-1', role: 'user' as const, iss: 'itinera', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
    const token = jwt.sign(payload, SECRET);
    const req = makeReq(`Bearer ${token}`);
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect((req as unknown as Record<string, unknown>)['user']).toMatchObject({ sub: 'user-1', role: 'user' });
  });

  it('missing Authorization header → next(UnauthorizedError)', () => {
    const req = makeReq(undefined);
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' }),
    );
  });

  it('malformed Bearer prefix → next(UnauthorizedError)', () => {
    const req = makeReq('Basic sometoken');
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it('expired token → next(UnauthorizedError)', () => {
    const token = jwt.sign({ sub: 'u', role: 'user', iss: 'itinera' }, SECRET, { expiresIn: -1 });
    const req = makeReq(`Bearer ${token}`);
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it('wrong issuer → next(UnauthorizedError)', () => {
    vi.stubEnv('JWT_ISSUER', 'expected-issuer');
    const token = jwt.sign({ sub: 'u', role: 'user', iss: 'wrong-issuer' }, SECRET);
    const req = makeReq(`Bearer ${token}`);
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it('token signed with wrong secret → next(UnauthorizedError)', () => {
    const token = jwt.sign({ sub: 'u', role: 'user' }, 'wrong-secret');
    const req = makeReq(`Bearer ${token}`);
    const next = makeNext();

    authMiddleware(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});

describe('requireRole', () => {
  it('correct role calls next() with no args', () => {
    const payload = { sub: 'admin-1', role: 'admin' as const, iss: 'itinera', exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = jwt.sign(payload, SECRET);
    const req = makeReq(`Bearer ${token}`);
    authMiddleware(req, makeRes(), vi.fn());

    const next = makeNext();
    requireRole('admin')(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it('wrong role → next(ForbiddenError)', () => {
    const payload = { sub: 'user-1', role: 'user' as const, iss: 'itinera', exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = jwt.sign(payload, SECRET);
    const req = makeReq(`Bearer ${token}`);
    authMiddleware(req, makeRes(), vi.fn());

    const next = makeNext();
    requireRole('admin')(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }),
    );
  });

  it('unauthenticated request → next(UnauthorizedError)', () => {
    const req = makeReq(undefined);
    const next = makeNext();

    requireRole('admin')(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});
