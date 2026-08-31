import { Router } from 'express';
import { randomUUID } from 'crypto';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { z } from 'zod';
import Redis from 'ioredis';
import { authMiddleware } from '@itinera/shared';
import { config } from '@/config';
import { AuthController } from '@/controllers/AuthController';
import type { AuthService } from '@/services/AuthService';
import type { User } from '@/entities/User';

const EXCHANGE_CODE_TTL = 60; // seconds — one-time, short-lived

export function createAuthRouter(authService: AuthService, redis: Redis): Router {
  const router = Router();
  const controller = new AuthController(authService);

  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          callbackURL: config.GOOGLE_CALLBACK_URL,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await authService.findOrCreateGoogleUser(profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        },
      ),
    );
  }

  router.post('/login', controller.login);
  router.post('/register', controller.register);
  router.post('/forgot-password', controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);
  router.get('/me', authMiddleware, controller.getMe);
  router.patch('/me', authMiddleware, controller.updateSettings);
  router.patch('/me/walkthrough', authMiddleware, controller.completeWalkthrough);

  router.get(
    '/oauth2/google',
    (req, res, next) => {
      if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
        res.status(501).json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Google OAuth2 is not configured' } });
        return;
      }
      next();
    },
    passport.authenticate('google', { scope: ['profile', 'email'], session: false }),
  );

  router.get(
    '/oauth2/google/callback',
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${config.FRONTEND_URL}/auth/login?error=oauth_failed`,
    }),
    async (req, res) => {
      const user = req.user as User;
      const token = authService.generateToken(user);
      const refreshToken = await authService.generateRefreshToken(user.id);
      const code = randomUUID();
      // Store { access, refresh, userId } keyed by exchange code — userId lets
      // /exchange hydrate the full public user (JWT claims omit language/theme/flags).
      await redis.setex(
        `auth:exchange:${code}`,
        EXCHANGE_CODE_TTL,
        JSON.stringify({ token, refreshToken, userId: user.id }),
      );
      res.redirect(`${config.FRONTEND_URL}/auth/callback?code=${encodeURIComponent(code)}`);
    },
  );

  // Exchange one-time code for access + refresh tokens
  router.post('/exchange', async (req, res, next) => {
    try {
      const { code } = z.object({ code: z.string().uuid() }).parse(req.body);
      const raw = await redis.getdel(`auth:exchange:${code}`);
      if (!raw) {
        res.status(401).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid or expired exchange code' } });
        return;
      }
      const { token, refreshToken, userId } = JSON.parse(raw) as {
        token: string;
        refreshToken: string;
        userId: string;
      };
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });
      const user = await authService.getMe(userId);
      res.json({ success: true, data: { token, user } });
    } catch (err) {
      next(err);
    }
  });

  // Refresh access token using httpOnly cookie
  router.post('/refresh', async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
      if (!refreshToken) {
        res.status(401).json({ success: false, error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } });
        return;
      }
      const result = await authService.rotateRefreshToken(refreshToken);
      if (!result) {
        res.clearCookie('refresh_token', { path: '/api/auth' });
        res.status(401).json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token expired or invalid' } });
        return;
      }
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth',
      });
      res.json({ success: true, data: { token: result.accessToken, user: result.user } });
    } catch (err) {
      next(err);
    }
  });

  // Logout — revoke refresh token cookie
  router.post('/logout', async (req, res, next) => {
    try {
      const refreshToken = req.cookies?.['refresh_token'] as string | undefined;
      if (refreshToken) await authService.revokeRefreshToken(refreshToken);
      res.clearCookie('refresh_token', { path: '/api/auth' });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
