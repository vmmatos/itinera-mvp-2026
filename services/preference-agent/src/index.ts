import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import { requestLogger, errorHandler, authMiddleware, createLogger } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { AliceAgent } from '@/agents/AliceAgent';
import { BobAgent } from '@/agents/BobAgent';
import { CarlosAgent } from '@/agents/CarlosAgent';
import { DianaAgent } from '@/agents/DianaAgent';
import { createHealthRouter } from '@/routes/health';
import { createPreferencesRouter } from '@/routes/preferences';

const logger = createLogger('preference-agent');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

async function start(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('Database connected');

  const anthropic = new AnthropicService();
  const publisher = new RabbitMQPublisher();
  const redis = new RedisService();
  const storage = new ProposalStorageService();

  await publisher.connect();
  await redis.connect();

  const agents = {
    alice: new AliceAgent(anthropic, publisher, redis, storage),
    bob: new BobAgent(anthropic, publisher, redis, storage),
    carlos: new CarlosAgent(anthropic, publisher, redis, storage),
    diana: new DianaAgent(anthropic, publisher, redis, storage),
  };

  app.locals['logger'] = logger;

  app.use(createHealthRouter(publisher, redis));
  app.use(authMiddleware);
  app.use(createPreferencesRouter(agents));
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Preference agent started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down preference agent');
    await AppDataSource.destroy();
    await publisher.close();
    await redis.close();
    server.close(() => {
      logger.info('Preference agent stopped');
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
        logger.error('Failed to start preference agent, giving up', { error: String(err) });
        process.exit(1);
      }
      logger.warn('Failed to start preference agent, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
