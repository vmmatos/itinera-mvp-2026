import { BaseService } from '@itinera/shared';
import type { TransportMode, TransportOption } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';

export interface CityPair {
  from: string;
  to: string;
  departureDateIso?: string;
}

interface SkyscannerLeg {
  durationInMinutes: number;
  departure: string;
  arrival: string;
  segments: Array<{ flightNumber?: string }>;
}

interface SkyscannerItinerary {
  price: { amount: number; currency: string };
  legs: SkyscannerLeg[];
}

interface SkyscannerResponse {
  data: { itineraries?: SkyscannerItinerary[] };
}

interface GoogleDirectionsLeg {
  duration: { value: number };
  departure_time?: { text: string };
  arrival_time?: { text: string };
  steps: Array<{
    travel_mode: string;
    transit_details?: { line?: { name?: string } };
  }>;
}

interface GoogleDirectionsResponse {
  status: string;
  routes?: Array<{ legs?: GoogleDirectionsLeg[] }>;
}

export class TransportService extends BaseService {
  constructor(private readonly mapService: MapService) {
    super('transport-service');
  }

  async resolveTransportOptions(
    pair: CityPair,
    preference: TransportMode,
  ): Promise<TransportOption[]> {
    switch (preference) {
      case 'car':    return [await this.fetchCar(pair)];
      case 'flight': return this.fetchFlights(pair);
      case 'train':  return this.fetchTrains(pair);
      case 'best':   return this.fetchBest(pair);
    }
  }

  private async fetchFlights(pair: CityPair): Promise<TransportOption[]> {
    if (!config.SKYSCANNER_RAPIDAPI_KEY) {
      throw new Error('Skyscanner API key not configured');
    }

    const body = {
      origin: pair.from,
      destination: pair.to,
      date: pair.departureDateIso ?? new Date().toISOString().slice(0, 10),
      currency: 'EUR',
      adults: 1,
    };

    const res = await fetch(`${config.SKYSCANNER_BASE_URL}/searchFlights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': config.SKYSCANNER_RAPIDAPI_KEY,
        'X-RapidAPI-Host': config.SKYSCANNER_RAPIDAPI_HOST,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Skyscanner API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as SkyscannerResponse;
    const itineraries = data.data?.itineraries;

    if (!itineraries || itineraries.length === 0) {
      throw new Error(`No flight found from "${pair.from}" to "${pair.to}"`);
    }

    const options = itineraries.slice(0, 5).map((itin): TransportOption => {
      const leg = itin.legs[0];
      const durationMinutes = leg?.durationInMinutes ?? 0;
      const flightNumber = leg?.segments?.[0]?.flightNumber;
      return {
        mode: 'flight',
        provider: 'Skyscanner',
        durationMinutes,
        departureTime: leg?.departure ? leg.departure.slice(11, 16) : undefined,
        arrivalTime: leg?.arrival ? leg.arrival.slice(11, 16) : undefined,
        priceEur: Math.round(itin.price.amount),
        flightNumber,
        warnings: durationMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : [],
      };
    });

    return options.sort((a, b) => {
      const toMins = (t?: string): number => {
        if (!t) return 9999;
        const [h, m] = t.split(':').map(Number);
        return (h ?? 0) * 60 + (m ?? 0);
      };
      return toMins(a.departureTime) - toMins(b.departureTime);
    });
  }

  private async fetchTrains(pair: CityPair): Promise<TransportOption[]> {
    const url =
      `${config.GOOGLE_MAPS_BASE_URL}/directions/json` +
      `?origin=${encodeURIComponent(pair.from)}` +
      `&destination=${encodeURIComponent(pair.to)}` +
      `&mode=transit&transit_mode=rail&alternatives=true` +
      `&key=${config.GOOGLE_MAPS_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Directions API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as GoogleDirectionsResponse;

    if (data.status === 'ZERO_RESULTS') {
      throw new Error(`No train route found from "${pair.from}" to "${pair.to}"`);
    }
    if (data.status !== 'OK') {
      throw new Error(`Google Directions API returned status: ${data.status}`);
    }

    const routes = data.routes ?? [];
    if (routes.length === 0) {
      throw new Error(`No train route found from "${pair.from}" to "${pair.to}"`);
    }

    return routes.map((route): TransportOption => {
      const leg = route.legs?.[0];
      const durationMinutes = Math.ceil((leg?.duration.value ?? 0) / 60);
      const transitStep = leg?.steps.find((s) => s.travel_mode === 'TRANSIT');
      const trainLine = transitStep?.transit_details?.line?.name;
      return {
        mode: 'train',
        provider: 'Google Maps',
        durationMinutes,
        departureTime: leg?.departure_time?.text,
        arrivalTime: leg?.arrival_time?.text,
        trainLine,
        warnings: durationMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : [],
      };
    });
  }

  private async fetchCar(pair: CityPair): Promise<TransportOption> {
    const travelTime = await this.mapService.getTravelTime(pair.from, pair.to, 'driving');
    const durationMinutes = travelTime.durationMinutes;
    return {
      mode: 'car',
      provider: 'Google Maps',
      durationMinutes,
      warnings: durationMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : [],
    };
  }

  private async fetchBest(pair: CityPair): Promise<TransportOption[]> {
    const results = await Promise.allSettled([
      this.fetchFlights(pair),
      this.fetchTrains(pair),
      this.fetchCar(pair).then((opt) => [opt]),
    ]);

    const allOptions: TransportOption[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allOptions.push(...result.value);
      } else {
        this.logger.debug('Transport option unavailable', { reason: String(result.reason) });
      }
    }

    if (allOptions.length === 0) {
      throw new Error(`No transport options found from "${pair.from}" to "${pair.to}"`);
    }

    return this.sortByScore(allOptions);
  }

  private sortByScore(options: TransportOption[]): TransportOption[] {
    const hasPrice = options.some((o) => o.priceEur !== undefined);

    if (!hasPrice) {
      return [...options].sort((a, b) => a.durationMinutes - b.durationMinutes);
    }

    return [...options].sort((a, b) => {
      const scoreA = (a.priceEur ?? 999) * 0.6 + (a.durationMinutes / 60) * 40;
      const scoreB = (b.priceEur ?? 999) * 0.6 + (b.durationMinutes / 60) * 40;
      return scoreA - scoreB;
    });
  }
}
