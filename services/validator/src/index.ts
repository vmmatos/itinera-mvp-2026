import 'reflect-metadata';
import express from 'express';
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

app.use(requestLogger);
app.use(express.json());

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
  app.use('/api/v1/validate', createValidatorRouter(
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

start().catch((err: unknown) => {
  logger.error('Failed to start validator', { error: String(err) });
  process.exit(1);
});
