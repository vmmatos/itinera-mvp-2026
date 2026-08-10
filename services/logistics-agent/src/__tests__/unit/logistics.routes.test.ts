import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    errorHandler: (
      err: Error & { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode ?? 400).json({ success: false, error: { message: err.message } });
    },
  };
});

vi.mock('@/config', () => ({
  config: {
    WEATHER_CACHE_TTL_SECONDS: 1800,
    CACHE_TTL_SECONDS: 3600,
    MEALS_PER_DAY: 2,
    NODE_ENV: 'test',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

import { createLogisticsRouter } from '@/routes/logistics';
import type { WeatherService, WeatherForecast } from '@/services/WeatherService';
import type { AttractionDB } from '@/services/AttractionDB';
import type { RedisService } from '@/services/RedisService';
import type { TimingValidator } from '@/validators/TimingValidator';
import type { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import { HolidayService } from '@/services/HolidayService';
import { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import type { Place } from '@/services/PlacesService';
import type { TransportService } from '@/services/TransportService';
import type { PricingEnricher } from '@/services/PricingEnricher';
import type { ActivityTransportResolver } from '@/services/ActivityTransportResolver';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const VALID_ITINERARY_DAY = {
  day: 1,
  date: '2026-06-01',
  activities: [
    {
      name: 'Eiffel Tower',
      startTime: '10:00',
      endTime: '12:00',
      location: 'Eiffel Tower',
      isOutdoor: true,
    },
  ],
  transport: [],
};

const MOCK_FORECAST: WeatherForecast = {
  region: 'Paris',
  date: '2026-06-01',
  temperature: { min: 15, max: 25, unit: 'celsius' },
  conditions: 'Clear',
  humidity: 50,
  windSpeed: 15,
  description: 'clear sky',
  precipitationProbability: 20,
};

const MOCK_PLACES: Place[] = [
  {
    id: 'place-1',
    name: 'Eiffel Tower',
    location: { lat: 48.8584, lng: 2.2945 },
    category: 'tourist_attraction',
    rating: 4.7,
    priceLevel: null,
    openingHours: { Monday: '9:00-23:45' },
    metadata: {},
  },
];

const MOCK_TIMING_RESULT = { valid: true, conflicts: [], warnings: [] };

const MOCK_AGENT_EVENT = {
  tripId: VALID_UUID,
  type: 'agent.propose',
  agent: 'logistics',
  round: 1,
  timestamp: new Date().toISOString(),
  content: { overallRisk: 'low', dayAssessments: [], timingIssues: [], summary: 'Good weather.' },
};

const mockWeather = { getForecast: vi.fn(), getMultiDayForecast: vi.fn() } as unknown as WeatherService;
const mockAttractions = { getAttractions: vi.fn() } as unknown as AttractionDB;
const mockRedis = { get: vi.fn(), set: vi.fn() } as unknown as RedisService;
const mockTiming = { validate: vi.fn() } as unknown as TimingValidator;
const mockAnalyzer = { analyze: vi.fn() } as unknown as WeatherAnalyzer;
const mockHolidayService = { getHolidays: vi.fn() } as unknown as HolidayService;
const mockRestrictionsValidator = { validate: vi.fn() } as unknown as RestrictionsValidator;
const mockTransportService = {
  resolveTransportOptions: vi.fn().mockResolvedValue([{
    mode: 'car',
    provider: 'Google Maps',
    durationMinutes: 120,
    warnings: [],
  }]),
  estimateLeg: vi.fn().mockResolvedValue({
    mode: 'car',
    durationMinutes: 120,
    warnings: ['No transport options found — estimate only'],
  }),
} as unknown as TransportService;
const mockPricingEnricher = {
  enrich: vi.fn().mockResolvedValue({
    accommodationByCity: {},
    restaurantPricePerMeal: { amount: 25, isEstimate: true, source: 'heuristic_estimate' },
    activityPriceByName: {},
  }),
} as unknown as PricingEnricher;
const mockActivityTransportResolver = {
  resolveForItinerary: vi.fn().mockResolvedValue({ itinerary: [], satelliteLegs: [] }),
} as unknown as ActivityTransportResolver;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createLogisticsRouter(
    mockWeather, mockAttractions, mockTiming, mockAnalyzer, mockRedis,
    mockHolidayService, mockRestrictionsValidator, mockTransportService, mockPricingEnricher,
    mockActivityTransportResolver,
  ));
  app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe('POST /validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.get).mockResolvedValue(null);
    vi.mocked(mockRedis.set).mockResolvedValue(undefined);
    vi.mocked(mockWeather.getMultiDayForecast).mockResolvedValue([MOCK_FORECAST]);
    vi.mocked(mockTiming.validate).mockReturnValue(MOCK_TIMING_RESULT);
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue(MOCK_AGENT_EVENT);
    vi.mocked(mockAttractions.getAttractions).mockResolvedValue(MOCK_PLACES);
    vi.mocked(mockHolidayService.getHolidays).mockResolvedValue([]);
    vi.mocked(mockRestrictionsValidator.validate).mockReturnValue({ warnings: [] });
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'car',
      provider: 'Google Maps',
      durationMinutes: 120,
      warnings: [],
    }]);
  });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: 'not-a-uuid',
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });
    expect(res.status).toBe(400);
  });

  it('200 when region is missing (defaults to unknown)', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('validation');
  });

  it('200 when itinerary is empty (validates empty schedule)', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [] },
      region: 'Paris',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('validation');
  });

  it('400 when round is less than 1', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 0,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });
    expect(res.status).toBe(400);
  });

  it('200 when activity has invalid startTime format (flexible schema skips malformed entries)', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: {
        itinerary: [{
          day: 1,
          activities: [{ name: 'Test', startTime: '9:00', endTime: '10:00', location: 'Loc', isOutdoor: false }],
          transport: [],
        }],
      },
      region: 'Paris',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('validation');
  });

  it('200 returns validation AgentEvent on valid input', async () => {
    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    expect(res.body.validation).toBeDefined();
    expect(res.body.validation.agent).toBe('logistics');
  });

  it('calls TimingValidator with extracted activities and transport', async () => {
    const app = buildApp();
    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });

    expect(mockTiming.validate).toHaveBeenCalledOnce();
    const [activities] = (mockTiming.validate as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
    expect(activities).toHaveLength(1);
    expect((activities[0] as { name: string }).name).toBe('Eiffel Tower');
  });

  it('uses Redis cache for weather when available', async () => {
    vi.mocked(mockRedis.get).mockResolvedValue([MOCK_FORECAST]);

    const app = buildApp();
    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });

    expect(mockWeather.getMultiDayForecast).not.toHaveBeenCalled();
  });

  it('fetches and caches weather on cache miss', async () => {
    const app = buildApp();
    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });

    expect(mockWeather.getMultiDayForecast).toHaveBeenCalledOnce();
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('Paris'),
      expect.any(Array),
      1800,
    );
  });

  // ── Flexible dateInput ────────────────────────────────────────

  it('flexible mode: passes dateInput to analyzer.analyze', async () => {
    const app = buildApp();
    const dateInput = { mode: 'flexible', days: 7, preferredMonth: '2026-07', window: 'moderate' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockAnalyzer.analyze).toHaveBeenCalledWith(
      VALID_UUID, 1, expect.any(Array), expect.any(Array), expect.any(Object), dateInput, expect.any(Array), undefined,
    );
  });

  it('flexible mode: fetches days + 7 days of weather', async () => {
    const app = buildApp();
    const dateInput = { mode: 'flexible', days: 7, preferredMonth: '2026-07', window: 'moderate' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockWeather.getMultiDayForecast).toHaveBeenCalledWith('Paris', 14); // 7 + 7
  });

  it('flexible mode: uses flex month-scoped cache key', async () => {
    const app = buildApp();
    const dateInput = { mode: 'flexible', days: 7, preferredMonth: '2026-07', window: 'moderate' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockRedis.get).toHaveBeenCalledWith('weather:Paris:flex:2026-07');
  });

  it('flexible mode without preferredMonth: skips weather fetch entirely', async () => {
    const app = buildApp();
    const dateInput = { mode: 'flexible', days: 5, window: 'open' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockWeather.getMultiDayForecast).not.toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalledWith(expect.stringContaining('flex'));
  });

  it('flexible mode without preferredMonth: passes empty forecasts to analyzer', async () => {
    const app = buildApp();
    const dateInput = { mode: 'flexible', days: 5, window: 'open' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockAnalyzer.analyze).toHaveBeenCalledWith(
      VALID_UUID, 1, expect.any(Array), [], expect.any(Object), dateInput, expect.any(Array), undefined,
    );
  });

  it('attaches pricing enrichment to the validation content', async () => {
    vi.mocked(mockPricingEnricher.enrich).mockResolvedValue({
      accommodationByCity: { Paris: { amount: 90, isEstimate: false, source: 'serpapi_google_hotels' } },
      restaurantPricePerMeal: { amount: 25, isEstimate: false, source: 'google_places_price_level' },
      activityPriceByName: {},
    });

    const app = buildApp();
    const res = await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    expect(res.body.validation.content.pricing).toEqual({
      accommodationByCity: { Paris: { amount: 90, isEstimate: false, source: 'serpapi_google_hotels' } },
      restaurantPricePerMeal: { amount: 25, isEstimate: false, source: 'google_places_price_level' },
      activityPriceByName: {},
    });
  });

  it('fixed mode: uses standard multi cache key and standard day count', async () => {
    const app = buildApp();
    const dateInput = { mode: 'fixed', startDate: '2026-07-01', endDate: '2026-07-08' };

    await request(app).post('/validate').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [VALID_ITINERARY_DAY] },
      region: 'Paris',
      dateInput,
    });

    expect(mockRedis.get).toHaveBeenCalledWith('weather:Paris:multi');
    expect(mockWeather.getMultiDayForecast).toHaveBeenCalledWith('Paris', 2); // max(1,1)+1
  });
});

describe('GET /attractions/:region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockAttractions.getAttractions).mockResolvedValue(MOCK_PLACES);
  });

  it('200 returns attractions for region', async () => {
    const app = buildApp();
    const res = await request(app).get('/attractions/Paris');

    expect(res.status).toBe(200);
    expect(res.body.attractions).toHaveLength(1);
    expect(res.body.attractions[0].name).toBe('Eiffel Tower');
    expect(res.body.cachedAt).toBeDefined();
  });

  it('passes category query param to AttractionDB', async () => {
    const app = buildApp();
    await request(app).get('/attractions/Paris?category=museum');

    expect(mockAttractions.getAttractions).toHaveBeenCalledWith('Paris', 'museum');
  });

  it('passes undefined category when not provided', async () => {
    const app = buildApp();
    await request(app).get('/attractions/Paris');

    expect(mockAttractions.getAttractions).toHaveBeenCalledWith('Paris', undefined);
  });
});

describe('GET /weather/:region', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.get).mockResolvedValue(null);
    vi.mocked(mockRedis.set).mockResolvedValue(undefined);
    vi.mocked(mockWeather.getForecast).mockResolvedValue(MOCK_FORECAST);
  });

  it('200 returns weather for region', async () => {
    const app = buildApp();
    const res = await request(app).get('/weather/Paris');

    expect(res.status).toBe(200);
    expect(res.body.weather.region).toBe('Paris');
    expect(res.body.weather.conditions).toBe('Clear');
    expect(res.body.cachedAt).toBeDefined();
  });

  it('returns cached weather when available', async () => {
    vi.mocked(mockRedis.get).mockResolvedValue(MOCK_FORECAST);

    const app = buildApp();
    const res = await request(app).get('/weather/Paris');

    expect(mockWeather.getForecast).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body.weather.region).toBe('Paris');
  });

  it('fetches and caches weather on cache miss', async () => {
    const app = buildApp();
    await request(app).get('/weather/Paris?date=2026-06-01');

    expect(mockWeather.getForecast).toHaveBeenCalledWith('Paris', '2026-06-01');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'weather:Paris:2026-06-01',
      MOCK_FORECAST,
      1800,
    );
  });

  it('uses "current" as cache key suffix when date is not provided', async () => {
    const app = buildApp();
    await request(app).get('/weather/Paris');

    expect(mockRedis.get).toHaveBeenCalledWith('weather:Paris:current');
  });
});

describe('POST /plan — transit slot blocking', () => {
  const PLAN_BASE = {
    tripId: VALID_UUID,
    budgetTotal: 2000,
    budgetCurrency: 'EUR',
    groupSize: 2,
    transportPreference: 'best',
    dateInput: { mode: 'fixed', startDate: '2026-07-10', endDate: '2026-07-12' },
    destinations: [
      { city: 'Comporta', country: 'Portugal', nights: 1 },
      { city: 'Mertola', country: 'Portugal', nights: 1 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.get).mockResolvedValue(null);
    vi.mocked(mockRedis.set).mockResolvedValue(undefined);
  });

  it('reserves meals in the budget envelope before splitting accommodation/experiences', async () => {
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'bus',
      durationMinutes: 120,
      departureTime: '07:00',
      arrivalTime: '09:00',
      priceEur: 100,
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    // 2 nights → 3 days × 2 meals × €25 = €150/person reserved for meals.
    expect(res.body.routeGraph.mealsReserveEurPerPerson).toBe(150);
    // budgetPerPerson 1000 − transport 100 − meals 150 = 750 experience budget;
    // accommodation = 750 × 0.35 / 2 nights = 131.25 → 131/night.
    expect(res.body.routeGraph.cityStays[0].budgetPerPersonPerNight).toBe(131);
  });

  it('short inbound (2h, 07:00→09:00): only morning blocked as inbound-transit', async () => {
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'bus',
      durationMinutes: 120,
      departureTime: '07:00',
      arrivalTime: '09:00',
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    const mertola = res.body.routeGraph.cityStays[1];
    const windows: { slot: string; isTransitDay: boolean; blockedReason?: string }[] = mertola.timeWindows;

    expect(windows.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-transit' });
    expect(windows.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: false });
    expect(windows.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: false });
  });

  it('afternoon departure (15:37): travel day belongs to the ORIGIN — morning free there, afternoon+evening outbound', async () => {
    // Departing at/after noon means the traveller spends the travel date in
    // the origin city: free slots before departure, outbound-transit after.
    // The destination's stay does not emit windows for that date.
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'bus',
      durationMinutes: 293,
      departureTime: '15:37',
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    const comporta = res.body.routeGraph.cityStays[0];
    const cw: { date: string; slot: string; isTransitDay: boolean; blockedReason?: string }[] = comporta.timeWindows;

    // Regular stay day (2026-07-10) untouched.
    expect(cw.filter(w => w.date === '2026-07-10').every(w => !w.isTransitDay)).toBe(true);
    // Travel date (2026-07-11) gained by the origin: morning free, then outbound.
    const travelDay = cw.filter(w => w.date === '2026-07-11');
    expect(travelDay.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: false });
    expect(travelDay.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: true, blockedReason: 'outbound-transit' });
    expect(travelDay.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: true, blockedReason: 'outbound-transit' });

    // Destination (1-night stay consumed by the late arrival) emits no windows for that date.
    const mertola = res.body.routeGraph.cityStays[1];
    const mw: { date: string }[] = mertola.timeWindows;
    expect(mw.filter(w => w.date === '2026-07-11')).toHaveLength(0);
  });

  it('early-morning flight (05:45→07:30): previous day fully free, travel day blocks morning only', async () => {
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'flight',
      durationMinutes: 165,
      departureTime: '05:45',
      arrivalTime: '07:30',
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    const comporta = res.body.routeGraph.cityStays[0];
    expect((comporta.timeWindows as { isTransitDay: boolean }[]).every(w => !w.isTransitDay)).toBe(true);

    const mertola = res.body.routeGraph.cityStays[1];
    const windows: { slot: string; isTransitDay: boolean; blockedReason?: string }[] = mertola.timeWindows;
    expect(windows.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-transit' });
    expect(windows.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: false });
    expect(windows.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: false });
  });

  it('evening flight landing past midnight (21:15→00:10): origin keeps the day until the evening slot, destination starts next day with recovery morning', async () => {
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'flight',
      durationMinutes: 197,
      departureTime: '21:15',
      arrivalTime: '00:10',
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send({
      ...PLAN_BASE,
      dateInput: { mode: 'fixed', startDate: '2026-07-10', endDate: '2026-07-13' },
      destinations: [
        { city: 'Comporta', country: 'Portugal', nights: 1 },
        { city: 'Barcelona', country: 'Spain', nights: 2 },
      ],
    });

    expect(res.status).toBe(200);

    // Origin owns the travel date: morning+afternoon free for activities,
    // evening is the journey.
    const comporta = res.body.routeGraph.cityStays[0];
    const cw: { date: string; slot: string; isTransitDay: boolean; blockedReason?: string }[] = comporta.timeWindows;
    const travelDay = cw.filter(w => w.date === '2026-07-11');
    expect(travelDay.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: false });
    expect(travelDay.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: false });
    expect(travelDay.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: true, blockedReason: 'outbound-transit' });

    // Destination: no windows on the travel date; first day starts the
    // morning after with recovery (landed at 00:10), rest free.
    const barcelona = res.body.routeGraph.cityStays[1];
    const bw: { date: string; slot: string; isTransitDay: boolean; blockedReason?: string }[] = barcelona.timeWindows;
    expect(bw.filter(w => w.date === '2026-07-11')).toHaveLength(0);
    const day2 = bw.filter(w => w.date === '2026-07-12');
    expect(day2.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-recovery' });
    expect(day2.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: false });
    expect(day2.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: false });
  });

  it('no departure time, long duration (5h): fallback blocks morning+afternoon inbound on the travel day', async () => {
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'car',
      durationMinutes: 300,
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    const mertola = res.body.routeGraph.cityStays[1];
    const mertolaWindows: { slot: string; isTransitDay: boolean; blockedReason?: string }[] = mertola.timeWindows;

    expect(mertolaWindows.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-transit' });
    expect(mertolaWindows.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-recovery' });
    expect(mertolaWindows.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: false });

    const comporta = res.body.routeGraph.cityStays[0];
    const comportaWindows: { slot: string; isTransitDay: boolean }[] = comporta.timeWindows;
    expect(comportaWindows.every(w => !w.isTransitDay)).toBe(true);
  });

  it('short car leg with no times (2.5h): morning blocked assuming a 09:00 departure', async () => {
    // Car options carry no departure/arrival times. A morning-consuming drive
    // must still block the morning — travel-consumed slots never hold activities.
    vi.mocked(mockTransportService.resolveTransportOptions).mockResolvedValue([{
      mode: 'car',
      durationMinutes: 150,
      warnings: [],
    }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send(PLAN_BASE);

    expect(res.status).toBe(200);
    const mertola = res.body.routeGraph.cityStays[1];
    const windows: { slot: string; isTransitDay: boolean; blockedReason?: string }[] = mertola.timeWindows;

    expect(windows.find(w => w.slot === 'morning')).toMatchObject({ isTransitDay: true, blockedReason: 'inbound-transit' });
    expect(windows.find(w => w.slot === 'afternoon')).toMatchObject({ isTransitDay: false });
    expect(windows.find(w => w.slot === 'evening')).toMatchObject({ isTransitDay: false });
  });

  it('failed leg resolution keeps orderedLegs aligned with cityStays (placeholder, not dropped)', async () => {
    // First leg fails, second resolves. Dropping the failure would shift the
    // second leg into slot 0 and misalign every cityStay's inbound/outbound.
    vi.mocked(mockTransportService.resolveTransportOptions)
      .mockRejectedValueOnce(new Error('No transport options found'))
      .mockResolvedValueOnce([{ mode: 'bus', durationMinutes: 120, departureTime: '07:00', arrivalTime: '09:00', warnings: [] }]);

    const app = buildApp();
    const res = await request(app).post('/plan').send({
      ...PLAN_BASE,
      dateInput: { mode: 'fixed', startDate: '2026-07-10', endDate: '2026-07-13' },
      destinations: [
        { city: 'Comporta', country: 'Portugal', nights: 1 },
        { city: 'Mertola', country: 'Portugal', nights: 1 },
        { city: 'Faro', country: 'Portugal', nights: 1 },
      ],
    });

    expect(res.status).toBe(200);
    const legs: { from: string; to: string; bestOption: { warnings: string[] } }[] = res.body.routeGraph.orderedLegs;
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ from: 'Comporta', to: 'Mertola' });
    expect(legs[1]).toMatchObject({ from: 'Mertola', to: 'Faro' });
    // Failed leg falls back to the distance-aware estimate with a visible warning.
    expect(legs[0].bestOption.warnings.some((w) => w.includes('estimate'))).toBe(true);
    expect(mockTransportService.estimateLeg).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Comporta', to: 'Mertola' }),
    );
  });

  it('failed long leg falls back to a flight estimate, never a short drive', async () => {
    // Bali→Cabo Verde: every real mode fails; estimateLeg (distance-aware)
    // returns a synthesised flight instead of the old fixed 2h-car placeholder.
    vi.mocked(mockTransportService.resolveTransportOptions)
      .mockRejectedValueOnce(new Error('No transport options found'));
    vi.mocked(mockTransportService.estimateLeg).mockResolvedValueOnce({
      mode: 'flight',
      provider: 'estimate',
      durationMinutes: 1190,
      priceEur: 1340,
      warnings: ['No transport options found — estimated flight, verify before booking'],
    });

    const app = buildApp();
    const res = await request(app).post('/plan').send({
      ...PLAN_BASE,
      dateInput: { mode: 'fixed', startDate: '2026-07-10', endDate: '2026-07-20' },
      destinations: [
        { city: 'Bali', country: 'Indonesia', nights: 5 },
        { city: 'Cabo Verde', country: 'Cape Verde', nights: 5 },
      ],
    });

    expect(res.status).toBe(200);
    const legs: { bestOption: { mode: string; durationMinutes: number; warnings: string[] } }[] =
      res.body.routeGraph.orderedLegs;
    expect(legs).toHaveLength(1);
    expect(legs[0].bestOption.mode).toBe('flight');
    expect(legs[0].bestOption.durationMinutes).toBeGreaterThan(600);
    expect(legs[0].bestOption.warnings.some((w) => w.includes('estimated flight'))).toBe(true);
  });

  it('single destination (no inbound leg): all slots free', async () => {
    const app = buildApp();
    const res = await request(app).post('/plan').send({
      ...PLAN_BASE,
      destinations: [{ city: 'Comporta', country: 'Portugal', nights: 2 }],
    });

    expect(res.status).toBe(200);
    const comporta = res.body.routeGraph.cityStays[0];
    const windows: { slot: string; isTransitDay: boolean }[] = comporta.timeWindows;

    expect(windows.every(w => !w.isTransitDay)).toBe(true);
    expect(mockTransportService.resolveTransportOptions).not.toHaveBeenCalled();
  });
});

// Real HolidayService + RestrictionsValidator (not mocks) — only date.nager.at's `fetch`
// and Google Places (via mockAttractions) are stubbed. Proves the full glue (region →
// country code → holiday fetch → warning) actually works end to end, not just that each
// unit is individually correct in isolation.
describe('POST /restrictions', () => {
  const realHolidayService = new HolidayService(mockRedis);
  const realRestrictionsValidator = new RestrictionsValidator();

  function restrictionsApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(createLogisticsRouter(
      mockWeather, mockAttractions, mockTiming, mockAnalyzer, mockRedis,
      realHolidayService, realRestrictionsValidator, mockTransportService, mockPricingEnricher,
      mockActivityTransportResolver,
    ));
    app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode ?? 400).json({ success: false, error: { message: err.message } });
    });
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.get).mockResolvedValue(null);
    vi.mocked(mockRedis.set).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('400 when tripId is missing', async () => {
    const res = await request(restrictionsApp()).post('/restrictions').send({
      itinerary: [VALID_ITINERARY_DAY],
      region: 'Lisbon, Portugal',
    });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const res = await request(restrictionsApp()).post('/restrictions').send({
      tripId: 'not-a-uuid',
      itinerary: [VALID_ITINERARY_DAY],
      region: 'Lisbon, Portugal',
    });
    expect(res.status).toBe(400);
  });

  it('resolves "Lisbon, Portugal" to PT and returns a real public holiday warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { date: '2026-06-10', localName: 'Dia de Portugal', name: 'Portugal Day', countryCode: 'PT', fixed: true, global: true, counties: null, types: ['Public'] },
      ]),
    }));
    vi.mocked(mockAttractions.getAttractions).mockResolvedValue([]);

    const res = await request(restrictionsApp()).post('/restrictions').send({
      tripId: VALID_UUID,
      itinerary: [{
        day: 1,
        activities: [{ name: 'Jerónimos Monastery', startTime: '10:00', endTime: '12:00' }],
      }],
      region: 'Lisbon, Portugal',
      dateInput: { mode: 'fixed', startDate: '2026-06-10', endDate: '2026-06-10' },
    });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].warningType).toBe('public_holiday');
    expect(res.body.warnings[0].activityName).toBe('Jerónimos Monastery');
    expect(res.body.warnings[0].message).toContain('Dia de Portugal');
  });

  it('still returns Sunday-closure warnings when Google Places is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    vi.mocked(mockAttractions.getAttractions).mockRejectedValue(new Error('Places API down'));

    const res = await request(restrictionsApp()).post('/restrictions').send({
      tripId: VALID_UUID,
      itinerary: [{
        day: 1,
        activities: [{ name: 'Lidl supermarket', startTime: '10:00', endTime: '11:00' }],
      }],
      region: 'Berlin, Germany',
      dateInput: { mode: 'fixed', startDate: '2026-06-07', endDate: '2026-06-07' }, // Sunday
    });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].warningType).toBe('sunday_closure');
    expect(res.body.warnings[0].message).toContain('Germany');
  });

  it('never fails the request when date.nager.at is unreachable — returns 200 with empty warnings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    vi.mocked(mockAttractions.getAttractions).mockResolvedValue([]);

    const res = await request(restrictionsApp()).post('/restrictions').send({
      tripId: VALID_UUID,
      itinerary: [{
        day: 1,
        activities: [{ name: 'City walk', startTime: '10:00', endTime: '11:00' }],
      }],
      region: 'Lisbon, Portugal',
      dateInput: { mode: 'fixed', startDate: '2026-06-11', endDate: '2026-06-11' }, // not a holiday
    });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
  });

  it('defaults to empty warnings for an unresolvable region (no country in the string)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(mockAttractions.getAttractions).mockResolvedValue([]);

    const res = await request(restrictionsApp()).post('/restrictions').send({
      tripId: VALID_UUID,
      itinerary: [{
        day: 1,
        activities: [{ name: 'Lidl supermarket', startTime: '10:00', endTime: '11:00' }],
      }],
      region: 'Paris', // bare city, no country — toCountryCode returns null
      dateInput: { mode: 'fixed', startDate: '2026-06-07', endDate: '2026-06-07' }, // Sunday
    });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled(); // no country resolved → holiday lookup skipped entirely
  });
});

// The orchestrator's merged itinerary is v2-shaped: activities carry
// act['activity']/act['time'] (slot) rather than /validate's legacy
// name/startTime/endTime, and transport legs key off leg['departureTime'].
const V2_ITINERARY_DAY = {
  day: 1,
  date: '2026-06-01',
  city: 'Paris',
  activities: [{ activity: 'Eiffel Tower visit', time: 'morning' }],
  transport: [],
};

describe('POST /weather-assessment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockRedis.get).mockResolvedValue(null);
    vi.mocked(mockRedis.set).mockResolvedValue(undefined);
    vi.mocked(mockWeather.getMultiDayForecast).mockResolvedValue([MOCK_FORECAST]);
    vi.mocked(mockTiming.validate).mockReturnValue(MOCK_TIMING_RESULT);
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue(MOCK_AGENT_EVENT);
  });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: 'not-a-uuid',
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });
    expect(res.status).toBe(400);
  });

  it('200 returns the analyzer assessment on valid input', async () => {
    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    expect(res.body.assessment).toBeDefined();
    expect(res.body.assessment.content.overallRisk).toBe('low');
  });

  it('extracts v2-shaped activities (activity/time slot) for TimingValidator', async () => {
    const app = buildApp();
    await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(mockTiming.validate).toHaveBeenCalledOnce();
    const [activities] = (mockTiming.validate as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
    expect(activities).toHaveLength(1);
    expect((activities[0] as { name: string; startTime: string }).name).toBe('Eiffel Tower visit');
    expect((activities[0] as { name: string; startTime: string }).startTime).toBe('09:00'); // morning slot fallback
  });

  it('extracts v2-shaped transport legs (departureTime) for TimingValidator', async () => {
    const app = buildApp();
    await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [{
        ...V2_ITINERARY_DAY,
        transport: [{ from: 'Paris', to: 'Lyon', departureTime: '14:00', durationMinutes: 120 }],
      }],
      region: 'Paris',
    });

    const [, transport] = (mockTiming.validate as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[], unknown[]];
    expect(transport).toHaveLength(1);
    expect(transport[0]).toMatchObject({ from: 'Paris', to: 'Lyon', startTime: '14:00', durationMinutes: 120 });
  });

  it('passes restrictionWarnings through to the analyzer', async () => {
    const app = buildApp();
    const warnings = [{ day: 1, activityName: 'Eiffel Tower visit', warningType: 'public_holiday' as const, message: 'closed' }];

    await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
      restrictionWarnings: warnings,
    });

    expect(mockAnalyzer.analyze).toHaveBeenCalledWith(
      VALID_UUID, 1, expect.any(Array), expect.any(Array), MOCK_TIMING_RESULT, null, warnings,
    );
  });

  it('resolves each day\'s forecast from ITS OWN city, not a single blended region — proving a multi-city trip does not get one city\'s weather smeared across every day', async () => {
    const PARIS_FORECAST: WeatherForecast = {
      ...MOCK_FORECAST, region: 'Paris', date: '2026-06-01', temperature: { min: 15, max: 25, unit: 'celsius' },
    };
    const ROME_FORECAST: WeatherForecast = {
      ...MOCK_FORECAST, region: 'Rome', date: '2026-06-02', temperature: { min: 22, max: 33, unit: 'celsius' }, conditions: 'Sunny',
    };
    vi.mocked(mockWeather.getMultiDayForecast).mockImplementation(async (city: string) => {
      if (city === 'Paris') return [PARIS_FORECAST];
      if (city === 'Rome') return [ROME_FORECAST];
      return [];
    });
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue({
      ...MOCK_AGENT_EVENT,
      content: {
        overallRisk: 'low',
        dayAssessments: [
          { day: 1, date: '2026-06-01', weatherRisk: 'low', affectedActivities: [] },
          { day: 2, date: '2026-06-02', weatherRisk: 'low', affectedActivities: [] },
        ],
        timingIssues: [],
        summary: 'Good weather.',
      },
    });

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [
        { ...V2_ITINERARY_DAY, day: 1, date: '2026-06-01', city: 'Paris' },
        { ...V2_ITINERARY_DAY, day: 2, date: '2026-06-02', city: 'Rome' },
      ],
      region: 'Paris + Rome',
      dateInput: { mode: 'fixed', startDate: '2026-06-01', endDate: '2026-06-02' },
    });

    expect(res.status).toBe(200);
    // Each city geocoded/fetched on its own real name — never the blended "Paris + Rome" string.
    expect(mockWeather.getMultiDayForecast).toHaveBeenCalledWith('Paris', expect.any(Number));
    expect(mockWeather.getMultiDayForecast).toHaveBeenCalledWith('Rome', expect.any(Number));
    expect(mockWeather.getMultiDayForecast).not.toHaveBeenCalledWith('Paris + Rome', expect.any(Number));

    const [day1, day2] = res.body.assessment.content.dayAssessments;
    expect(day1.tempHigh).toBe(25); // Paris
    expect(day2.tempHigh).toBe(33); // Rome — not Paris' forecast leaking onto Rome's day
    expect(day2.condition).toBe('Sunny');
  });

  it('reuses the Redis-cached forecast (same cache key convention as /validate)', async () => {
    vi.mocked(mockRedis.get).mockResolvedValue([MOCK_FORECAST]);

    const app = buildApp();
    await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(mockRedis.get).toHaveBeenCalledWith('weather:Paris:multi');
    expect(mockWeather.getMultiDayForecast).not.toHaveBeenCalled();
  });

  it('500s via the error handler when the analyzer call fails, instead of hanging the request', async () => {
    vi.mocked(mockAnalyzer.analyze).mockRejectedValue(new Error('Claude API unreachable'));

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Claude API unreachable');
  });

  it('merges real forecast (hi/lo temp, condition, rain%) into a matching dayAssessments entry by date', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue({
      ...MOCK_AGENT_EVENT,
      content: {
        overallRisk: 'low',
        dayAssessments: [{ day: 1, date: '2026-06-01', weatherRisk: 'low', affectedActivities: [] }],
        timingIssues: [],
        summary: 'Good weather.',
      },
    });

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    const [day] = res.body.assessment.content.dayAssessments;
    expect(day.tempHigh).toBe(25);
    expect(day.tempLow).toBe(15);
    expect(day.condition).toBe('Clear');
    expect(day.precipitationProbability).toBe(20);
    // original fields survive the merge
    expect(day.weatherRisk).toBe('low');
  });

  it('leaves a dayAssessments entry unmodified when its date has no matching forecast', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue({
      ...MOCK_AGENT_EVENT,
      content: {
        overallRisk: 'low',
        dayAssessments: [{ day: 2, date: '2026-06-02', weatherRisk: 'low', affectedActivities: [] }],
        timingIssues: [],
        summary: 'Good weather.',
      },
    });

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    const [day] = res.body.assessment.content.dayAssessments;
    expect(day.tempHigh).toBeUndefined();
    expect(day.weatherRisk).toBe('low');
  });

  it('returns the event unmodified (still 200) when the LLM response has no dayAssessments key', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue({
      ...MOCK_AGENT_EVENT,
      content: { overallRisk: 'low', summary: 'Good weather.' },
    });

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
    });

    expect(res.status).toBe(200);
    expect(res.body.assessment.content.dayAssessments).toBeUndefined();
    expect(res.body.assessment.content.overallRisk).toBe('low');
  });

  it('flexible dates with no preferred month: no forecast fetched, no temps merged anywhere', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue({
      ...MOCK_AGENT_EVENT,
      content: {
        overallRisk: 'low',
        dayAssessments: [{ day: 1, date: null, weatherRisk: 'low', affectedActivities: [] }],
        timingIssues: [],
        summary: 'Good weather.',
      },
    });

    const app = buildApp();
    const res = await request(app).post('/weather-assessment').send({
      tripId: VALID_UUID,
      round: 1,
      itinerary: [V2_ITINERARY_DAY],
      region: 'Paris',
      dateInput: { mode: 'flexible', days: 5, window: 'open' },
    });

    expect(res.status).toBe(200);
    expect(mockWeather.getMultiDayForecast).not.toHaveBeenCalled();
    const [day] = res.body.assessment.content.dayAssessments;
    expect(day.tempHigh).toBeUndefined();
  });
});
