import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@/errors';
import { createLogger } from '@/logger';

const logger = createLogger('error-handler');

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Unhandled error', { message, stack });

  const responseMessage =
    process.env['NODE_ENV'] === 'development' ? message : 'Internal server error';

  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: responseMessage },
  });
}
