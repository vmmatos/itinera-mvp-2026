import 'reflect-metadata';
import express from 'express';
import helmet from 'helmet';
import { requestLogger, errorHandler, createLogger, AnthropicService } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { config } from '@/config';
import { EventPublisher } from '@/services/EventPublisher';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { NegotiationLoop } from '@/services/NegotiationLoop';
import { TripService } from '@/services/TripService';
import { DestinationParser } from '@/services/DestinationParser';
import { registerRoutes } from '@/routes';

const logger = createLogger('orchestrator');
const app = express();

app.use(helmet());
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

async function start(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('Database connected');

  const eventPublisher = new EventPublisher();
  await eventPublisher.connect();

  const stateManager = new StateManager();
  const agentCaller = new AgentCaller();
  const negotiationLoop = new NegotiationLoop(stateManager, agentCaller, eventPublisher);
  const aiProvider = config.ANTHROPIC_API_KEY
    ? new AnthropicService(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
    : undefined;
  const destinationParser = new DestinationParser(aiProvider);
  const tripService = new TripService(stateManager, negotiationLoop, destinationParser);
  negotiationLoop.setTripService(tripService);

  registerRoutes(app, eventPublisher, tripService);
  app.use(errorHandler);

  const server = app.listen(config.PORT, () => {
    logger.info('Orchestrator started', { port: config.PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down orchestrator');
    await AppDataSource.destroy();
    await eventPublisher.close();
    server.close(() => {
      logger.info('Orchestrator stopped');
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
      logger.warn('Failed to start orchestrator, retrying...', { attempt, error: String(err) });
      await new Promise<void>((res) => setTimeout(res, RETRY_DELAY_MS));
    }
  }
}

void startWithRetry();
