import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_PLACES_API_KEY: 'test-places-key',
    NODE_ENV: 'test',
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
});
