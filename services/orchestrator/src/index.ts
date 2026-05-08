import 'reflect-metadata';
import express from 'express';
import { requestLogger, errorHandler, createLogger } from '@itinera/shared';
import type { HealthResponse, ReadyResponse } from '@itinera/shared';
import { AppDataSource } from '@/data-source';

const logger = createLogger('orchestrator');
const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

app.use(requestLogger);
app.use(express.json());

app.get('/health', (_req, res: express.Response<HealthResponse>) => {
  res.json({ status: 'ok', service: 'orchestrator', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req, res: express.Response<ReadyResponse>) => {
  const db = AppDataSource.isInitialized;
  res.status(db ? 200 : 503).json({
    status: db ? 'ready' : 'not_ready',
    service: 'orchestrator',
    timestamp: new Date().toISOString(),
    checks: { db },
  });
});

app.use(errorHandler);

async function start(): Promise<void> {
  await AppDataSource.initialize();
  logger.info('Database connected');

  const server = app.listen(PORT, () => {
    logger.info('Orchestrator started', { port: PORT });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down orchestrator');
    await AppDataSource.destroy();
    server.close(() => {
      logger.info('Orchestrator stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

start().catch((err: unknown) => {
  logger.error('Failed to start orchestrator', { error: String(err) });
  process.exit(1);
});
