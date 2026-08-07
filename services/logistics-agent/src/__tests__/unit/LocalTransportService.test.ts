import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: 'test-maps-key',
    GOOGLE_ROUTES_BASE_URL: 'https://routes.googleapis.com',
    LOCAL_DRIVE_COST_EUR_PER_KM: 1.5,
    LOCAL_TRANSIT_FLAT_FARE_EUR: 2.0,
    LOCAL_WALK_MAX_KM: 1.5,
    LOCAL_TRANSIT_MOCK: false,
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

import { LocalTransportService } from '@/services/LocalTransportService';
import type { MapService } from '@/services/MapService';
import type { RedisService } from '@/services/RedisService';

function makeMapServiceMock(result?: Partial<Awaited<ReturnType<MapService['getTravelTime']>>>): MapService {
  return {
    getTravelTime: vi.fn().mockResolvedValue({
      from: 'Lisbon',
      to: 'Sintra',
      durationMinutes: 20,
      distanceKm: 5,
      mode: 'driving' as const,
      ...result,
    }),
  } as unknown as MapService;
}

const ROUTES_OK = {
  routes: [
    {
      duration: '1500s',
      legs: [{ steps: [{ transitDetails: { transitLine: { name: 'Metro Line M1' }, vehicle: undefined } }] }],
    },
  ],
};

function stubFetch(response: unknown | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(response), text: () => Promise.resolve('') });
    }),
  );
}

describe('LocalTransportService', () => {
  let mapService: MapService;

  beforeEach(() => {
    mapService = makeMapServiceMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resolves a drive candidate with a heuristic €/km price', async () => {
    stubFetch(ROUTES_OK);
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    const drive = options.find((o) => o.mode === 'drive');
    expect(drive).toBeDefined();
    expect(drive!.durationMinutes).toBe(20);
    expect(drive!.priceEur).toBe(8); // 5km * 1.5
  });

  it('resolves a transit candidate with real line/duration and a flat fare', async () => {
    stubFetch(ROUTES_OK);
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Airport');
    const transit = options.find((o) => o.mode === 'transit');
    expect(transit).toBeDefined();
    expect(transit!.durationMinutes).toBe(25); // ceil(1500/60)
    expect(transit!.transitLine).toBe('Metro Line M1');
    expect(transit!.priceEur).toBe(2.0);
  });

  it('surfaces the transit vehicle type when Google reports one (e.g. a metro line)', async () => {
    stubFetch({
      routes: [
        {
          duration: '900s',
          legs: [{ steps: [{ transitDetails: { transitLine: { name: 'Blue Line', vehicle: { type: 'SUBWAY' } } } }] }],
        },
      ],
    });
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Airport');
    const transit = options.find((o) => o.mode === 'transit');
    expect(transit!.transitVehicleType).toBe('SUBWAY');
  });

  it('falls back to drive-only when the transit API fails, without throwing', async () => {
    stubFetch(new Error('Routes API down'));
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    expect(options.find((o) => o.mode === 'transit')).toBeUndefined();
    expect(options.find((o) => o.mode === 'drive')).toBeDefined();
  });

  it('falls back to drive-only when Google returns zero routes', async () => {
    stubFetch({ routes: [] });
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    expect(options.find((o) => o.mode === 'transit')).toBeUndefined();
    expect(options.find((o) => o.mode === 'drive')).toBeDefined();
  });

  it('includes a free walk candidate when the drive distance is within the walk threshold', async () => {
    stubFetch(ROUTES_OK);
    mapService = makeMapServiceMock({ distanceKm: 0.8, durationMinutes: 10 });
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Nearby Cafe');
    const walk = options.find((o) => o.mode === 'walk');
    expect(walk).toBeDefined();
    expect(walk!.priceEur).toBe(0);
  });

  it('excludes walk when the drive distance exceeds the walk threshold', async () => {
    stubFetch(ROUTES_OK);
    mapService = makeMapServiceMock({ distanceKm: 5, durationMinutes: 20 });
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    expect(options.find((o) => o.mode === 'walk')).toBeUndefined();
  });

  it('throws when every mode fails', async () => {
    stubFetch(new Error('Routes API down'));
    mapService = { getTravelTime: vi.fn().mockRejectedValue(new Error('Maps down')) } as unknown as MapService;
    const service = new LocalTransportService(mapService);
    await expect(service.resolveCandidates('Lisbon', 'Museum')).rejects.toThrow('No local transport options found');
  });

  it('caches the transit result and does not re-fetch on a cache hit', async () => {
    stubFetch(ROUTES_OK);
    const cached = { mode: 'transit', durationMinutes: 15, priceEur: 2, warnings: [] };
    const redis = {
      get: vi.fn().mockResolvedValue(cached),
      set: vi.fn(),
    } as unknown as RedisService;
    const service = new LocalTransportService(mapService, redis);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    expect(options.find((o) => o.mode === 'transit')).toEqual(cached);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses fixture data instead of calling out when LOCAL_TRANSIT_MOCK is enabled', async () => {
    const { config } = await import('@/config');
    (config as { LOCAL_TRANSIT_MOCK: boolean }).LOCAL_TRANSIT_MOCK = true;
    stubFetch(new Error('should not be called'));
    const service = new LocalTransportService(mapService);
    const options = await service.resolveCandidates('Lisbon', 'Museum');
    expect(fetch).not.toHaveBeenCalled();
    expect(options.find((o) => o.mode === 'transit')).toBeDefined();
    (config as { LOCAL_TRANSIT_MOCK: boolean }).LOCAL_TRANSIT_MOCK = false;
  });
});
