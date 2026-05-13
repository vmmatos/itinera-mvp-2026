import Redis from 'ioredis';
import { BaseService } from '@itinera/shared';
import { getRedisUrl } from '@/config';

export class RedisService extends BaseService {
  private readonly client: Redis;

  constructor() {
    super('redis-service');
    this.client = new Redis(getRedisUrl(), {
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('Redis error', { error: err.message });
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
