import Redis from 'ioredis';
import { BaseService } from './BaseService';

export class RedisService extends BaseService {
  private readonly client: Redis;

  constructor(redisUrl: string) {
    super('redis-service');
    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy(times: number) {
        if (times > 30) return null;
        return Math.min(times * 300, 5000);
      },
    });

    this.client.on('error', (err: Error) => {
      const isTransient =
        err.message.includes('EAI_AGAIN') || err.message.includes('ECONNREFUSED');
      if (isTransient) {
        this.logger.warn('Redis connecting…', { error: err.message });
      } else {
        this.logger.error('Redis error', { error: err.message });
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.logger.info('Redis connected');
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  isConnected(): boolean {
    return this.client.status === 'ready';
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
