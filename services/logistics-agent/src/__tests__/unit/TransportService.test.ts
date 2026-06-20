import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
    GOOGLE_MAPS_BASE_URL: 'https://maps.googleapis.com/maps/api',
    SKYSCANNER_RAPIDAPI_KEY: 'test-sky-key',
    SKYSCANNER_RAPIDAPI_HOST: 'skyscanner50.p.rapidapi.com',
    SKYSCANNER_BASE_URL: 'https://skyscanner50.p.rapidapi.com/api/v1',
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

import { TransportService } from '@/services/TransportService';
import type { MapService } from '@/services/MapService';
import { config } from '@/config';

const SKYSCANNER_OK = {
  data: {
    itineraries: [
      {
        price: { amount: 89.99, currency: 'EUR' },
        legs: [
          {
            durationInMinutes: 125,
            departure: '2026-08-01T06:00:00',
            arrival: '2026-08-01T08:05:00',
            segments: [{ flightNumber: 'FR1234' }],
          },
        ],
      },
    ],
  },
};

const DIRECTIONS_OK = {
  status: 'OK',
  routes: [
    {
      legs: [
        {
          duration: { value: 9900 },
          departure_time: { text: '09:30' },
          arrival_time: { text: '12:15' },
          steps: [
            {
              travel_mode: 'TRANSIT',
              transit_details: { line: { name: 'AVE Madrid-Barcelona' } },
            },
          ],
        },
      ],
    },
  ],
};

const MATRIX_OK = {
  status: 'OK',
  rows: [{ elements: [{ status: 'OK', duration: { value: 7200 }, distance: { value: 180000 } }] }],
};

function makeMapServiceMock(result?: Partial<Awaited<ReturnType<MapService['getTravelTime']>>>): MapService {
  return {
    getTravelTime: vi.fn().mockResolvedValue({
      from: 'Madrid',
      to: 'Barcelona',
      durationMinutes: 120,
      distanceKm: 600,
      mode: 'driving' as const,
      ...result,
    }),
  } as unknown as MapService;
}

describe('TransportService', () => {
  let service: TransportService;
  let mapService: MapService;

  beforeEach(() => {
    mapService = makeMapServiceMock();
    service = new TransportService(mapService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Car ──────────────────────────────────────────────────────
  describe('resolveTransportOption — car', () => {
    it('delegates to MapService.getTravelTime with driving mode', async () => {
      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'car',
      );

      expect(mapService.getTravelTime).toHaveBeenCalledWith('Madrid', 'Barcelona', 'driving');
      expect(result.mode).toBe('car');
      expect(result.durationMinutes).toBe(120);
      expect(result.provider).toBe('Google Maps');
    });

    it('does not set priceEur (self-drive)', async () => {
      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'car',
      );
      expect(result.priceEur).toBeUndefined();
    });

    it('adds >3h warning when driving exceeds 180 minutes', async () => {
      mapService = makeMapServiceMock({ durationMinutes: 210 });
      service = new TransportService(mapService);

      const result = await service.resolveTransportOption(
        { from: 'Lisbon', to: 'Porto' },
        'car',
      );

      expect(result.warnings.some((w) => w.includes('3h'))).toBe(true);
    });

    it('no warnings for trips under 3h', async () => {
      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'car',
      );
      expect(result.warnings).toHaveLength(0);
    });

    it('propagates MapService errors', async () => {
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('No route found'),
      );

      await expect(
        service.resolveTransportOption({ from: 'A', to: 'B' }, 'car'),
      ).rejects.toThrow('No route found');
    });
  });

  // ── Flight ───────────────────────────────────────────────────
  describe('resolveTransportOption — flight', () => {
    it('returns a TransportOption with mode=flight on Skyscanner success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SKYSCANNER_OK),
        text: () => Promise.resolve(''),
      }));

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona', departureDateIso: '2026-08-01' },
        'flight',
      );

      expect(result.mode).toBe('flight');
      expect(result.priceEur).toBe(90);
      expect(result.durationMinutes).toBe(125);
      expect(result.flightNumber).toBe('FR1234');
      expect(result.provider).toBe('Skyscanner');
    });

    it('extracts departure and arrival times from ISO timestamp', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SKYSCANNER_OK),
        text: () => Promise.resolve(''),
      }));

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'flight',
      );

      expect(result.departureTime).toBe('06:00');
      expect(result.arrivalTime).toBe('08:05');
    });

    it('throws when Skyscanner key is empty', async () => {
      const savedKey = config.SKYSCANNER_RAPIDAPI_KEY;
      (config as Record<string, unknown>).SKYSCANNER_RAPIDAPI_KEY = '';
      try {
        await expect(
          service.resolveTransportOption({ from: 'MAD', to: 'BCN' }, 'flight'),
        ).rejects.toThrow('Skyscanner API key not configured');
      } finally {
        (config as Record<string, unknown>).SKYSCANNER_RAPIDAPI_KEY = savedKey;
      }
    });

    it('throws when Skyscanner returns HTTP 429', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      }));

      await expect(
        service.resolveTransportOption({ from: 'MAD', to: 'BCN' }, 'flight'),
      ).rejects.toThrow('429');
    });

    it('throws when no itineraries returned', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { itineraries: [] } }),
        text: () => Promise.resolve(''),
      }));

      await expect(
        service.resolveTransportOption({ from: 'MAD', to: 'BCN' }, 'flight'),
      ).rejects.toThrow('No flight found');
    });
  });

  // ── Train ────────────────────────────────────────────────────
  describe('resolveTransportOption — train', () => {
    it('calls Directions API with transit mode', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(DIRECTIONS_OK),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.resolveTransportOption({ from: 'Madrid', to: 'Barcelona' }, 'train');

      const url = (mockFetch.mock.calls[0] as [string])[0] as string;
      expect(url).toContain('mode=transit');
      expect(url).toContain('transit_mode=rail');
    });

    it('returns mode=train with duration and transit details', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(DIRECTIONS_OK),
        text: () => Promise.resolve(''),
      }));

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'train',
      );

      expect(result.mode).toBe('train');
      expect(result.durationMinutes).toBe(165); // ceil(9900 / 60)
      expect(result.departureTime).toBe('09:30');
      expect(result.arrivalTime).toBe('12:15');
      expect(result.trainLine).toBe('AVE Madrid-Barcelona');
      expect(result.provider).toBe('Google Maps');
    });

    it('throws on ZERO_RESULTS', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ZERO_RESULTS', routes: [] }),
        text: () => Promise.resolve(''),
      }));

      await expect(
        service.resolveTransportOption({ from: 'A', to: 'B' }, 'train'),
      ).rejects.toThrow('No train route found');
    });

    it('throws on non-OK API status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'REQUEST_DENIED' }),
        text: () => Promise.resolve(''),
      }));

      await expect(
        service.resolveTransportOption({ from: 'A', to: 'B' }, 'train'),
      ).rejects.toThrow('REQUEST_DENIED');
    });
  });

  // ── Best ─────────────────────────────────────────────────────
  describe('resolveTransportOption — best', () => {
    it('queries all three modes in parallel via Promise.allSettled', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(SKYSCANNER_OK), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(DIRECTIONS_OK), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'best',
      );

      // flight (Skyscanner POST) + train (Directions GET) = 2 fetch calls; car uses MapService (no fetch)
      expect(result.mode).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('picks cheapest option when price data available', async () => {
      const cheapSky = {
        data: {
          itineraries: [{
            price: { amount: 45, currency: 'EUR' },
            legs: [{ durationInMinutes: 55, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T06:55:00', segments: [] }],
          }],
        },
      };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(cheapSky), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(DIRECTIONS_OK), text: () => Promise.resolve('') }),
      );

      // Car: 120 min, no price → score = 0*0.6 + 2*40 = 80
      // Train: 165 min, no price → score = 0*0.6 + 2.75*40 = 110
      // Flight: 55 min, €45 → score = 45*0.6 + 0.917*40 = 27+36.7 = 63.7  ← wins
      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'best',
      );

      expect(result.mode).toBe('flight');
      expect(result.priceEur).toBe(45);
    });

    it('falls back to car when both flight and train fail', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'best',
      );

      expect(result.mode).toBe('car');
    });

    it('skips flight when Skyscanner returns 429 and picks best remaining', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve('rate limited') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(DIRECTIONS_OK), text: () => Promise.resolve('') }),
      );

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'best',
      );

      expect(['train', 'car']).toContain(result.mode);
    });

    it('throws when all options fail', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Maps down'),
      );

      await expect(
        service.resolveTransportOption({ from: 'A', to: 'B' }, 'best'),
      ).rejects.toThrow('No transport options found');
    });
  });

  // ── Warning logic ─────────────────────────────────────────────
  describe('warning generation', () => {
    it('adds >3h warning for flight over 180 minutes', async () => {
      const longFlight = {
        data: {
          itineraries: [{
            price: { amount: 199, currency: 'EUR' },
            legs: [{
              durationInMinutes: 420,
              departure: '2026-08-01T06:00:00',
              arrival: '2026-08-01T13:00:00',
              segments: [{ flightNumber: 'LH100' }],
            }],
          }],
        },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(longFlight),
        text: () => Promise.resolve(''),
      }));

      const result = await service.resolveTransportOption(
        { from: 'Lisbon', to: 'Tokyo' },
        'flight',
      );

      expect(result.warnings.some((w) => w.includes('3h'))).toBe(true);
    });

    it('no warnings for flight under 3h', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SKYSCANNER_OK),
        text: () => Promise.resolve(''),
      }));

      const result = await service.resolveTransportOption(
        { from: 'Madrid', to: 'Barcelona' },
        'flight',
      );

      expect(result.warnings).toHaveLength(0);
    });
  });

  // ── Skyscanner fetch payload ──────────────────────────────────
  describe('Skyscanner API call', () => {
    it('sends POST with correct headers and body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SKYSCANNER_OK),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.resolveTransportOption(
        { from: 'Lisbon', to: 'Madrid', departureDateIso: '2026-09-10' },
        'flight',
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('searchFlights');
      expect((init.headers as Record<string, string>)['X-RapidAPI-Key']).toBe('test-sky-key');
      expect((init.headers as Record<string, string>)['X-RapidAPI-Host']).toBe('skyscanner50.p.rapidapi.com');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['origin']).toBe('Lisbon');
      expect(body['destination']).toBe('Madrid');
      expect(body['date']).toBe('2026-09-10');
      expect(body['currency']).toBe('EUR');
    });
  });
});
