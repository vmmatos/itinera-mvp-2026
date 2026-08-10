import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    SERPAPI_KEY: 'test-serpapi-key',
    SERPAPI_BASE_URL: 'https://serpapi.com/search',
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

import { HotelPriceService } from '@/services/HotelPriceService';

describe('HotelPriceService', () => {
  let service: HotelPriceService;

  beforeEach(() => {
    service = new HotelPriceService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getNightlyPricePerPerson', () => {
    it('returns a per-person nightly rate averaged from real SerpApi results', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          properties: [
            { name: 'Hotel A', rate_per_night: { extracted_lowest: 100 } },
            { name: 'Hotel B', rate_per_night: { extracted_lowest: 120 } },
          ],
        }),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getNightlyPricePerPerson('Lisbon', '2026-07-10', '2026-07-12');

      // avg(100,120)=110, /2 occupancy = 55
      expect(result).toEqual({ pricePerNightPerPerson: 55, isEstimate: false, source: 'serpapi_google_hotels' });
    });

    it('returns null when no dates are provided (cannot query SerpApi)', async () => {
      const result = await service.getNightlyPricePerPerson('Lisbon');
      expect(result).toBeNull();
    });

    it('returns null when no properties are returned', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ properties: [] }),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getNightlyPricePerPerson('RemoteVillageXYZ', '2026-07-10', '2026-07-12');
      expect(result).toBeNull();
    });

    it('returns null when SERPAPI_KEY is not configured', async () => {
      const { config } = await import('@/config');
      const original = config.SERPAPI_KEY;
      (config as { SERPAPI_KEY: string }).SERPAPI_KEY = '';

      const result = await service.getNightlyPricePerPerson('Lisbon', '2026-07-10', '2026-07-12');
      expect(result).toBeNull();

      (config as { SERPAPI_KEY: string }).SERPAPI_KEY = original;
    });

    it('throws when SerpApi returns a non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      }));

      await expect(
        service.getNightlyPricePerPerson('Lisbon', '2026-07-10', '2026-07-12'),
      ).rejects.toThrow('429');
    });

    it('throws when SerpApi returns an error field', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'Hotels not available for this query' }),
        text: () => Promise.resolve(''),
      }));

      await expect(
        service.getNightlyPricePerPerson('Lisbon', '2026-07-10', '2026-07-12'),
      ).rejects.toThrow('Hotels not available');
    });
  });

  describe('getNightlyPricePerPerson with maxPricePerPersonHint', () => {
    it('passes max_price (per-room, x2 occupancy) to the SerpApi query', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ properties: [{ name: 'Budget Inn', rate_per_night: { extracted_lowest: 42 } }] }),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.getNightlyPricePerPerson('Lucerne', '2026-07-10', '2026-07-17', 21);

      const calledUrl = fetchMock.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('max_price=42');
    });

    it('does not mark aboveCeiling when the filtered average is within the hint', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ properties: [{ name: 'Budget Inn', rate_per_night: { extracted_lowest: 40 } }] }),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getNightlyPricePerPerson('Lucerne', '2026-07-10', '2026-07-17', 21);

      expect(result).toEqual({ pricePerNightPerPerson: 20, isEstimate: false, source: 'serpapi_google_hotels' });
    });

    it('falls back to an unfiltered search and marks aboveCeiling when the filtered search finds nothing', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ properties: [] }), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ properties: [{ name: 'Luxury Lakeview', rate_per_night: { extracted_lowest: 666 } }] }),
          text: () => Promise.resolve(''),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getNightlyPricePerPerson('Lucerne', '2026-07-10', '2026-07-17', 21);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![0] as string).not.toContain('max_price');
      expect(result).toEqual({
        pricePerNightPerPerson: 333, isEstimate: false, source: 'serpapi_google_hotels', aboveCeiling: true,
      });
    });

    it('marks aboveCeiling even when the filtered result itself exceeds the hint (does not trust SerpApi filtering blindly)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ properties: [{ name: 'Somehow still pricey', rate_per_night: { extracted_lowest: 200 } }] }),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getNightlyPricePerPerson('Lucerne', '2026-07-10', '2026-07-17', 21);

      expect(result).toEqual({
        pricePerNightPerPerson: 100, isEstimate: false, source: 'serpapi_google_hotels', aboveCeiling: true,
      });
    });

    it('omits max_price and never flags aboveCeiling when no hint is given', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ properties: [{ name: 'Hotel A', rate_per_night: { extracted_lowest: 100 } }] }),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getNightlyPricePerPerson('Lisbon', '2026-07-10', '2026-07-12');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0] as string).not.toContain('max_price');
      expect(result?.aboveCeiling).toBeUndefined();
    });
  });
});
