import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
    GOOGLE_MAPS_BASE_URL: 'https://maps.googleapis.com/maps/api',
    GOOGLE_ROUTES_BASE_URL: 'https://routes.googleapis.com',
    SKYSCANNER_RAPIDAPI_KEY: 'test-sky-key',
    SKYSCANNER_RAPIDAPI_HOST: 'sky-scrapper.p.rapidapi.com',
    SKYSCANNER_BASE_URL: 'https://sky-scrapper.p.rapidapi.com',
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

// sky-scrapper searchAirport response (city → skyId/entityId).
const AIRPORT_OK = {
  data: [{ navigation: { relevantFlightParams: { skyId: 'MAD', entityId: '95565077' } } }],
};

// sky-scrapper searchFlights response.
const SKYSCANNER_OK = {
  data: {
    itineraries: [
      {
        price: { raw: 89.99 },
        legs: [
          {
            durationInMinutes: 125,
            departure: '2026-08-01T06:00:00',
            arrival: '2026-08-01T08:05:00',
            stopCount: 0,
            carriers: { marketing: [{ name: 'Ryanair', alternateId: 'FR' }] },
            segments: [{ flightNumber: '1234', marketingCarrier: { name: 'Ryanair', alternateId: 'FR' } }],
          },
        ],
      },
    ],
  },
};

// Build a sky-scrapper searchFlights payload (single itinerary).
function flightsPayload(opts: { priceRaw: number; durationInMinutes: number; departure: string; arrival: string; carrier?: string; alt?: string; flightNumber?: string }): unknown {
  return {
    data: {
      itineraries: [
        {
          price: { raw: opts.priceRaw },
          legs: [
            {
              durationInMinutes: opts.durationInMinutes,
              departure: opts.departure,
              arrival: opts.arrival,
              stopCount: 0,
              carriers: { marketing: [{ name: opts.carrier ?? 'TestAir', alternateId: opts.alt ?? 'TA' }] },
              segments: [{ flightNumber: opts.flightNumber ?? '1', marketingCarrier: { name: opts.carrier ?? 'TestAir', alternateId: opts.alt ?? 'TA' } }],
            },
          ],
        },
      ],
    },
  };
}

// Google Routes API (v2) transit response — replaces the legacy Directions shape.
const ROUTES_OK = {
  routes: [
    {
      duration: '9900s',
      legs: [
        {
          steps: [
            {
              transitDetails: {
                transitLine: { name: 'AVE Madrid-Barcelona' },
                stopDetails: {
                  departureTime: '2026-08-01T09:30:00Z',
                  arrivalTime: '2026-08-01T12:15:00Z',
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

// Build a Routes API transit payload with a given duration (seconds) + line.
function routesPayload(durationSeconds: number, line: string): unknown {
  return {
    routes: [
      {
        duration: `${durationSeconds}s`,
        legs: [{ steps: [{ transitDetails: { transitLine: { name: line }, stopDetails: {} } }] }],
      },
    ],
  };
}

// Branch the fetch mock on URL so each mode can be controlled independently.
// Flights are a two-step API: `searchAirport` (city→ids) then `searchFlights`.
// Trains hit the Routes API `computeRoutes`. `airport` defaults to AIRPORT_OK
// so flight tests only need to provide the `sky` (searchFlights) payload.
function stubFetch(opts: { sky?: unknown; directions?: unknown; airport?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      let val: unknown;
      if (u.includes('searchAirport')) val = opts.airport ?? AIRPORT_OK;
      else if (u.includes('searchFlights')) val = opts.sky;
      else val = opts.directions;
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

    it('parses a sky-scrapper flight option', async () => {
      const result = await service.resolveTransportOptions({ from: 'MAD', to: 'BCN', departureDateIso: '2026-08-01' }, 'best');
      const flight = result.find((o) => o.mode === 'flight');
      expect(flight).toBeDefined();
      expect(flight!.priceEur).toBe(90);
      expect(flight!.durationMinutes).toBe(125);
      expect(flight!.flightNumber).toBe('FR1234'); // alternateId + segment flightNumber
      expect(flight!.provider).toBe('Ryanair');
      expect(flight!.departureTime).toBe('06:00');
      expect(flight!.arrivalTime).toBe('08:05');
    });
  });

  describe('train parsing', () => {
    beforeEach(() => {
      stubFetch({ sky: new Error('no flight'), directions: ROUTES_OK });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
    });

    it('parses a Routes API transit option', async () => {
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2099-08-01' }, 'best');
      const train = result.find((o) => o.mode === 'train');
      expect(train).toBeDefined();
      expect(train!.durationMinutes).toBe(165); // ceil(9900 / 60)
      expect(train!.departureTime).toBe('09:30');
      expect(train!.arrivalTime).toBe('12:15');
      expect(train!.trainLine).toBe('AVE Madrid-Barcelona');
      expect(train!.provider).toBe('Google Routes (est. fare)');
    });

    it('calls the Routes API computeRoutes endpoint with a TRANSIT/TRAIN request', async () => {
      await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2099-08-01' }, 'best');
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const routesCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('computeRoutes')) as [string, RequestInit];
      expect(routesCall).toBeDefined();
      expect(routesCall[0]).toContain('directions/v2:computeRoutes');
      const init = routesCall[1];
      expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-maps-key');
      expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('routes.duration');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body['travelMode']).toBe('TRANSIT');
      expect(body['transitPreferences']).toEqual({ allowedTravelModes: ['TRAIN'] });
      expect(typeof body['departureTime']).toBe('string');
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
      stubFetch({ sky: SKYSCANNER_OK, directions: ROUTES_OK });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      const modes = result.map((o) => o.mode);
      expect(modes).toContain('flight');
      expect(modes).toContain('train');
      expect(modes).toContain('car');
    });

    it('skips a failed mode without throwing while others succeed', async () => {
      stubFetch({ sky: new Error('429'), directions: ROUTES_OK });
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
      const cheapSky = flightsPayload({ priceRaw: 45, durationInMinutes: 55, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T06:55:00' });
      stubFetch({ sky: cheapSky, directions: ROUTES_OK });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'best');
      expect(result[0].mode).toBe('flight');
      expect(result[0].priceEur).toBe(45);
    });
  });

  // ── F4: preferred mode favoured, alternatives still shown ────────────
  describe('preference bias', () => {
    it('ranks the preferred mode first on a near-tie, keeping alternatives', async () => {
      // Flight slightly cheaper than train; with train preference the discount lifts train to first.
      const sky = flightsPayload({ priceRaw: 80, durationInMinutes: 90, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T07:30:00' });
      const directions = routesPayload(6000, 'AVE');
      stubFetch({ sky, directions });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].mode).toBe('train');
      // alternatives still present
      expect(result.find((o) => o.mode === 'flight')).toBeDefined();
    });

    it('still lets a clearly better option beat the preferred mode', async () => {
      // Flight much cheaper + faster than train; even with train preference, flight wins.
      const sky = flightsPayload({ priceRaw: 30, durationInMinutes: 50, departure: '2026-08-01T06:00:00', arrival: '2026-08-01T06:50:00' });
      const directions = routesPayload(18000, 'Regional');
      stubFetch({ sky, directions });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].mode).toBe('flight');
    });
  });

  // ── sky-scrapper two-step API contract ───────────────────────────────
  describe('sky-scrapper API call', () => {
    it('resolves airports then queries searchFlights with skyId/entityId + headers', async () => {
      stubFetch({ sky: SKYSCANNER_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await service.resolveTransportOptions({ from: 'Lisbon', to: 'Madrid', departureDateIso: '2099-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));

      // Step 1: two searchAirport lookups (origin + destination), city-only query.
      const airportCalls = calls.filter((u) => u.includes('searchAirport'));
      expect(airportCalls.length).toBe(2);
      expect(airportCalls[0]).toContain('/api/v1/flights/searchAirport');
      expect(airportCalls[0]).toContain('query=Lisbon');

      // Step 2: searchFlights with resolved ids.
      const flightCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('searchFlights')) as [string, RequestInit];
      const url = String(flightCall[0]);
      expect(url).toContain('/api/v2/flights/searchFlights');
      expect(url).toContain('originSkyId=MAD');
      expect(url).toContain('originEntityId=95565077');
      expect(url).toContain('currency=EUR');
      const headers = (flightCall[1].headers as Record<string, string>);
      expect(headers['X-RapidAPI-Key']).toBe('test-sky-key');
      expect(headers['X-RapidAPI-Host']).toBe('sky-scrapper.p.rapidapi.com');
    });

    it('clamps a far-future flight date to within the booking horizon', async () => {
      stubFetch({ sky: SKYSCANNER_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await service.resolveTransportOptions({ from: 'Lisbon', to: 'Madrid', departureDateIso: '2099-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes('searchFlights'))![0]);
      const date = new URL(url).searchParams.get('date')!;
      // far-future 2099 date must be clamped to near-term (well under ~1 year out)
      const days = (new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeLessThan(300);
      expect(days).toBeGreaterThan(0);
    });
  });

  // ── Feasibility / degraded-mode guard ────────────────────────────────
  describe('feasibility guard (flight/train APIs down → car-only)', () => {
    it('synthesises an estimated flight when a long leg resolves to car only', async () => {
      stubFetch({ sky: new Error('429'), directions: new Error('REQUEST_DENIED') });
      mapService = makeMapServiceMock({ durationMinutes: 1380 }); // 23h drive
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Oslo', to: 'Zagreb' }, 'train');

      const estFlight = result.find((o) => o.provider === 'estimate');
      expect(estFlight).toBeDefined();
      expect(estFlight!.mode).toBe('flight');
      expect(estFlight!.priceEur).toBeGreaterThan(0);
      expect(estFlight!.warnings.some((w) => w.toLowerCase().includes('estimate'))).toBe(true);
      // estimated flight is far better than a 23h drive → ranks ahead of car
      expect(result[0].mode).toBe('flight');
    });

    it('tags the car option with a degraded-mode warning on a long car-only leg', async () => {
      stubFetch({ sky: new Error('429'), directions: new Error('REQUEST_DENIED') });
      mapService = makeMapServiceMock({ durationMinutes: 1380 });
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Oslo', to: 'Zagreb' }, 'best');
      const car = result.find((o) => o.mode === 'car');
      expect(car!.warnings.some((w) => w.startsWith('Long drive'))).toBe(true);
      expect(car!.warnings.some((w) => w.toLowerCase().includes('unavailable'))).toBe(true);
    });

    it('does NOT synthesise a flight for a short car-only leg', async () => {
      stubFetch({ sky: new Error('x'), directions: new Error('y') });
      mapService = makeMapServiceMock({ durationMinutes: 120 }); // 2h drive
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Lisbon', to: 'Porto' }, 'best');
      expect(result.find((o) => o.provider === 'estimate')).toBeUndefined();
      expect(result.every((o) => o.mode === 'car')).toBe(true);
    });

    it('does NOT synthesise a flight when a real flight already exists on a long leg', async () => {
      stubFetch({ sky: SKYSCANNER_OK, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 1380 });
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Oslo', to: 'Zagreb' }, 'best');
      expect(result.find((o) => o.provider === 'estimate')).toBeUndefined();
      // car still flagged so the long drive is visible
      const car = result.find((o) => o.mode === 'car');
      expect(car!.warnings.some((w) => w.startsWith('Long drive'))).toBe(true);
    });
  });
});
