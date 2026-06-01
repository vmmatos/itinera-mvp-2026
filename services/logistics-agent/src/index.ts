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
import { WeatherService } from '@/services/WeatherService';
import { PlacesService } from '@/services/PlacesService';
import { AttractionDB } from '@/services/AttractionDB';
import { TimingValidator } from '@/validators/TimingValidator';
import { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import { createHealthRouter } from '@/routes/health';
import { createLogisticsRouter } from '@/routes/logistics';

const logger = createLogger('logistics-agent');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

async function start(): Promise<void> {
  await AppDataSource.initialize();

  const anthropic = new AnthropicService();
  const publisher = new RabbitMQPublisher();
  const redis = new RedisService();
  const storage = new ProposalStorageService();

  await publisher.connect();
  await redis.connect();

  const weather = new WeatherService();
  const places = new PlacesService();
  const attractions = new AttractionDB(places, redis, config.ATTRACTIONS_CACHE_TTL_SECONDS);
  const timing = new TimingValidator();
  const analyzer = new WeatherAnalyzer(anthropic, publisher, redis, storage);

  app.use(createHealthRouter(publisher, redis));
  app.use(authMiddleware);
  app.use(createLogisticsRouter(weather, attractions, timing, analyzer, redis));
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Logistics agent started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down logistics agent');
    await AppDataSource.destroy();
    await publisher.close();
    await redis.close();
    server.close(() => {
      logger.info('Logistics agent stopped');
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
        logger.error('Failed to start logistics agent, giving up', { error: String(err) });
        process.exit(1);
      }
      logger.warn('Failed to start logistics agent, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
