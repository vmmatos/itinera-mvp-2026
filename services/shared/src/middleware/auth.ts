import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload, AuthenticatedRequest } from '../types/auth';
import type { UserRole } from '../types/entities';
import { UnauthorizedError, ForbiddenError } from '../errors';

function getSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET env var is not set');
  return secret;
}

function getIssuer(): string | undefined {
  return process.env['JWT_ISSUER'];
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = authHeader.slice(7);
  try {
    const issuer = getIssuer();
    const options = issuer ? { issuer } : {};
    const payload = jwt.verify(token, getSecret(), options) as JwtPayload;
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

export function requireRole(role: UserRole): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authedReq = req as AuthenticatedRequest;
    if (!authedReq.user) {
      next(new UnauthorizedError());
      return;
    }
    
    if (authedReq.user.role !== role) {
      next(new ForbiddenError(`Role '${role}' required`));
      return;
    }
    next();
  };
}
