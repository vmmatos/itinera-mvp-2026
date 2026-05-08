import type { Request } from 'express';
import type { UserRole } from './entities';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  iss: string;
  exp: number;
  iat?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
