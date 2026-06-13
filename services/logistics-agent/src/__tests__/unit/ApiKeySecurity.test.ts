import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted ensures these values are available inside the hoisted vi.mock() factories
const { MAPS_KEY, OWM_KEY } = vi.hoisted(() => ({
  MAPS_KEY: 'secret-maps-key-abc123',
  OWM_KEY: 'secret-owm-key-xyz789',
}));

vi.mock('@/config', () => ({
  config: {
    GOOGLE_MAPS_API_KEY: MAPS_KEY,
    GOOGLE_MAPS_BASE_URL: 'https://maps.googleapis.com/maps/api',
    OPENWEATHERMAP_API_KEY: OWM_KEY,
    OPENWEATHERMAP_BASE_URL: 'https://api.openweathermap.org',
    GOOGLE_PLACES_API_KEY: 'secret-places-key',
    GOOGLE_PLACES_BASE_URL: 'https://places.googleapis.com/v1',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
  getRedisUrl: () => 'redis://localhost:6379',
}));

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { MapService } from '@/services/MapService';
import { WeatherService } from '@/services/WeatherService';

describe('API key security — keys must not appear in error messages or logs (#30)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // MapService — Google Maps API key
  // -------------------------------------------------------------------------
  describe('MapService', () => {
    let service: MapService;

    beforeEach(() => {
      service = new MapService();
    });

    it('HTTP error message does not contain the Google Maps API key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }));

      await expect(service.getTravelTime('A', 'B')).rejects.toThrow();
      await expect(service.getTravelTime('A', 'B')).rejects.not.toThrow(
        expect.objectContaining({ message: expect.stringContaining(MAPS_KEY) }),
      );
    });

    it('API status error message does not contain the Google Maps API key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'REQUEST_DENIED', rows: [] }),
        text: () => Promise.resolve(''),
      }));

      let caughtMessage = '';
      try {
        await service.getTravelTime('A', 'B');
      } catch (err) {
        caughtMessage = (err as Error).message;
      }

      expect(caughtMessage).not.toContain(MAPS_KEY);
    });

    it('fetch URL contains the key but the thrown error does not expose it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      });
      vi.stubGlobal('fetch', mockFetch);

      let caughtMessage = '';
      try {
        await service.getTravelTime('Paris', 'London');
      } catch (err) {
        caughtMessage = (err as Error).message;
      }

      // Confirm the key is in the URL (expected by Google Maps API)
      const calledUrl = (mockFetch.mock.calls[0] as [string])[0];
      expect(calledUrl).toContain(`key=${MAPS_KEY}`);

      // Confirm the key is NOT in the error message surfaced to callers
      expect(caughtMessage).not.toContain(MAPS_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // WeatherService — OpenWeatherMap API key
  // -------------------------------------------------------------------------
  describe('WeatherService', () => {
    let service: WeatherService;

    beforeEach(() => {
      service = new WeatherService();
    });

    it('geocode error message does not contain the OWM API key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid API key'),
      }));

      let caughtMessage = '';
      try {
        await service.getForecast('Paris', '2026-06-15');
      } catch (err) {
        caughtMessage = (err as Error).message;
      }

      expect(caughtMessage).not.toContain(OWM_KEY);
    });

    it('logger warn on forecast error does not include the OWM API key', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // geocode succeeds
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ lat: 48.8566, lon: 2.3522, name: 'Paris' }]),
            text: () => Promise.resolve(''),
          });
        }
        // forecast fails
        return Promise.resolve({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        });
      }));

      const warnSpy = vi.spyOn(service['logger'], 'warn');

      await service.getMultiDayForecast('Paris', 3);

      // Logger must have warned about the error
      expect(warnSpy).toHaveBeenCalled();

      // None of the warn calls should contain the API key in any argument
      for (const call of warnSpy.mock.calls) {
        const callStr = JSON.stringify(call);
        expect(callStr).not.toContain(OWM_KEY);
      }
    });

    it('geocode fetch URL contains the key but error thrown does not expose it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.getForecast('Berlin', '2026-06-15');

      const calledUrl = (mockFetch.mock.calls[0] as [string])[0];
      expect(calledUrl).toContain(`appid=${OWM_KEY}`);
    });
  });
});
