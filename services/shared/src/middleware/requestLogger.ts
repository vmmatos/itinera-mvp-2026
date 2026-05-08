import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '@/logger';

const logger = createLogger('http');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, url } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, 'request', {
      method,
      url,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}
