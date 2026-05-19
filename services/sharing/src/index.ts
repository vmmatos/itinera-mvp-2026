import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { requestLogger, errorHandler, authMiddleware, createLogger } from '@itinera/shared'
import { config } from '@/config'
import { RedisService } from '@/services/RedisService'
import { ShareLinkGenerator } from '@/services/ShareLinkGenerator'
import { PDFGeneratorService } from '@/services/PDFGeneratorService'
import { createHealthRouter } from '@/routes/health'
import { createPublicShareRouter } from '@/routes/share.public'
import { createProtectedShareRouter } from '@/routes/share.protected'
import { createExportRouter } from '@/routes/export'

const logger = createLogger('sharing')

async function start(): Promise<void> {
  const redis = new RedisService()
  await redis.connect()

  const generator = new ShareLinkGenerator(redis)
  const pdfGenerator = new PDFGeneratorService()

  const app = express()

  app.use(helmet())
  app.use(requestLogger)
  app.use(express.json({ limit: '5mb' }))

  // Public routes — no auth
  app.use(createHealthRouter(redis))
  app.use('/api/v1/share', createPublicShareRouter(generator))

  // Protected routes — JWT required
  app.use('/api/v1/share', authMiddleware, createProtectedShareRouter(generator))
  app.use('/api/v1/export', authMiddleware, createExportRouter(pdfGenerator))

  app.use(errorHandler)

  const server = app.listen(config.PORT, () => {
    logger.info('Sharing service started', { port: config.PORT })
  })

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down sharing service')
    await redis.close()
    server.close(() => {
      logger.info('Sharing service stopped')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

start().catch((err: unknown) => {
  logger.error('Failed to start sharing service', { error: String(err) })
  process.exit(1)
})
