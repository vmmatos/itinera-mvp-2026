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
import { CostCalculator } from '@/agents/CostCalculator';
import { BudgetValidator } from '@/agents/BudgetValidator';
import { AlternativeFinder } from '@/agents/AlternativeFinder';
import { createHealthRouter } from '@/routes/health';
import { createFinanceRouter } from '@/routes/finance';

const logger = createLogger('finance-agent');
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

  const calculator = new CostCalculator();
  const validator = new BudgetValidator();
  const finder = new AlternativeFinder(anthropic, publisher, redis, storage);

  app.use(createHealthRouter(publisher, redis));
  app.use(authMiddleware);
  app.use(createFinanceRouter(calculator, validator, finder, storage));
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Finance agent started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down finance agent');
    await AppDataSource.destroy();
    await publisher.close();
    await redis.close();
    server.close(() => {
      logger.info('Finance agent stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

start().catch((err: unknown) => {
  logger.error('Failed to start finance agent', { error: String(err) });
  process.exit(1);
});
