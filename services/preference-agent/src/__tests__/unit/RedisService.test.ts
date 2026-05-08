import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  getRedisUrl: () => 'redis://localhost:6379',
}));

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
  status: 'ready' as string,
  on: vi.fn(),
};

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => mockRedis),
}));

import { RedisService } from '@/services/RedisService';

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RedisService();
  });

  it('get returns null on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await service.get<{ foo: string }>('missing-key');
    expect(result).toBeNull();
  });

  it('get returns parsed object on cache hit', async () => {
    const data = { tripId: 'abc', agent: 'alice' };
    mockRedis.get.mockResolvedValue(JSON.stringify(data));
    const result = await service.get<typeof data>('hit-key');
    expect(result).toEqual(data);
  });

  it('set serialises value to JSON with TTL', async () => {
    mockRedis.set.mockResolvedValue('OK');
    await service.set('my-key', { foo: 'bar' }, 3600);
    expect(mockRedis.set).toHaveBeenCalledWith('my-key', '{"foo":"bar"}', 'EX', 3600);
  });

  it('del calls ioredis.del', async () => {
    mockRedis.del.mockResolvedValue(1);
    await service.del('to-delete');
    expect(mockRedis.del).toHaveBeenCalledWith('to-delete');
  });

  it('isConnected returns true when status is ready', () => {
    mockRedis.status = 'ready';
    expect(service.isConnected()).toBe(true);
  });

  it('isConnected returns false when not ready', () => {
    mockRedis.status = 'connecting';
    expect(service.isConnected()).toBe(false);
  });
});
