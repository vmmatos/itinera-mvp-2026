import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface WeatherForecast {
  region: string;
  date: string;
  temperature: { min: number; max: number; unit: 'celsius' };
  conditions: string;
  humidity: number;
  windSpeed: number;
  description: string;
  /** Probability of precipitation, 0-100, averaged across the day's forecast items. */
  precipitationProbability: number;
}

interface OWMGeoResult {
  lat: number;
  lon: number;
  name: string;
}

interface OWMForecastItem {
  dt_txt: string;
  main: { temp_min: number; temp_max: number; humidity: number };
  weather: Array<{ main: string; description: string }>;
  wind: { speed: number };
  /** Probability of precipitation, 0-1. Absent on some OWM plans/mocks. */
  pop?: number;
}

interface OWMForecastResponse {
  list: OWMForecastItem[];
}

/**
 * True when `dateISO` (YYYY-MM-DD) falls inside the window the free
 * OpenWeatherMap plan can actually answer for: today (UTC) through
 * today + horizonDays - 1, inclusive.
 *
 * The 5-day/3h endpoint always returns now→now+5d and takes no date
 * parameter, so a trip starting later is not "missing data" — it is
 * unknowable. Callers use this to skip the API call entirely rather than
 * geocoding, fetching and then discarding every result.
 *
 * The exclusive upper bound is deliberate: OWM's last returned day is only
 * partially sampled (1–2 of the 8 three-hour slices), so its aggregated
 * min/max is not a forecast we are willing to claim.
 *
 * Past dates are outside the horizon, and unparseable input is outside it —
 * never assume coverage that cannot be proven. `now` is injectable so the
 * helper is deterministic under test.
 */
export function isDateWithinForecastHorizon(
  dateISO: string,
  horizonDays: number = config.OWM_FORECAST_HORIZON_DAYS,
  now: Date = new Date(),
): boolean {
  const target = Date.parse(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(target)) return false;

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((target - todayUtc) / 86_400_000);

  return diffDays >= 0 && diffDays < horizonDays;
}

/**
 * Code-side mirror of the risk thresholds stated in the logistics-validator
 * prompt. Used when the LLM returns no usable dayAssessments so the UI still
 * gets an honest risk level derived from the real numbers, instead of the
 * silent degrade-to-empty this codebase has been bitten by before.
 */
export function deriveWeatherRisk(forecast: WeatherForecast): 'low' | 'medium' | 'high' {
  const temp = forecast.temperature.max;

  if (forecast.precipitationProbability > 70 || forecast.windSpeed > 50 || temp < 5 || temp > 38) {
    return 'high';
  }
  if (forecast.precipitationProbability >= 30 || forecast.windSpeed >= 30 || temp <= 10 || temp >= 32) {
    return 'medium';
  }
  return 'low';
}

export class WeatherService extends BaseService {
  private readonly apiKey: string;
  private readonly baseUrl = config.OPENWEATHERMAP_BASE_URL;

  constructor() {
    super('weather-service');
    this.apiKey = config.OPENWEATHERMAP_API_KEY;
  }

  /**
   * Returns null — rather than another day's weather stamped with the
   * requested date — when the date is outside the forecast horizon or the
   * region cannot be geocoded. Handing back today's forecast labelled as a
   * future date is worse than handing back nothing.
   */
  async getForecast(region: string, date?: string): Promise<WeatherForecast | null> {
    const forecasts = await this.getMultiDayForecast(region, config.OWM_FORECAST_HORIZON_DAYS);
    const targetDate = date ?? new Date().toISOString().slice(0, 10);

    return forecasts.find((f) => f.date === targetDate) ?? null;
  }

  async getMultiDayForecast(region: string, days: number): Promise<WeatherForecast[]> {
    let coords: { lat: number; lon: number } | null = null;

    // Try the region as-is, then fall back to just its first destination.
    // Two separator conventions can reach here: a multi-language conjunction
    // ("Portugal e Espanha") or the same "+"/"," delimiters DestinationParser
    // uses for multi-city free-text input ("Barcelona + Dublin + Comporta") —
    // without this second split, a multi-city region string never geocodes at
    // all and every multi-city trip silently gets zero weather data.
    const candidates = [
      region,
      region.split(/[,\s]+(?:e|and|y|et)\s*/i)[0]?.trim() ?? '',
      region.split(/[+,]/)[0]?.trim() ?? '',
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        coords = await this.geocode(candidate);
        break;
      } catch {
        this.logger.warn('Geocode failed, trying fallback', { candidate });
      }
    }

    if (!coords) {
      this.logger.warn('Could not geocode region — skipping weather data', { region });
      return [];
    }

    // Asking for more than the horizon is a lie the API quietly humours: it
    // caps `cnt` at 40 server-side and returns the same 5 days either way.
    // Clamping keeps the request honest and makes the response a pure
    // function of (city, today) — which is what makes the caller's
    // `weather:{city}:{today}:{days}` cache key sound.
    const cappedDays = Math.min(Math.max(1, days), config.OWM_FORECAST_HORIZON_DAYS);

    const url = `${this.baseUrl}/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&appid=${this.apiKey}&units=metric&cnt=${cappedDays * 8}`;

    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn('OpenWeatherMap forecast error — skipping weather data', {
        status: res.status,
        region,
      });
      return [];
    }

    const data = (await res.json()) as OWMForecastResponse;

    return this.aggregateDailyForecasts(region, data.list, cappedDays);
  }

  private async geocode(region: string): Promise<{ lat: number; lon: number }> {
    const url = `${this.baseUrl}/geo/1.0/direct?q=${encodeURIComponent(region)}&limit=1&appid=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenWeatherMap geocoding error ${res.status}: ${body}`);
    }

    const results = (await res.json()) as OWMGeoResult[];
    const first = results[0];
    if (!first) throw new Error(`Region not found: ${region}`);

    return { lat: first.lat, lon: first.lon };
  }

  private aggregateDailyForecasts(
    region: string,
    items: OWMForecastItem[],
    maxDays: number,
  ): WeatherForecast[] {
    const byDate = new Map<string, OWMForecastItem[]>();

    for (const item of items) {
      const date = item.dt_txt.slice(0, 10);
      const existing = byDate.get(date) ?? [];
      existing.push(item);
      byDate.set(date, existing);
    }

    const results: WeatherForecast[] = [];

    for (const [date, dayItems] of byDate) {
      if (results.length >= maxDays) break;

      const temps = dayItems.map((i) => ({ min: i.main.temp_min, max: i.main.temp_max }));
      const humidities = dayItems.map((i) => i.main.humidity);
      const winds = dayItems.map((i) => i.wind.speed);
      const pops = dayItems.map((i) => i.pop ?? 0);
      const midday = dayItems.find((i) => i.dt_txt.includes('12:00')) ?? dayItems[0];

      if (!midday) continue;

      results.push({
        region,
        date,
        temperature: {
          min: Math.min(...temps.map((t) => t.min)),
          max: Math.max(...temps.map((t) => t.max)),
          unit: 'celsius',
        },
        conditions: midday.weather[0]?.main ?? 'Unknown',
        humidity: Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length),
        windSpeed: Math.round((winds.reduce((a, b) => a + b, 0) / winds.length) * 3.6),
        description: midday.weather[0]?.description ?? '',
        precipitationProbability: Math.round((pops.reduce((a, b) => a + b, 0) / pops.length) * 100),
      });
    }

    return results;
  }
}
