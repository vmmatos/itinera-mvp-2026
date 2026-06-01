import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from '@/config';
import { AuthController } from '@/controllers/AuthController';
import type { AuthService } from '@/services/AuthService';
import type { User } from '@/entities/User';

export function createAuthRouter(authService: AuthService): Router {
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
    (req, res) => {
      const user = req.user as User;
      const token = authService.generateToken(user);
      res.redirect(`${config.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`);
    },
  );

  return router;
}
