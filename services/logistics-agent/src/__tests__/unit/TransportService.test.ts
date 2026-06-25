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
            { travel_mode: 'TRANSIT', transit_details: { line: { name: 'AVE Madrid-Barcelona' } } },
          ],
        },
      ],
    },
  ],
};

// Branch the fetch mock on URL so each mode can be controlled independently.
// `sky`/`directions` may be a payload (resolves ok) or an Error (rejects).
function stubFetch(opts: { sky?: unknown; directions?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const isFlight = String(url).includes('searchFlights');
      const val = isFlight ? opts.sky : opts.directions;
      if (val === undefined) return Promise.reject(new Error('not configured'));
      if (val instanceof Error) return Promise.reject(val);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(val), text: () => Promise.resolve('') });
    }),
  );
}

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

  // ── Mode parsing (isolated by failing the other modes) ───────────────
  describe('flight parsing', () => {
    beforeEach(() => {
      // isolate flight: train + car disabled
      stubFetch({ sky: SKYSCANNER_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
    });

    it('parses a Skyscanner flight option', async () => {
      const result = await service.resolveTransportOptions({ from: 'MAD', to: 'BCN', departureDateIso: '2026-08-01' }, 'best');
      const flight = result.find((o) => o.mode === 'flight');
      expect(flight).toBeDefined();
      expect(flight!.priceEur).toBe(90);
      expect(flight!.durationMinutes).toBe(125);
      expect(flight!.flightNumber).toBe('FR1234');
      expect(flight!.provider).toBe('Skyscanner');
      expect(flight!.departureTime).toBe('06:00');
      expect(flight!.arrivalTime).toBe('08:05');
    });
  });

  describe('train parsing', () => {
    beforeEach(() => {
      stubFetch({ sky: new Error('no flight'), directions: DIRECTIONS_OK });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
    });

    it('parses a Google Directions transit option', async () => {
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      const train = result.find((o) => o.mode === 'train');
      expect(train).toBeDefined();
      expect(train!.durationMinutes).toBe(165); // ceil(9900 / 60)
      expect(train!.departureTime).toBe('09:30');
      expect(train!.arrivalTime).toBe('12:15');
      expect(train!.trainLine).toBe('AVE Madrid-Barcelona');
    });

    it('requests transit mode with rail + alternatives', async () => {
      await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const directionsUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => !u.includes('searchFlights'));
      expect(directionsUrl).toContain('mode=transit');
      expect(directionsUrl).toContain('transit_mode=rail');
      expect(directionsUrl).toContain('alternatives=true');
    });
  });

  describe('car', () => {
    it('returns a car option from MapService when flights/trains fail', async () => {
      stubFetch({ sky: new Error('x'), directions: new Error('y') });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      const car = result.find((o) => o.mode === 'car');
      expect(car).toBeDefined();
      expect(car!.durationMinutes).toBe(120);
      expect(car!.priceEur).toBeUndefined();
    });

    it('adds a >4h warning when driving exceeds 240 minutes', async () => {
      stubFetch({ sky: new Error('x'), directions: new Error('y') });
      mapService = makeMapServiceMock({ durationMinutes: 270 });
      service = new TransportService(mapService);
      const result = await service.resolveTransportOptions({ from: 'Lisbon', to: 'Porto' }, 'best');
      const car = result.find((o) => o.mode === 'car');
      expect(car!.warnings.some((w) => w.includes('4h'))).toBe(true);
    });
  });

  // ── Aggregation + resilience ─────────────────────────────────────────
  describe('all modes / resilience', () => {
    it('returns every available mode as an alternative', async () => {
      stubFetch({ sky: SKYSCANNER_OK, directions: DIRECTIONS_OK });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      const modes = result.map((o) => o.mode);
      expect(modes).toContain('flight');
      expect(modes).toContain('train');
      expect(modes).toContain('car');
    });

    it('skips a failed mode without throwing while others succeed', async () => {
      stubFetch({ sky: new Error('429'), directions: DIRECTIONS_OK });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      expect(result.find((o) => o.mode === 'flight')).toBeUndefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('throws only when every mode fails', async () => {
      stubFetch({ sky: new Error('x'), directions: new Error('y') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Maps down'));
      await expect(
        service.resolveTransportOptions({ from: 'A', to: 'B' }, 'best'),
      ).rejects.toThrow('No transport options found');
    });

    it("ranks cheapest/fastest first for 'best' (no preference)", async () => {
      const cheapSky = {
        data: {
          itineraries: [{
            price: { amount: 45, currency: 'EUR' },
            legs: [{ durationInMinutes: 55, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T06:55:00', segments: [] }],
          }],
        },
      };
      stubFetch({ sky: cheapSky, directions: DIRECTIONS_OK });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      expect(result[0].mode).toBe('flight');
      expect(result[0].priceEur).toBe(45);
    });
  });

  // ── F4: preferred mode favoured, alternatives still shown ────────────
  describe('preference bias', () => {
    it('ranks the preferred mode first on a near-tie, keeping alternatives', async () => {
      // Flight slightly cheaper than train; with train preference the discount lifts train to first.
      const sky = {
        data: { itineraries: [{ price: { amount: 80, currency: 'EUR' }, legs: [{ durationInMinutes: 90, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T07:30:00', segments: [{ flightNumber: 'FR1' }] }] }] },
      };
      const directions = {
        status: 'OK',
        routes: [{ legs: [{ duration: { value: 6000 }, departure_time: { text: '08:00' }, arrival_time: { text: '09:40' }, steps: [{ travel_mode: 'TRANSIT', transit_details: { line: { name: 'AVE' } } }] }] }],
      };
      stubFetch({ sky, directions });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].mode).toBe('train');
      // alternatives still present
      expect(result.find((o) => o.mode === 'flight')).toBeDefined();
    });

    it('still lets a clearly better option beat the preferred mode', async () => {
      // Flight much cheaper + faster than train; even with train preference, flight wins.
      const sky = {
        data: { itineraries: [{ price: { amount: 30, currency: 'EUR' }, legs: [{ durationInMinutes: 50, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T06:50:00', segments: [{ flightNumber: 'FR1' }] }] }] },
      };
      const directions = {
        status: 'OK',
        routes: [{ legs: [{ duration: { value: 18000 }, departure_time: { text: '08:00' }, arrival_time: { text: '13:00' }, steps: [{ travel_mode: 'TRANSIT', transit_details: { line: { name: 'Regional' } } }] }] }],
      };
      stubFetch({ sky, directions });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].mode).toBe('flight');
    });
  });

  // ── Skyscanner payload contract ──────────────────────────────────────
  describe('Skyscanner API call', () => {
    it('sends POST with correct headers and body', async () => {
      stubFetch({ sky: SKYSCANNER_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await service.resolveTransportOptions({ from: 'Lisbon', to: 'Madrid', departureDateIso: '2026-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const flightCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('searchFlights')) as [string, RequestInit];
      const init = flightCall[1];
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
