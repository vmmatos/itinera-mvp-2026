import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '@itinera/shared';
import { ValidationError } from '@itinera/shared';
import type { AuthService } from '@/services/AuthService';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1),
});

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request'));
      return;
    }
    try {
      const result = await this.authService.login(parsed.data.email, parsed.data.password);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  };

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request'));
      return;
    }
    try {
      const result = await this.authService.register(
        parsed.data.email,
        parsed.data.password,
        parsed.data.name,
      );
      res.status(201).json(ok(result));
    } catch (err) {
      next(err);
    }
  };
}
