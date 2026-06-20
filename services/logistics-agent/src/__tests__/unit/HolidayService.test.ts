import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    ATTRACTIONS_CACHE_TTL_SECONDS: 86400,
    NODE_ENV: 'test',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return { ...actual, createLogger: () => mockLogger };
});

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
};

import { HolidayService } from '@/services/HolidayService';

const PT_HOLIDAYS = [
  { date: '2026-06-10', localName: 'Dia de Portugal', name: 'Portugal Day', countryCode: 'PT', fixed: true, global: true, counties: null, types: ['Public'] },
  { date: '2026-04-25', localName: 'Dia da Liberdade', name: 'Freedom Day', countryCode: 'PT', fixed: true, global: true, counties: null, types: ['Public'] },
];

describe('HolidayService', () => {
  let service: HolidayService;

  beforeEach(() => {
    service = new HolidayService(mockRedis as never);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getHolidays', () => {
    it('fetches and returns mapped public holidays', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(PT_HOLIDAYS),
      }));

      const result = await service.getHolidays('PT', 2026);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2026-06-10',
        localName: 'Dia de Portugal',
        name: 'Portugal Day',
        countryCode: 'PT',
      });
      expect(result[1]?.date).toBe('2026-04-25');
    });

    it('returns cached holidays without fetching', async () => {
      const cached = [{ date: '2026-06-10', localName: 'Dia de Portugal', name: 'Portugal Day', countryCode: 'PT' }];
      mockRedis.get.mockResolvedValue(cached);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.getHolidays('PT', 2026);

      expect(result).toEqual(cached);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('caches result after successful fetch', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(PT_HOLIDAYS),
      }));

      await service.getHolidays('PT', 2026);

      expect(mockRedis.set).toHaveBeenCalledWith('holidays:PT:2026', expect.any(Array), 86400);
    });

    it('returns empty array when API returns empty list', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }));

      const result = await service.getHolidays('XX', 2026);

      expect(result).toEqual([]);
    });

    it('does not cache empty result', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }));

      await service.getHolidays('XX', 2026);

      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('returns empty array on non-ok API response', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }));

      const result = await service.getHolidays('ZZ', 2026);

      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const result = await service.getHolidays('PT', 2026);

      expect(result).toEqual([]);
    });
  });
});
