import express from 'express';
import helmet from 'helmet';
import { requestLogger, errorHandler, authMiddleware, createLogger, PREFERENCE_AGENT_CONFIGS } from '@itinera/shared';
import { config } from '@/config';
import { AnthropicService } from '@/services/AnthropicService';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { RedisService } from '@/services/RedisService';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { PreferenceAgent } from '@/agents/PreferenceAgent';
import { createHealthRouter } from '@/routes/health';
import { createPreferencesRouter } from '@/routes/preferences';

const logger = createLogger('preference-agent');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

async function start(): Promise<void> {
  const aiProvider = new AnthropicService();
  const publisher = new RabbitMQPublisher();
  const redis = new RedisService();
  const storage = new ProposalStorageService();

  await publisher.connect();
  await redis.connect();

  const agents = Object.fromEntries(
    PREFERENCE_AGENT_CONFIGS.map((cfg) => [
      cfg.name,
      new PreferenceAgent(cfg.name, aiProvider, publisher, redis, storage),
    ]),
  ) as Record<string, PreferenceAgent>;

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
  const RETRY_DELAY_MS = 5000;
  for (let attempt = 1; ; attempt++) {
    try {
      await start();
      return;
    } catch (err: unknown) {
      logger.warn('Failed to start preference agent, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
