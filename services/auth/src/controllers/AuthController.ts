import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '@itinera/shared';
import { ValidationError } from '@itinera/shared';
import type { AuthenticatedRequest } from '@itinera/shared';
import type { AuthService } from '@/services/AuthService';
import { SUPPORTED_LANGUAGES, SUPPORTED_THEMES } from '@/services/AuthService';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1),
});

const UpdateSettingsSchema = z
  .object({
    language: z.enum(SUPPORTED_LANGUAGES).optional(),
    theme: z.enum(SUPPORTED_THEMES).optional(),
  })
  .refine((v) => v.language !== undefined || v.theme !== undefined, {
    message: 'At least one of language or theme is required',
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

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const result = await this.authService.getMe(userId);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  };

  updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = UpdateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request'));
      return;
    }
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const result = await this.authService.updateSettings(userId, parsed.data);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  };

  completeWalkthrough = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const result = await this.authService.completeWalkthrough(userId);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  };
}
