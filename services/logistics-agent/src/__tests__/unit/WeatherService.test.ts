import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    OPENWEATHERMAP_API_KEY: 'test-owm-key',
    NODE_ENV: 'test',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import { WeatherService } from '@/services/WeatherService';

const GEO_OK = [{ lat: 48.8566, lon: 2.3522, name: 'Paris' }];

const FORECAST_OK = {
  list: [
    {
      dt_txt: '2026-06-01 12:00:00',
      main: { temp_min: 15, temp_max: 25, humidity: 60 },
      weather: [{ main: 'Clear', description: 'clear sky' }],
      wind: { speed: 5 },
    },
    {
      dt_txt: '2026-06-01 15:00:00',
      main: { temp_min: 18, temp_max: 27, humidity: 55 },
      weather: [{ main: 'Clear', description: 'clear sky' }],
      wind: { speed: 6 },
    },
    {
      dt_txt: '2026-06-02 12:00:00',
      main: { temp_min: 10, temp_max: 18, humidity: 80 },
      weather: [{ main: 'Rain', description: 'light rain' }],
      wind: { speed: 10 },
    },
  ],
};

function mockFetch(geoBody: unknown, forecastBody: unknown): void {
  let callCount = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    callCount++;
    const body = callCount === 1 ? geoBody : forecastBody;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    });
  }));
}

describe('WeatherService', () => {
  let service: WeatherService;

  beforeEach(() => {
    service = new WeatherService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getForecast', () => {
    it('returns forecast for matching date', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const result = await service.getForecast('Paris', '2026-06-01');

      expect(result.region).toBe('Paris');
      expect(result.date).toBe('2026-06-01');
      expect(result.conditions).toBe('Clear');
      expect(result.temperature.unit).toBe('celsius');
    });

    it('returns first forecast when date has no exact match', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const result = await service.getForecast('Paris', '2099-01-01');

      expect(result.region).toBe('Paris');
      expect(result.date).toBe('2026-06-01');
    });

    it('returns forecast with correct temperature structure', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const result = await service.getForecast('Paris', '2026-06-01');

      expect(result.temperature.min).toBeTypeOf('number');
      expect(result.temperature.max).toBeTypeOf('number');
      expect(result.temperature.max).toBeGreaterThanOrEqual(result.temperature.min);
    });
  });

  describe('getMultiDayForecast', () => {
    it('returns multiple day forecasts', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const results = await service.getMultiDayForecast('Paris', 2);

      expect(results).toHaveLength(2);
      expect(results[0]?.date).toBe('2026-06-01');
      expect(results[1]?.date).toBe('2026-06-02');
    });

    it('includes wind speed in km/h', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const [first] = await service.getMultiDayForecast('Paris', 1);

      expect(first?.windSpeed).toBeTypeOf('number');
      expect(first?.windSpeed).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('returns null when geocoding API returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }));

      const result = await service.getForecast('Paris');
      expect(result).toBeNull();
    });

    it('returns null when forecast API returns non-ok status', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(GEO_OK), text: () => Promise.resolve('') });
        }
        return Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('Rate limit') });
      }));

      const result = await service.getForecast('Paris');
      expect(result).toBeNull();
    });

    it('returns null when region is not found by geocoding', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve(''),
      }));

      const result = await service.getForecast('UnknownXYZ123');
      expect(result).toBeNull();
    });
  });
});
