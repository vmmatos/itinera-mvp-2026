import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import passport from 'passport';
import { requestLogger, createLogger } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { AuthService } from '@/services/AuthService';
import { registerRoutes } from '@/routes';

const logger = createLogger('auth');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use(passport.initialize());

async function start(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('Database connected');

  const authService = new AuthService(AppDataSource);
  registerRoutes(app, authService);

  const server = app.listen(config.PORT, () => {
    logger.info('Auth service started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down auth service');
    await AppDataSource.destroy();
    server.close(() => {
      logger.info('Auth service stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

async function startWithRetry(): Promise<void> {
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 3000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await start();
      return;
    } catch (err: unknown) {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy().catch(() => {});
      }
      if (attempt === MAX_ATTEMPTS) {
        logger.error('Failed to start auth service, giving up', { error: String(err) });
        process.exit(1);
      }
      logger.warn('Failed to start auth service, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
