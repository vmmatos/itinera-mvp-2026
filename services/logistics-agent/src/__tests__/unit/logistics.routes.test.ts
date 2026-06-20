import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import type { HolidayService } from '@/services/HolidayService';
import type { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import type { Place } from '@/services/PlacesService';
import type { TransportService } from '@/services/TransportService';

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
};

const MOCK_PLACES: Place[] = [
  {
    id: 'place-1',
    name: 'Eiffel Tower',
    location: { lat: 48.8584, lng: 2.2945 },
    category: 'tourist_attraction',
    rating: 4.7,
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
  resolveTransportOption: vi.fn().mockResolvedValue({
    mode: 'car',
    provider: 'Google Maps',
    durationMinutes: 120,
    warnings: [],
  }),
} as unknown as TransportService;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createLogisticsRouter(
    mockWeather, mockAttractions, mockTiming, mockAnalyzer, mockRedis,
    mockHolidayService, mockRestrictionsValidator, mockTransportService,
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
    vi.mocked(mockTransportService.resolveTransportOption).mockResolvedValue({
      mode: 'car',
      provider: 'Google Maps',
      durationMinutes: 120,
      warnings: [],
    });
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
