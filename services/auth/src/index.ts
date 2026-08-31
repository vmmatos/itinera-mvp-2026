import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { requestLogger, createLogger } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { config, getRabbitMQUrl } from '@/config';
import { AuthService } from '@/services/AuthService';
import { EmailPublisher } from '@/services/EmailPublisher';
import { registerRoutes } from '@/routes';

const logger = createLogger('auth');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(passport.initialize());

async function start(): Promise<void> {
  const redis = new Redis({ host: config.REDIS_HOST, port: config.REDIS_PORT, lazyConnect: true });
  await redis.connect();
  logger.info('Redis connected');

  await AppDataSource.initialize();
  logger.info('Database connected');

  // Best-effort — auth must keep serving logins even if RabbitMQ is down, so
  // the connection is established off the boot critical path.
  const emailPublisher = new EmailPublisher(getRabbitMQUrl());
  void emailPublisher
    .connect()
    .catch((err: unknown) =>
      logger.warn('EmailPublisher initial connect failed — will retry in background', {
        error: String(err),
      }),
    );

  const authService = new AuthService(AppDataSource, redis, emailPublisher);
  registerRoutes(app, authService, redis);

  const server = app.listen(config.PORT, () => {
    logger.info('Auth service started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down auth service');
    await emailPublisher.close();
    await AppDataSource.destroy();
    redis.disconnect();
    server.close(() => {
      logger.info('Auth service stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

async function startWithRetry(): Promise<void> {
  const RETRY_DELAY_MS = 5000;
  for (let attempt = 1; ; attempt++) {
    try {
      await start();
      return;
    } catch (err: unknown) {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy().catch(() => {});
      }
      logger.warn('Failed to start auth service, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
