import { createHealthRouter as createRouter } from '@itinera/shared'
import type { Router } from 'express'
import type { EmailConsumer } from '@/services/EmailConsumer'

export function createHealthRouter(consumer: EmailConsumer): Router {
  return createRouter('notification', {
    rabbitmq: () => consumer.isConnected(),
  })
}
