import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_PLACES_API_KEY: 'test-places-key',
    NODE_ENV: 'test',
    PLACES_MOCK: false,
  },
}));

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import { PlacesService } from '@/services/PlacesService';
import { config } from '@/config';

const PLACES_RESPONSE = {
  places: [
    {
      id: 'place-1',
      displayName: { text: 'Eiffel Tower' },
      location: { latitude: 48.8584, longitude: 2.2945 },
      types: ['tourist_attraction'],
      rating: 4.7,
      regularOpeningHours: {
        weekdayDescriptions: [
          'Monday: 9:00 AM – 11:45 PM',
          'Tuesday: 9:00 AM – 11:45 PM',
        ],
      },
    },
    {
      id: 'place-2',
      displayName: { text: 'Louvre Museum' },
      location: { latitude: 48.8606, longitude: 2.3376 },
      types: ['museum'],
      rating: 4.8,
      regularOpeningHours: {
        weekdayDescriptions: ['Monday: Closed'],
      },
    },
  ],
};

describe('PlacesService', () => {
  let service: PlacesService;

  beforeEach(() => {
    service = new PlacesService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('searchAttractions', () => {
    it('returns places with correct shape', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(PLACES_RESPONSE),
        text: () => Promise.resolve(''),
      }));

      const results = await service.searchAttractions('Paris');

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('place-1');
      expect(results[0]?.name).toBe('Eiffel Tower');
      expect(results[0]?.location.lat).toBe(48.8584);
      expect(results[0]?.rating).toBe(4.7);
    });

    it('maps opening hours from weekday descriptions', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(PLACES_RESPONSE),
        text: () => Promise.resolve(''),
      }));

      const [eiffel] = await service.searchAttractions('Paris');

      expect(eiffel?.openingHours).toHaveProperty('Monday');
    });

    it('includes category filter in query when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ places: [] }),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.searchAttractions('Paris', 'museum');

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body as string) as { textQuery: string };
      expect(body.textQuery).toContain('museum');
      expect(body.textQuery).toContain('Paris');
    });

    it('returns empty array when no places found', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ places: [] }),
        text: () => Promise.resolve(''),
      }));

      const results = await service.searchAttractions('RemoteVillageXYZ');
      expect(results).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws when API returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('API key invalid'),
      }));

      await expect(service.searchAttractions('Paris')).rejects.toThrow('403');
    });
  });

  describe('searchRestaurants', () => {
    it('maps priceLevel enum strings to numbers', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          places: [
            { id: 'r-1', displayName: { text: 'Zé da Mouraria' }, priceLevel: 'PRICE_LEVEL_INEXPENSIVE' },
            { id: 'r-2', displayName: { text: 'Belcanto' }, priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' },
          ],
        }),
        text: () => Promise.resolve(''),
      }));

      const results = await service.searchRestaurants('Lisbon');

      expect(results).toHaveLength(2);
      expect(results[0]?.priceLevel).toBe(1);
      expect(results[1]?.priceLevel).toBe(4);
      expect(results[0]?.category).toBe('restaurant');
    });

    it('returns priceLevel null when field is absent', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ places: [{ id: 'r-3', displayName: { text: 'Unknown Place' } }] }),
        text: () => Promise.resolve(''),
      }));

      const [place] = await service.searchRestaurants('Lisbon');
      expect(place?.priceLevel).toBeNull();
    });

    it('includes region in the search query', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ places: [] }),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.searchRestaurants('Lisbon');

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body as string) as { textQuery: string };
      expect(body.textQuery).toContain('restaurants');
      expect(body.textQuery).toContain('Lisbon');
    });

    it('throws when API returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      }));

      await expect(service.searchRestaurants('Lisbon')).rejects.toThrow('500');
    });

    it('maps shortFormattedAddress to vicinity', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          places: [{ id: 'r-4', displayName: { text: 'Ramiro' }, shortFormattedAddress: 'Intendente, Lisbon' }],
        }),
        text: () => Promise.resolve(''),
      }));

      const [place] = await service.searchRestaurants('Lisbon');
      expect(place?.vicinity).toBe('Intendente, Lisbon');
    });
  });

  describe('PLACES_MOCK', () => {
    afterEach(() => {
      config.PLACES_MOCK = false;
    });

    it('returns deterministic fixture restaurants without calling the API', async () => {
      config.PLACES_MOCK = true;
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const results = await service.searchRestaurants('Porto');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.category === 'restaurant')).toBe(true);
      expect(results.some((r) => typeof r.priceLevel === 'number')).toBe(true);
      expect(results.some((r) => Boolean(r.vicinity))).toBe(true);
      expect(results[0]?.name).toContain('Porto');
    });
  });
});
