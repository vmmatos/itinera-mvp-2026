import type { Response } from 'express'
import { createLogger } from '@itinera/shared'

interface SSEClient {
  id: string
  res: Response
  tripId?: string
  connectedAt: Date
}

function sanitizeEventType(eventType: string): string {
  // Strip CR, LF and colon — these would break the SSE line protocol
  return eventType.replace(/[\r\n:]/g, '_')
}

export class SSEManager {
  private readonly clients = new Map<string, SSEClient>()
  private readonly logger = createLogger('ws-relay')

  addClient(id: string, res: Response, tripId?: string): void {
    this.clients.set(id, { id, res, tripId, connectedAt: new Date() })
    res.write('retry: 3000\n\n')
    this.logger.info('SSE client connected', { id, tripId, total: this.clients.size })
  }

  removeClient(id: string): void {
    this.clients.delete(id)
    this.logger.info('SSE client disconnected', { id, total: this.clients.size })
  }

  broadcast(event: unknown, eventType = 'agent'): void {
    const safeType = sanitizeEventType(eventType)
    const payload = `event: ${safeType}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of this.clients.values()) {
      this.writeToClient(client, payload)
    }
  }

  broadcastToTrip(tripId: string, event: unknown, eventType = 'agent'): void {
    const safeType = sanitizeEventType(eventType)
    const payload = `event: ${safeType}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of this.clients.values()) {
      if (!client.tripId || client.tripId === tripId) {
        this.writeToClient(client, payload)
      }
    }
  }

  clientCount(): number {
    return this.clients.size
  }

  closeAll(): void {
    for (const client of this.clients.values()) {
      try { client.res.end() } catch { /* already closed */ }
    }
    this.clients.clear()
  }

  private writeToClient(client: SSEClient, payload: string): void {
    try {
      client.res.write(payload)
    } catch {
      this.clients.delete(client.id)
    }
  }
}
