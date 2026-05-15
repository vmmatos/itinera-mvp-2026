import 'reflect-metadata';
import express from 'express';
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

app.use(requestLogger);
app.use(express.json());

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

start().catch((err: unknown) => {
  logger.error('Failed to start logistics agent', { error: String(err) });
  process.exit(1);
});
