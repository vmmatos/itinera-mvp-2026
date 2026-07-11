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

export class WeatherService extends BaseService {
  private readonly apiKey: string;
  private readonly baseUrl = config.OPENWEATHERMAP_BASE_URL;

  constructor() {
    super('weather-service');
    this.apiKey = config.OPENWEATHERMAP_API_KEY;
  }

  async getForecast(region: string, date?: string): Promise<WeatherForecast> {
    const forecasts = await this.getMultiDayForecast(region, 5);
    const targetDate = date ?? new Date().toISOString().slice(0, 10);

    const match = forecasts.find((f) => f.date === targetDate);
    if (match) return match;

    const first = forecasts[0];
    if (!first) return null as unknown as WeatherForecast;
    return first;
  }

  async getMultiDayForecast(region: string, days: number): Promise<WeatherForecast[]> {
    let coords: { lat: number; lon: number } | null = null;

    // Try the region as-is, then try the first comma-separated part as a fallback
    // (handles multi-language names like "Portugal e Espanha")
    const candidates = [region, region.split(/[,\s]+(?:e|and|y|et)\s*/i)[0]?.trim() ?? ''].filter(Boolean);

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

    const url = `${this.baseUrl}/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&appid=${this.apiKey}&units=metric&cnt=${days * 8}`;

    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn('OpenWeatherMap forecast error — skipping weather data', {
        status: res.status,
        region,
      });
      return [];
    }

    const data = (await res.json()) as OWMForecastResponse;

    return this.aggregateDailyForecasts(region, data.list, days);
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
