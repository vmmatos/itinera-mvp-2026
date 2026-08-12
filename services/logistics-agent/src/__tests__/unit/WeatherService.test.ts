import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    OPENWEATHERMAP_API_KEY: 'test-owm-key',
    OWM_FORECAST_HORIZON_DAYS: 5,
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

import { WeatherService, isDateWithinForecastHorizon, deriveWeatherRisk } from '@/services/WeatherService';
import type { WeatherForecast } from '@/services/WeatherService';

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

      expect(result?.region).toBe('Paris');
      expect(result?.date).toBe('2026-06-01');
      expect(result?.conditions).toBe('Clear');
      expect(result?.temperature.unit).toBe('celsius');
    });

    // Was: "returns first forecast when date has no exact match". Handing back
    // today's weather stamped with a date it does not describe is worse than
    // handing back nothing — it is the same defect class as the day-index bug.
    it('returns null when the requested date has no forecast, never mislabelling another day', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const result = await service.getForecast('Paris', '2099-01-01');

      expect(result).toBeNull();
    });

    it('returns forecast with correct temperature structure', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const result = await service.getForecast('Paris', '2026-06-01');

      expect(result?.temperature.min).toBeTypeOf('number');
      expect(result?.temperature.max).toBeTypeOf('number');
      expect(result?.temperature.max).toBeGreaterThanOrEqual(result?.temperature.min ?? 0);
    });
  });

  describe('isDateWithinForecastHorizon', () => {
    const NOW = new Date('2026-06-01T09:00:00Z');

    it('accepts today', () => {
      expect(isDateWithinForecastHorizon('2026-06-01', 5, NOW)).toBe(true);
    });

    it('accepts the last fully-sampled day (today + 4)', () => {
      expect(isDateWithinForecastHorizon('2026-06-05', 5, NOW)).toBe(true);
    });

    // OWM's 5th day is only partially sampled, so it is deliberately not claimed.
    it('rejects today + 5', () => {
      expect(isDateWithinForecastHorizon('2026-06-06', 5, NOW)).toBe(false);
    });

    it('rejects a trip three months out', () => {
      expect(isDateWithinForecastHorizon('2026-08-30', 5, NOW)).toBe(false);
    });

    it('rejects past dates', () => {
      expect(isDateWithinForecastHorizon('2026-05-31', 5, NOW)).toBe(false);
    });

    it('respects a custom horizon', () => {
      expect(isDateWithinForecastHorizon('2026-06-01', 1, NOW)).toBe(true);
      expect(isDateWithinForecastHorizon('2026-06-02', 1, NOW)).toBe(false);
    });

    it('rejects malformed input without throwing', () => {
      expect(isDateWithinForecastHorizon('not-a-date', 5, NOW)).toBe(false);
      expect(isDateWithinForecastHorizon('', 5, NOW)).toBe(false);
    });

    it('is not tripped by a late-UTC clock', () => {
      expect(isDateWithinForecastHorizon('2026-06-01', 5, new Date('2026-06-01T23:30:00Z'))).toBe(true);
    });
  });

  describe('deriveWeatherRisk', () => {
    function forecast(overrides: Partial<WeatherForecast> = {}): WeatherForecast {
      return {
        region: 'Paris',
        date: '2026-06-01',
        temperature: { min: 15, max: 25, unit: 'celsius' },
        conditions: 'Clear',
        humidity: 60,
        windSpeed: 12,
        description: 'clear sky',
        precipitationProbability: 10,
        ...overrides,
      };
    }

    it('is high on heavy rain probability', () => {
      expect(deriveWeatherRisk(forecast({ precipitationProbability: 80 }))).toBe('high');
    });

    it('is high on strong wind', () => {
      expect(deriveWeatherRisk(forecast({ windSpeed: 60 }))).toBe('high');
    });

    it('is high on temperature extremes', () => {
      expect(deriveWeatherRisk(forecast({ temperature: { min: 30, max: 40, unit: 'celsius' } }))).toBe('high');
      expect(deriveWeatherRisk(forecast({ temperature: { min: -2, max: 2, unit: 'celsius' } }))).toBe('high');
    });

    it('is medium in the mid bands', () => {
      expect(deriveWeatherRisk(forecast({ precipitationProbability: 50 }))).toBe('medium');
      expect(deriveWeatherRisk(forecast({ temperature: { min: 25, max: 34, unit: 'celsius' } }))).toBe('medium');
    });

    it('is low on a mild clear day', () => {
      expect(deriveWeatherRisk(forecast())).toBe('low');
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

    // The free endpoint returns the same 5 days whatever `cnt` says (and caps
    // it at 40 server-side). Clamping keeps the request honest and makes the
    // response a pure function of (city, today) — which the cache key relies on.
    it('clamps cnt to the forecast horizon when asked for more days', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      await service.getMultiDayForecast('Paris', 10);

      const forecastUrl = String(vi.mocked(fetch).mock.calls[1]?.[0]);
      expect(forecastUrl).toContain('cnt=40');
    });

    it('requests a single day of slices when asked for one day', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      await service.getMultiDayForecast('Paris', 1);

      const forecastUrl = String(vi.mocked(fetch).mock.calls[1]?.[0]);
      expect(forecastUrl).toContain('cnt=8');
    });

    it('aggregates at most the horizon in days even when the payload carries more dates', async () => {
      mockFetch(GEO_OK, {
        list: Array.from({ length: 8 }, (_, i) => ({
          dt_txt: `2026-06-0${i + 1} 12:00:00`,
          main: { temp_min: 15, temp_max: 25, humidity: 60 },
          weather: [{ main: 'Clear', description: 'clear sky' }],
          wind: { speed: 5 },
        })),
      });

      const results = await service.getMultiDayForecast('Paris', 8);

      expect(results).toHaveLength(5);
    });
  });

  describe('precipitationProbability', () => {
    it('averages pop across the day\'s items and scales to 0-100', async () => {
      mockFetch(GEO_OK, {
        list: [
          { ...FORECAST_OK.list[0], pop: 0.2 },
          { ...FORECAST_OK.list[1], pop: 0.4 },
        ],
      });

      const [first] = await service.getMultiDayForecast('Paris', 1);

      expect(first?.precipitationProbability).toBe(30);
    });

    it('defaults to 0 when OWM omits pop entirely, without throwing', async () => {
      mockFetch(GEO_OK, FORECAST_OK);

      const [first] = await service.getMultiDayForecast('Paris', 1);

      expect(first?.precipitationProbability).toBe(0);
    });
  });

  describe('multi-city region fallback', () => {
    // Regression for a real bug: DestinationParser accepts "+"/","-separated
    // multi-city free text (e.g. "Barcelona + Dublin + Comporta") and correctly
    // splits it into destinations, but WeatherService's own fallback only knew
    // about word conjunctions ("e"/"and"/"y"/"et") — so the whole multi-city
    // string never geocoded and weather silently came back empty for every
    // trip typed that way.
    it('falls back to the first "+"-separated city when the full multi-city string fails to geocode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/geo/1.0/direct')) {
          const isFirstCityOnly = String(url).includes('q=Barcelona&');
          return Promise.resolve({ ok: true, json: () => Promise.resolve(isFirstCityOnly ? GEO_OK : []), text: () => Promise.resolve('') });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FORECAST_OK), text: () => Promise.resolve('') });
      }));

      const results = await service.getMultiDayForecast('Barcelona + Dublin + Comporta', 2);

      expect(results.length).toBeGreaterThan(0);
    });

    it('falls back to the first ","-separated city when the full multi-city string fails to geocode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/geo/1.0/direct')) {
          const isFirstCityOnly = String(url).includes('q=Porto&');
          return Promise.resolve({ ok: true, json: () => Promise.resolve(isFirstCityOnly ? GEO_OK : []), text: () => Promise.resolve('') });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FORECAST_OK), text: () => Promise.resolve('') });
      }));

      const results = await service.getMultiDayForecast('Porto, Lisboa, Faro', 2);

      expect(results.length).toBeGreaterThan(0);
    });

    it('still returns empty when every fallback candidate fails to geocode, without throwing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve(''),
      }));

      const results = await service.getMultiDayForecast('Nowhereville + AlsoNowhere', 2);

      expect(results).toEqual([]);
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
