import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
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

import { MapService } from '@/services/MapService';

const MATRIX_OK = {
  status: 'OK',
  rows: [
    {
      elements: [
        {
          status: 'OK',
          duration: { value: 1800 },
          distance: { value: 12500 },
        },
      ],
    },
  ],
};

describe('MapService', () => {
  let service: MapService;

  beforeEach(() => {
    service = new MapService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getTravelTime', () => {
    it('returns travel time with correct shape', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MATRIX_OK),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getTravelTime('Hotel Paris', 'Eiffel Tower');

      expect(result.from).toBe('Hotel Paris');
      expect(result.to).toBe('Eiffel Tower');
      expect(result.durationMinutes).toBe(30);
      expect(result.distanceKm).toBe(12.5);
      expect(result.mode).toBe('driving');
    });

    it('uses specified travel mode', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MATRIX_OK),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.getTravelTime('A', 'B', 'walking');

      const url = (mockFetch.mock.calls[0] as [string])[0] as string;
      expect(url).toContain('mode=walking');
    });

    it('rounds up duration to nearest minute', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          rows: [{ elements: [{ status: 'OK', duration: { value: 91 }, distance: { value: 500 } }] }],
        }),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getTravelTime('A', 'B');
      expect(result.durationMinutes).toBe(2);
    });
  });

  describe('error handling', () => {
    it('throws when fetch returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      }));

      await expect(service.getTravelTime('A', 'B')).rejects.toThrow('400');
    });

    it('throws when API status is not OK', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'REQUEST_DENIED', rows: [] }),
        text: () => Promise.resolve(''),
      }));

      await expect(service.getTravelTime('A', 'B')).rejects.toThrow('REQUEST_DENIED');
    });

    it('throws when element status is not OK', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'OK',
          rows: [{ elements: [{ status: 'NOT_FOUND' }] }],
        }),
        text: () => Promise.resolve(''),
      }));

      await expect(service.getTravelTime('A', 'B')).rejects.toThrow('No route found');
    });
  });
});
