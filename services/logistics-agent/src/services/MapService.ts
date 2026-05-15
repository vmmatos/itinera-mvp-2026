import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface TravelTime {
  from: string;
  to: string;
  durationMinutes: number;
  distanceKm: number;
  mode: 'driving' | 'walking' | 'transit';
}

interface GoogleDistanceMatrixResponse {
  status: string;
  rows?: Array<{
    elements?: Array<{
      status: string;
      duration?: { value: number };
      distance?: { value: number };
    }>;
  }>;
}

export class MapService extends BaseService {
  private readonly apiKey: string;
  private readonly baseUrl = config.GOOGLE_MAPS_BASE_URL;

  constructor() {
    super('map-service');
    this.apiKey = config.GOOGLE_MAPS_API_KEY;
  }

  async getTravelTime(
    from: string,
    to: string,
    mode: TravelTime['mode'] = 'driving',
  ): Promise<TravelTime> {
    const url = `${this.baseUrl}/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&mode=${mode}&key=${this.apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Maps API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GoogleDistanceMatrixResponse;

    if (data.status !== 'OK') {
      throw new Error(`Google Maps API returned status: ${data.status}`);
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      throw new Error(`No route found from "${from}" to "${to}"`);
    }

    return {
      from,
      to,
      durationMinutes: Math.ceil((element.duration?.value ?? 0) / 60),
      distanceKm: Math.round(((element.distance?.value ?? 0) / 1000) * 10) / 10,
      mode,
    };
  }
}
