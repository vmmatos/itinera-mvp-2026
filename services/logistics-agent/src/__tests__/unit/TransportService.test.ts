import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
    GOOGLE_MAPS_BASE_URL: 'https://maps.googleapis.com/maps/api',
    GOOGLE_ROUTES_BASE_URL: 'https://routes.googleapis.com',
    SERPAPI_KEY: 'test-serp-key',
    SERPAPI_BASE_URL: 'https://serpapi.com/search',
    AIRPORT_CACHE_TTL_SECONDS: 2592000,
    TRANSPORT_CACHE_TTL_SECONDS: 21600,
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
import type { PlacesService } from '@/services/PlacesService';

// SerpApi google_flights response (Madrid → Barcelona, one stop-free leg).
const SERP_OK = {
  best_flights: [
    {
      flights: [
        {
          departure_airport: { id: 'MAD', time: '2026-08-01 06:00' },
          arrival_airport: { id: 'BCN', time: '2026-08-01 08:05' },
          duration: 125,
          airline: 'Ryanair',
          flight_number: 'FR 1234',
        },
      ],
      layovers: [],
      total_duration: 125,
      price: 90,
    },
  ],
  other_flights: [],
};

// Build a SerpApi google_flights payload (single itinerary, nonstop).
function flightsPayload(opts: { price: number; duration: number; depTime: string; arrTime: string; airline?: string; flightNumber?: string }): unknown {
  return {
    best_flights: [
      {
        flights: [
          {
            departure_airport: { id: 'MAD', time: `2026-08-01 ${opts.depTime}` },
            arrival_airport: { id: 'BCN', time: `2026-08-01 ${opts.arrTime}` },
            duration: opts.duration,
            airline: opts.airline ?? 'TestAir',
            flight_number: opts.flightNumber ?? 'TA 1',
          },
        ],
        layovers: [],
        total_duration: opts.duration,
        price: opts.price,
      },
    ],
    other_flights: [],
  };
}

// Minimal PlacesService mock for geocode-based airport resolution.
function makePlacesMock(coord: { lat: number; lng: number } | null = null): PlacesService {
  return { geocodePlace: vi.fn().mockResolvedValue(coord) } as unknown as PlacesService;
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
// Flights hit SerpApi (`engine=google_flights`); trains hit the Routes API
// (`computeRoutes`). `sky` = the SerpApi flights payload, `directions` = Routes.
function stubFetch(opts: { sky?: unknown; directions?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      const val = u.includes('google_flights') || u.includes('serpapi.com') ? opts.sky : opts.directions;
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
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
    });

    it('parses a SerpApi google_flights option', async () => {
      // Madrid/Barcelona resolve to MAD/BCN via the embedded airports dataset.
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2026-08-01' }, 'best');
      const flight = result.find((o) => o.mode === 'flight');
      expect(flight).toBeDefined();
      expect(flight!.priceEur).toBe(90);
      expect(flight!.durationMinutes).toBe(125);
      expect(flight!.flightNumber).toBe('FR1234'); // spaces stripped from "FR 1234"
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
      stubFetch({ sky: SERP_OK, directions: ROUTES_OK });
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
      const cheapSky = flightsPayload({ price: 45, duration: 55, depTime: '06:00', arrTime: '06:55' });
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
      const sky = flightsPayload({ price: 80, duration: 90, depTime: '06:00', arrTime: '07:30' });
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
      const sky = flightsPayload({ price: 30, duration: 50, depTime: '06:00', arrTime: '06:50' });
      const directions = routesPayload(18000, 'Regional');
      stubFetch({ sky, directions });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].mode).toBe('flight');
    });
  });

  // ── SerpApi google_flights contract + airport resolution ─────────────
  describe('SerpApi google_flights call', () => {
    it('queries engine=google_flights with resolved IATA ids, one-way, no deep_search', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      // Lisbon→LIS, Madrid→MAD resolve via the embedded dataset (no geocode).
      await service.resolveTransportOptions({ from: 'Lisbon', to: 'Madrid', departureDateIso: '2099-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes('google_flights'))![0]);
      const params = new URL(url).searchParams;
      expect(params.get('engine')).toBe('google_flights');
      expect(params.get('departure_id')).toBe('LIS');
      expect(params.get('arrival_id')).toBe('MAD');
      expect(params.get('type')).toBe('2'); // one-way
      expect(params.get('currency')).toBe('EUR');
      expect(params.get('api_key')).toBe('test-serp-key');
      expect(params.has('deep_search')).toBe(false);
    });

    it('clamps a far-future flight date to within the booking horizon', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await service.resolveTransportOptions({ from: 'Lisbon', to: 'Madrid', departureDateIso: '2099-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes('google_flights'))![0]);
      const date = new URL(url).searchParams.get('outbound_date')!;
      const days = (new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeLessThan(300);
      expect(days).toBeGreaterThan(0);
    });

    it('resolves a region with no same-name airport via geocode → nearest airport', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
      // "Gargano e Salento" has no airport entry → geocode to a Puglia coord →
      // nearest airport is Bari (BRI). Origin "Madrid" resolves via dataset.
      const places = makePlacesMock({ lat: 41.7, lng: 16.0 });
      service = new TransportService(mapService, undefined, places);

      await service.resolveTransportOptions({ from: 'Madrid', to: 'Gargano e Salento', departureDateIso: '2099-09-10' }, 'best');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const url = String(fetchMock.mock.calls.find((c) => String(c[0]).includes('google_flights'))![0]);
      const params = new URL(url).searchParams;
      expect(params.get('departure_id')).toBe('MAD');
      expect(params.get('arrival_id')).toBe('BRI');
      expect((places.geocodePlace as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('Gargano e Salento');
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
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 1380 });
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Oslo', to: 'Zagreb' }, 'best');
      expect(result.find((o) => o.provider === 'estimate')).toBeUndefined();
      // car still flagged so the long drive is visible
      const car = result.find((o) => o.mode === 'car');
      expect(car!.warnings.some((w) => w.startsWith('Long drive'))).toBe(true);
    });
  });

  // ── Redis caching (protects scarce SerpApi quota) ───────────────────
  describe('caching', () => {
    function makeRedisMock(): { store: Map<string, unknown>; get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void> } {
      const store = new Map<string, unknown>();
      return {
        store,
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: unknown) => { store.set(k, v); },
      };
    }

    it('caches resolved legs so a repeat pair makes no new API calls', async () => {
      const redis = makeRedisMock();
      stubFetch({ sky: SERP_OK, directions: ROUTES_OK });
      service = new TransportService(mapService, redis as never);

      await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2099-08-01' }, 'best');
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const callsAfterFirst = fetchMock.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);

      // Second resolution of the same pair (different preference) → cache hit.
      const second = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2099-08-01' }, 'train');
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // no new network calls
      expect(second.length).toBeGreaterThan(0);
    });

    it('caches airport id lookups', async () => {
      const redis = makeRedisMock();
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
      service = new TransportService(mapService, redis as never);

      await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona', departureDateIso: '2099-08-01' }, 'best');
      expect(redis.store.has('transport:airport:madrid')).toBe(true);
      expect(redis.store.has('transport:airport:barcelona')).toBe(true);
    });
  });
});
