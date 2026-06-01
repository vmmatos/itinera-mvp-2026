import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import { requestLogger, errorHandler, authMiddleware, createLogger } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { RabbitMQPublisher } from '@/services/RabbitMQPublisher';
import { ProposalStorageService } from '@/services/ProposalStorageService';
import { ValidationService } from '@/services/ValidationService';
import { ConstraintChecker } from '@/validators/ConstraintChecker';
import { ScoringEngine } from '@/validators/ScoringEngine';
import { FairnessCalculator } from '@/validators/FairnessCalculator';
import { MetricsCollector } from '@/validators/MetricsCollector';
import { createHealthRouter } from '@/routes/health';
import { createValidatorRouter } from '@/routes/validator';

const logger = createLogger('validator');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

async function start(): Promise<void> {
  await AppDataSource.initialize();

  const publisher = new RabbitMQPublisher();
  const storage = new ProposalStorageService();

  await publisher.connect();

  const constraintChecker = new ConstraintChecker();
  const scoringEngine = new ScoringEngine();
  const fairnessCalculator = new FairnessCalculator();
  const metricsCollector = new MetricsCollector();

  const validationService = new ValidationService(
    constraintChecker,
    scoringEngine,
    fairnessCalculator,
    metricsCollector,
    publisher,
    storage,
  );

  app.use(createHealthRouter(publisher));
  app.use(authMiddleware);
  app.use('/', createValidatorRouter(
    validationService,
    scoringEngine,
    fairnessCalculator,
    constraintChecker,
  ));
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Validator started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down validator');
    await AppDataSource.destroy();
    await publisher.close();
    server.close(() => {
      logger.info('Validator stopped');
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
        logger.error('Failed to start validator, giving up', { error: String(err) });
        process.exit(1);
      }
      logger.warn('Failed to start validator, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
