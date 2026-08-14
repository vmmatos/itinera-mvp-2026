import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    TICKETMASTER_API_KEY: 'test-key',
    TICKETMASTER_BASE_URL: 'https://app.ticketmaster.com/discovery/v2',
    EVENTS_MOCK: false,
    EVENTS_CACHE_TTL_SECONDS: 21600,
    EVENTS_MAX_PER_CITY: 20,
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

import { SpecialEventsService } from '@/services/SpecialEventsService';
import { config } from '@/config';

const TICKETMASTER_RESPONSE = {
  _embedded: {
    events: [
      {
        id: 'evt-1',
        name: 'Rock in Rio Lisboa',
        url: 'https://ticketmaster.com/evt-1',
        dates: { start: { localDate: '2026-09-10', localTime: '20:00:00' } },
        classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }],
        images: [{ url: 'https://img/small.jpg', width: 100 }, { url: 'https://img/large.jpg', width: 640 }],
        _embedded: { venues: [{ name: 'Passeio Marítimo de Algés' }] },
      },
      {
        id: 'evt-2',
        name: 'FC Porto vs Benfica',
        url: 'https://ticketmaster.com/evt-2',
        dates: { start: { localDate: '2026-09-11' } },
        classifications: [{ segment: { name: 'Sports' } }],
      },
    ],
  },
};

describe('SpecialEventsService', () => {
  let service: SpecialEventsService;

  beforeEach(() => {
    service = new SpecialEventsService(mockRedis as never);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    config.EVENTS_MOCK = false;
    config.TICKETMASTER_API_KEY = 'test-key';
  });

  describe('getEvents', () => {
    it('returns fixture events without calling fetch when EVENTS_MOCK=true', async () => {
      config.EVENTS_MOCK = true;
      mockRedis.get.mockResolvedValue(null);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.city).toBe('Lisbon');
      expect(result[0]?.startDate).toBe('2026-09-10');
    });

    it('returns empty array and does not fetch when API key is not configured', async () => {
      config.TICKETMASTER_API_KEY = '';
      mockRedis.get.mockResolvedValue(null);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('fetches and maps Ticketmaster events', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(TICKETMASTER_RESPONSE),
      }));

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'evt-1',
        name: 'Rock in Rio Lisboa',
        url: 'https://ticketmaster.com/evt-1',
        startDate: '2026-09-10',
        startTime: '20:00:00',
        city: 'Lisbon',
        venueName: 'Passeio Marítimo de Algés',
        category: 'Music',
        genre: 'Rock',
        imageUrl: 'https://img/large.jpg',
      });
      expect(result[1]?.category).toBe('Sports');
      expect(result[1]?.venueName).toBeUndefined();
    });

    it('returns cached events without fetching', async () => {
      const cached = [{ id: 'evt-1', name: 'Cached Event', url: '', startDate: '2026-09-10', city: 'Lisbon', category: 'Music' }];
      mockRedis.get.mockResolvedValue(cached);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(result).toEqual(cached);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('caches result after successful fetch', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(TICKETMASTER_RESPONSE),
      }));

      await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'events:Lisbon:2026-09-10:2026-09-12',
        expect.any(Array),
        21600,
      );
    });

    it('returns empty array and does not cache when no events found', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }));

      const result = await service.getEvents('Nowhere', '2026-09-10', '2026-09-12');

      expect(result).toEqual([]);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('returns empty array on non-ok API response', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const result = await service.getEvents('Lisbon', '2026-09-10', '2026-09-12');

      expect(result).toEqual([]);
    });
  });
});
