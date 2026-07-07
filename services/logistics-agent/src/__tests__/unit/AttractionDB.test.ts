import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  config: {
    GOOGLE_PLACES_API_KEY: 'test-key',
    NODE_ENV: 'test',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

vi.mock('@/services/PlacesService');
vi.mock('@/services/RedisService');

import { AttractionDB } from '@/services/AttractionDB';
import { PlacesService } from '@/services/PlacesService';
import { RedisService } from '@/services/RedisService';
import type { Place } from '@/services/PlacesService';

const TTL_24H = 86400;

const MOCK_PLACES: Place[] = [
  {
    id: 'place-1',
    name: 'Eiffel Tower',
    location: { lat: 48.8584, lng: 2.2945 },
    category: 'tourist_attraction',
    rating: 4.7,
    priceLevel: null,
    openingHours: { Monday: '9:00-23:45' },
    metadata: {},
  },
];

describe('AttractionDB', () => {
  let places: PlacesService;
  let redis: RedisService;
  let db: AttractionDB;

  beforeEach(() => {
    vi.clearAllMocks();
    places = new PlacesService();
    redis = new RedisService();
    db = new AttractionDB(places, redis, TTL_24H);

    vi.mocked(places.searchAttractions).mockResolvedValue(MOCK_PLACES);
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue(undefined);
  });

  describe('getAttractions', () => {
    it('cache miss: calls PlacesService and caches result', async () => {
      const result = await db.getAttractions('Paris');

      expect(places.searchAttractions).toHaveBeenCalledOnce();
      expect(places.searchAttractions).toHaveBeenCalledWith('Paris', undefined);
      expect(redis.set).toHaveBeenCalledOnce();
      expect(result).toEqual(MOCK_PLACES);
    });

    it('cache miss: stores with 24h TTL', async () => {
      await db.getAttractions('Paris');

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('Paris'),
        MOCK_PLACES,
        TTL_24H,
      );
    });

    it('cache hit: returns cached data without calling PlacesService', async () => {
      vi.mocked(redis.get).mockResolvedValue(MOCK_PLACES);

      const result = await db.getAttractions('Paris');

      expect(places.searchAttractions).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(result).toEqual(MOCK_PLACES);
    });

    it('passes category to PlacesService when provided', async () => {
      await db.getAttractions('Paris', 'museum');

      expect(places.searchAttractions).toHaveBeenCalledWith('Paris', 'museum');
    });

    it('uses different cache keys for different categories', async () => {
      await db.getAttractions('Paris');
      await db.getAttractions('Paris', 'museum');

      const keys = (redis.get as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(keys[0]).toContain('all');
      expect(keys[1]).toContain('museum');
    });
  });

  describe('getOpeningHours', () => {
    it('returns opening hours for known place', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const hours = await db.getOpeningHours('Paris', 'place-1');

      expect(hours).toEqual({ Monday: '9:00-23:45' });
    });

    it('returns empty object when place id not found', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      const hours = await db.getOpeningHours('Paris', 'unknown-id');

      expect(hours).toEqual({});
    });

    it('cache hit: returns cached hours without re-fetching', async () => {
      vi.mocked(redis.get).mockResolvedValue({ Monday: '10:00-18:00' });

      const hours = await db.getOpeningHours('Paris', 'place-1');

      expect(places.searchAttractions).not.toHaveBeenCalled();
      expect(hours).toEqual({ Monday: '10:00-18:00' });
    });
  });
});
