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
import { MapService } from '@/services/MapService';
import { TransportService } from '@/services/TransportService';
import { HotelPriceService } from '@/services/HotelPriceService';
import { AttractionPriceRepository } from '@/services/AttractionPriceRepository';
import { PricingEnricher } from '@/services/PricingEnricher';
import { TimingValidator } from '@/validators/TimingValidator';
import { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import { HolidayService } from '@/services/HolidayService';
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
  const mapService = new MapService();
  const transport = new TransportService(mapService, redis, places);
  const timing = new TimingValidator();
  const analyzer = new WeatherAnalyzer(anthropic, publisher, redis, storage);
  const holidays = new HolidayService(redis);
  const restrictions = new RestrictionsValidator();
  const hotelPrices = new HotelPriceService();
  const attractionPrices = new AttractionPriceRepository();
  const pricingEnricher = new PricingEnricher(hotelPrices, places, attractionPrices);

  app.use(createHealthRouter(publisher, redis));
  app.use(authMiddleware);
  app.use(createLogisticsRouter(weather, attractions, timing, analyzer, redis, holidays, restrictions, transport, pricingEnricher));
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
  const RETRY_DELAY_MS = 5000;
  for (let attempt = 1; ; attempt++) {
    try {
      await start();
      return;
    } catch (err: unknown) {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy().catch(() => {});
      }
      logger.warn('Failed to start logistics agent, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
