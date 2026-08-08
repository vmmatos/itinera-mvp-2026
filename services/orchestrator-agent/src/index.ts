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
import { ConflictAnalyzer } from '@/agents/ConflictAnalyzer';
import { CompromiseGenerator } from '@/agents/CompromiseGenerator';
import { ProposalRefiner } from '@/agents/ProposalRefiner';
import { ItineraryMerger } from '@/agents/ItineraryMerger';
import { ItineraryRepairer } from '@/agents/ItineraryRepairer';
import { createHealthRouter } from '@/routes/health';
import { createOrchestratorRouter } from '@/routes/orchestrator';

const logger = createLogger('orchestrator-agent');
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

  const analyzer = new ConflictAnalyzer(anthropic, publisher, redis, storage);
  const generator = new CompromiseGenerator(anthropic, publisher, redis, storage);
  const refiner = new ProposalRefiner(anthropic, publisher, redis, storage);
  const merger = new ItineraryMerger(anthropic, publisher, redis, storage);
  const repairer = new ItineraryRepairer(anthropic, publisher, redis, storage);

  app.locals['logger'] = logger;
  app.use(createHealthRouter(publisher, redis));
  app.use(authMiddleware);
  app.use(createOrchestratorRouter(analyzer, generator, refiner, merger, repairer));
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Orchestrator agent started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down orchestrator agent');
    await AppDataSource.destroy();
    await publisher.close();
    await redis.close();
    server.close(() => {
      logger.info('Orchestrator agent stopped');
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
      logger.warn('Failed to start orchestrator agent, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
