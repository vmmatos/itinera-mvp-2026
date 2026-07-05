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
    MIN_FLIGHT_DISTANCE_KM: 300,
    MAX_AIRPORT_SNAP_KM: 300,
    CAR_COST_EUR_PER_KM: 0.22,
    TRANSPORT_WEIGHT_COST: 0.6,
    TRANSPORT_WEIGHT_DURATION: 40,
    TRANSPORT_WEIGHT_PREFERENCE: 0.18,
    TRANSPORT_WEIGHT_TRANSFERS: 15,
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
import { byCity } from '@/data/airports';
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
      expect(train!.provider).toBe('AVE Madrid-Barcelona'); // trainLine doubles as display provider
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
      // fuel+tolls heuristic: 600 km × €0.22 — car must carry a price so the
      // weighted ranking compares it fairly against priced modes
      expect(car!.priceEur).toBe(132);
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

  // ── Destination hub access time (rural city via HubLookup) ─────────
  describe('destination hub access time', () => {
    beforeEach(() => {
      // Only flight mode; train + car disabled so assertion is unambiguous.
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));
    });

    it('adds access time + cost when destination resolves via HubLookup (Mértola→Faro/FAO)', async () => {
      // Mértola has no own airport — HubLookup resolves it to Faro (FAO, 90 min, €15 by bus).
      // fetchFlights must add these to durationMinutes + priceEur so scoring is door-to-door.
      const result = await service.resolveTransportOptions(
        { from: 'Lisbon', to: 'Mértola', departureDateIso: '2026-08-01' },
        'best',
      );
      const flight = result.find((o) => o.mode === 'flight');
      expect(flight).toBeDefined();
      // SERP_OK: 125 min airborne + 90 min FAO→Mértola ground leg
      expect(flight!.durationMinutes).toBe(215);
      // SERP_OK: €90 fare + €9 bus access (Mértola→Faro accessCostEur=9)
      expect(flight!.priceEur).toBe(99);
      expect(flight!.warnings.some((w) => w.includes('transfer') && w.includes('Mértola'))).toBe(true);
    });

    it('does NOT add extra time when destination has its own direct airport (Barcelona→BCN)', async () => {
      // Barcelona resolves to BCN via byCity() directly — no HubLookup, no access leg.
      const result = await service.resolveTransportOptions(
        { from: 'Lisbon', to: 'Barcelona', departureDateIso: '2026-08-01' },
        'best',
      );
      const flight = result.find((o) => o.mode === 'flight');
      expect(flight).toBeDefined();
      expect(flight!.durationMinutes).toBe(125); // unchanged from SerpApi total_duration
      expect(flight!.priceEur).toBe(90); // unchanged
      expect(flight!.warnings.every((w) => !w.includes('transfer'))).toBe(true);
    });
  });

  // ── Origin airport resolution: no geocode allowed for origins ────────
  describe('origin airport resolution', () => {
    it('does not geocode origin cities — only byCity dataset allowed for flight origins', async () => {
      // Beja has no entry in the byCity airport dataset.
      // Places geocoding is disabled for origin role, so Beja must not resolve
      // to FAO (50km away) — otherwise MultiLegRouter would silently skip the
      // 50km Beja→FAO leg and claim a Beja departure.
      const places = makePlacesMock({ lat: 37.0, lng: -7.9 });
      service = new TransportService(mapService, undefined, places);
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await expect(
        service.resolveTransportOptions({ from: 'Beja', to: 'Comporta' }, 'best'),
      ).rejects.toThrow();
      // Geocoding for the distance guard is fine; what must never happen is a
      // flight search departing from an airport snapped to a rural origin.
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('google_flights'))).toBe(false);
    });
  });

  // ── Preference override warning ───────────────────────────────────────
  describe('preference override warning', () => {
    it('adds a warning to the selected option when it overrides a significantly slower preferred mode', async () => {
      // Flight: 2h €80. Car (preferred): 8h. Ratio 4× > 1.5 threshold → warning on flight.
      const sky = flightsPayload({ price: 80, duration: 120, depTime: '10:00', arrTime: '12:00' });
      stubFetch({ sky, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 480 });
      service = new TransportService(mapService);

      const result = await service.resolveTransportOptions({ from: 'Lisbon', to: 'Barcelona' }, 'car');
      expect(result[0].mode).toBe('flight');
      expect(result[0].warnings.some((w) => w.includes('car preference overridden'))).toBe(true);
      expect(result[0].warnings.some((w) => w.includes('8h'))).toBe(true);
    });

    it('does NOT add override warning when preferred mode loses by less than 1.5×', async () => {
      // Flight: 2h. Train (preferred): 2.5h. Ratio 1.25 < 1.5 threshold → no warning.
      const sky = flightsPayload({ price: 80, duration: 120, depTime: '06:00', arrTime: '08:00' });
      stubFetch({ sky, directions: routesPayload(9000, 'IC') }); // 9000s = 150min
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'train');
      expect(result[0].warnings.every((w) => !w.includes('preference overridden'))).toBe(true);
    });
  });

  // ── Distance guard: no flights on short land legs ───────────────────
  describe('minimum flight distance guard', () => {
    // Per-place geocode mock so the guard can measure real geodesic distance.
    function makeGeoMock(coords: Record<string, { lat: number; lng: number }>): PlacesService {
      return {
        geocodePlace: vi.fn((place: string) => Promise.resolve(coords[place] ?? null)),
      } as unknown as PlacesService;
    }

    const RURAL_PT = {
      'Mértola': { lat: 37.64, lng: -7.66 },
      'Comporta': { lat: 38.38, lng: -8.79 },
    };

    it('never searches flights for a short rural pair (Mértola→Comporta) and ranks the drive first', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 150, distanceKm: 150 });
      service = new TransportService(mapService, undefined, makeGeoMock(RURAL_PT));

      const result = await service.resolveTransportOptions({ from: 'Mértola', to: 'Comporta' }, 'car');

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('google_flights'))).toBe(false);
      expect(result.some((o) => o.mode === 'flight' || o.segments?.some((s) => s.mode === 'flight'))).toBe(false);
      expect(result[0].mode).toBe('car');
      expect(result[0].priceEur).toBe(33); // 150 km × €0.22
    });

    it('does NOT synthesise an estimated flight for a long drive on a short geodesic leg', async () => {
      // 320-min mountain drive but <300 km as the crow flies → no plausible air route.
      stubFetch({ sky: new Error('x'), directions: new Error('y') });
      mapService = makeMapServiceMock({ durationMinutes: 320, distanceKm: 280 });
      service = new TransportService(mapService, undefined, makeGeoMock(RURAL_PT));

      const result = await service.resolveTransportOptions({ from: 'Mértola', to: 'Comporta' }, 'best');
      expect(result.find((o) => o.provider === 'estimate')).toBeUndefined();
      const car = result.find((o) => o.mode === 'car');
      expect(car!.warnings.some((w) => w.startsWith('Long drive'))).toBe(true);
      expect(car!.warnings.some((w) => w.includes('estimate'))).toBe(false);
    });

    it('keeps flights enabled between two true airport cities regardless of distance (Lisboa→Porto)', async () => {
      // ~274 km — below the guard threshold, but both endpoints have their own
      // airports so the route is real, not fabricated.
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      const result = await service.resolveTransportOptions({ from: 'Lisbon', to: 'Porto' }, 'best');
      expect(result.some((o) => o.mode === 'flight')).toBe(true);
    });

    it('keeps flights enabled when geocoding is unavailable (never block for lack of data)', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      // No PlacesService → distance unknown → guard is a no-op.
      const result = await service.resolveTransportOptions({ from: 'Lisbon', to: 'Mértola' }, 'best');
      expect(result.some((o) => o.mode === 'flight')).toBe(true);
    });
  });

  // ── Hybrid drive-to-hub composition (organic car+flight option) ──────
  describe('drive-to-hub hybrid', () => {
    it('composes car-to-airport + flight for a long leg from a city without its own airport', async () => {
      // Mértola→Barcelona (~990 km): no Mértola airport, so alongside the static
      // hub routes the service must offer "drive to a nearby airport, then fly".
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 110, distanceKm: 120 });
      const places = {
        geocodePlace: vi.fn((place: string) =>
          Promise.resolve(place === 'Mértola' ? { lat: 37.64, lng: -7.66 } : null)),
      } as unknown as PlacesService;
      service = new TransportService(mapService, undefined, places);

      const result = await service.resolveTransportOptions({ from: 'Mértola', to: 'Barcelona' }, 'car');

      const hybrid = result.find(
        (o) => o.segments?.length === 2 && o.segments[0].mode === 'car' && o.segments[1].mode === 'flight',
      );
      expect(hybrid).toBeDefined();
      expect(hybrid!.segments![0].from).toBe('Mértola');
      expect(hybrid!.segments![0].priceEur).toBe(26); // 120 km × €0.22
      expect(hybrid!.durationMinutes).toBe(110 + 125); // drive + SERP_OK flight
      expect(hybrid!.priceEur).toBe(26 + 90);
      expect(hybrid!.displaySummary).toContain('Car + Flight');
    });

    it('does not compose drive-to-hub when the origin has its own airport', async () => {
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      const result = await service.resolveTransportOptions({ from: 'Madrid', to: 'Barcelona' }, 'car');
      expect(
        result.find((o) => o.segments?.length === 2 && o.segments[0].mode === 'car' && o.segments[1].mode === 'flight'),
      ).toBeUndefined();
    });
  });

  // ── Detour cap ────────────────────────────────────────────────────────
  describe('detour cap', () => {
    it('drops composed routes that take much longer than simply driving', async () => {
      // Direct drive 110 min; any composed option above 2.5× (275 min) is an
      // absurd detour and must not survive.
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      mapService = makeMapServiceMock({ durationMinutes: 110, distanceKm: 120 });
      const places = {
        geocodePlace: vi.fn((place: string) =>
          Promise.resolve(place === 'Mértola' ? { lat: 37.64, lng: -7.66 } : null)),
      } as unknown as PlacesService;
      service = new TransportService(mapService, undefined, places);

      const result = await service.resolveTransportOptions({ from: 'Mértola', to: 'Barcelona' }, 'best');
      for (const o of result.filter((x) => x.segments)) {
        expect(o.durationMinutes).toBeLessThanOrEqual(110 * 2.5);
      }
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
      // Keys are role-prefixed: origins resolve dataset-only, destinations may
      // also geocode/hub-resolve, so the two roles cannot share cache entries.
      expect(redis.store.has('transport:airport:origin:madrid')).toBe(true);
      expect(redis.store.has('transport:airport:destination:barcelona')).toBe(true);
    });
  });

  // ── Intercontinental coverage: dataset aliases ─────────────────────────
  describe('airport dataset aliases', () => {
    it('resolves Bali and Cabo Verde to their real airports', () => {
      expect(byCity('Bali')?.iata).toBe('DPS');
      expect(byCity('Denpasar')?.iata).toBe('DPS');
      expect(byCity('Cabo Verde')?.iata).toBe('SID');
      expect(byCity('Cape Verde')?.iata).toBe('SID');
      expect(byCity('Praia')?.iata).toBe('RAI');
    });
  });

  // ── Airport snap distance cap ──────────────────────────────────────────
  describe('airport snap distance cap', () => {
    it('rejects a geocode snap to an airport beyond MAX_AIRPORT_SNAP_KM', async () => {
      // Destination geocodes to the mid-Atlantic — nearest dataset airport is
      // ~2000km away. Without the cap it would snap there and search a flight
      // landing in the wrong country; with the cap resolution must fail.
      const places = makePlacesMock({ lat: 10, lng: -40 });
      service = new TransportService(mapService, undefined, places);
      stubFetch({ sky: SERP_OK, directions: new Error('no train') });
      (mapService.getTravelTime as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no car'));

      await expect(
        service.resolveTransportOptions({ from: 'Lisbon', to: 'Remote Atoll' }, 'best'),
      ).rejects.toThrow();
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('google_flights'))).toBe(false);
    });
  });

  // ── Distance-aware last-resort estimate ────────────────────────────────
  describe('estimateLeg', () => {
    it('returns a flight estimate for a long leg (Lisbon→Denpasar)', async () => {
      const est = await service.estimateLeg({ from: 'Lisbon', to: 'Denpasar' });
      expect(est.mode).toBe('flight');
      expect(est.provider).toBe('estimate');
      expect(est.durationMinutes).toBeGreaterThan(600); // ~12800km, never "2h"
      expect(est.warnings.some((w) => w.includes('estimated flight'))).toBe(true);
    });

    it('returns a distance-based car estimate for a short leg (Sevilla→Malaga)', async () => {
      const est = await service.estimateLeg({ from: 'Sevilla', to: 'Malaga' });
      expect(est.mode).toBe('car');
      expect(est.durationMinutes).toBeGreaterThan(60); // ~150km at 80km/h
      expect(est.durationMinutes).toBeLessThan(180);
      expect(est.priceEur).toBeGreaterThan(0);
      expect(est.warnings.some((w) => w.includes('estimate only'))).toBe(true);
    });

    it('falls back to the generic 2h car placeholder when distance is unknown', async () => {
      // No PlacesService and neither city is in the dataset → geodesicKm undefined.
      const est = await service.estimateLeg({ from: 'Nowhere', to: 'Elsewhere' });
      expect(est.mode).toBe('car');
      expect(est.durationMinutes).toBe(120);
      expect(est.warnings.some((w) => w.includes('estimate only'))).toBe(true);
    });
  });
});
