import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from '../../errors';
import { errorHandler } from '../../middleware/errorHandler';

const makeRes = (): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } & Response => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } & Response;
};

const req = {} as Request;
const next = vi.fn() as unknown as NextFunction;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('errorHandler — AppError subclasses', () => {
  it.each([
    ['NotFoundError', new NotFoundError('Trip'), 404, 'NOT_FOUND'],
    ['ValidationError', new ValidationError('bad input'), 400, 'VALIDATION_ERROR'],
    ['UnauthorizedError', new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    ['ForbiddenError', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['ConflictError', new ConflictError('already exists'), 409, 'CONFLICT'],
  ])('%s → correct status and code', (_name, error, expectedStatus, expectedCode) => {
    const res = makeRes();
    errorHandler(error, req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: expectedCode }),
      }),
    );
  });
});

describe('errorHandler — non-operational AppError', () => {
  it('isOperational=false falls through to 500 handler', () => {
    const err = new AppError(500, 'FATAL', 'something broke', false);
    const res = makeRes();
    vi.stubEnv('NODE_ENV', 'production');

    errorHandler(err, req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      }),
    );
  });
});

describe('errorHandler — generic Error', () => {
  it('development: exposes error message', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const err = new Error('db connection failed');
    const res = makeRes();

    errorHandler(err, req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.message).toBe('db connection failed');
  });

  it('production: hides error message behind generic string', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const err = new Error('db connection failed');
    const res = makeRes();

    errorHandler(err, req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.message).toBe('Internal server error');
  });

  it('non-Error thrown value handled as 500', () => {
    const res = makeRes();
    errorHandler('string error', req, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
