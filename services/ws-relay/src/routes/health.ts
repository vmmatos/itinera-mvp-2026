import { createHealthRouter as createRouter } from '@itinera/shared'
import type { Router } from 'express'
import type { RabbitMQConsumer } from '@/services/RabbitMQConsumer'
import type { SSEManager } from '@/services/SSEManager'

export function createHealthRouter(consumer: RabbitMQConsumer, sseManager: SSEManager): Router {
  return createRouter('ws-relay', {
    rabbitmq: () => consumer.isConnected(),
    clients: () => sseManager.clientCount() >= 0,
  })
}
