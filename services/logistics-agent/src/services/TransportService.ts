import { BaseService } from '@itinera/shared';
import type { TransportMode, TransportOption } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';
import { resolveMultiLegOptions } from '@/services/MultiLegRouter';

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

// ── Google Routes API (v2) — transit response shapes ─────────────
interface RoutesTransitStep {
  transitDetails?: {
    transitLine?: { name?: string; nameShort?: string };
    stopDetails?: {
      departureTime?: string; // RFC3339
      arrivalTime?: string;
    };
  };
}

interface RoutesLeg {
  steps?: RoutesTransitStep[];
}

interface RoutesRoute {
  duration?: string; // e.g. "8400s"
  legs?: RoutesLeg[];
}

interface RoutesResponse {
  routes?: RoutesRoute[];
  error?: { code: number; message: string; status: string };
}

/** Rough European intercity rail fare estimate when no API fare is available. */
function estimateRailFareEur(durationMinutes: number): number {
  return Math.round(8 + durationMinutes * 0.4);
}

/** Parse a Routes API duration string ("8400s") into whole minutes. */
function parseRoutesDuration(d?: string): number {
  if (!d) return 0;
  const secs = Number(d.replace(/s$/, ''));
  return Number.isFinite(secs) ? Math.ceil(secs / 60) : 0;
}

/** "HH:MM" from an RFC3339 timestamp, or undefined. */
function clockFromIso(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(11, 16);
}

export class TransportService extends BaseService {
  constructor(private readonly mapService: MapService) {
    super('transport-service');
  }

  async resolveTransportOptions(
    pair: CityPair,
    preference: TransportMode,
  ): Promise<TransportOption[]> {
    // Always offer every mode as an alternative; the user's preferred mode is
    // favoured in the ranking (F4) but a clearly better option can still win.
    const options = await this.fetchBest(pair);
    return this.sortByScore(options, preference === 'best' ? undefined : preference);
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
    // Routes API TRANSIT requires a future departureTime. Use the trip's
    // departure date at ~09:00, falling back to a week out if missing/past.
    const departureTime = this.routesDepartureTime(pair.departureDateIso);

    const res = await fetch(
      `${config.GOOGLE_ROUTES_BASE_URL}/directions/v2:computeRoutes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'routes.duration,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.stopDetails',
        },
        body: JSON.stringify({
          origin: { address: pair.from },
          destination: { address: pair.to },
          travelMode: 'TRANSIT',
          transitPreferences: { allowedTravelModes: ['TRAIN'] },
          computeAlternativeRoutes: true,
          departureTime,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Routes API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as RoutesResponse;
    if (data.error) {
      throw new Error(`Google Routes API returned ${data.error.status}: ${data.error.message}`);
    }

    const routes = data.routes ?? [];
    if (routes.length === 0) {
      throw new Error(`No train route found from "${pair.from}" to "${pair.to}"`);
    }

    return routes
      .map((route): TransportOption => {
        const durationMinutes = parseRoutesDuration(route.duration);
        const steps = route.legs?.flatMap((l) => l.steps ?? []) ?? [];
        const transit = steps.find((s) => s.transitDetails);
        const trainLine =
          transit?.transitDetails?.transitLine?.name ??
          transit?.transitDetails?.transitLine?.nameShort;
        const departureTimeIso = transit?.transitDetails?.stopDetails?.departureTime;
        const arrivalTimeIso = steps
          .reverse()
          .find((s) => s.transitDetails?.stopDetails?.arrivalTime)
          ?.transitDetails?.stopDetails?.arrivalTime;
        return {
          mode: 'train',
          // Routes API transit has no fare — estimate it so trains are priced
          // into the budget and ranked fairly against flights.
          provider: 'Google Routes (est. fare)',
          durationMinutes,
          departureTime: clockFromIso(departureTimeIso),
          arrivalTime: clockFromIso(arrivalTimeIso),
          priceEur: estimateRailFareEur(durationMinutes),
          trainLine,
          warnings: durationMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : [],
        };
      })
      .filter((o) => o.durationMinutes > 0);
  }

  // RFC3339 departure for Routes API transit requests.
  //
  // Google only publishes transit (rail) schedules a few weeks ahead, so a
  // far-future trip date (e.g. a flexible trip 12+ months out) returns ZERO
  // routes. We only need a representative route + duration, not a bookable
  // service, so clamp to a near-term weekday: use the real date only when it
  // falls inside the schedule horizon, otherwise ~7 days out.
  private static readonly TRANSIT_HORIZON_DAYS = 21;

  private routesDepartureTime(departureDateIso?: string): string {
    const nearTerm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (!departureDateIso) return nearTerm.toISOString();
    const d = new Date(`${departureDateIso.slice(0, 10)}T09:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return nearTerm.toISOString();
    const horizonMs = TransportService.TRANSIT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    if (d.getTime() - Date.now() > horizonMs) return nearTerm.toISOString();
    return d.toISOString();
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
    const [directResults, multiLegResults] = await Promise.allSettled([
      Promise.allSettled([
        this.fetchFlights(pair),
        this.fetchTrains(pair),
        this.fetchCar(pair).then((opt) => [opt]),
      ]),
      resolveMultiLegOptions(pair, (p) => this.fetchBestDirect(p)),
    ]);

    const allOptions: TransportOption[] = [];

    if (directResults.status === 'fulfilled') {
      for (const result of directResults.value) {
        if (result.status === 'fulfilled') {
          allOptions.push(...result.value);
        } else {
          this.logger.debug('Direct transport option unavailable', { reason: String(result.reason) });
        }
      }
    }

    if (multiLegResults.status === 'fulfilled') {
      allOptions.push(...multiLegResults.value);
    }

    if (allOptions.length === 0) {
      throw new Error(`No transport options found from "${pair.from}" to "${pair.to}"`);
    }

    return this.applyFeasibilityGuard(pair, allOptions);
  }

  // Long-distance feasibility + degraded-mode guard.
  //
  // When the flight/train APIs fail (rate-limited, not enabled, deprecated), the
  // only mode that resolves is car. A multi-hour drive then gets presented as a
  // real plan — e.g. a 23h Oslo→Zagreb drive. This guard:
  //   1. synthesises an *estimated* flight when a long leg has no real flight, so
  //      a humane option exists and the orchestrator/LLM stops inventing car-only
  //      routes through made-up overnight cities;
  //   2. tags the car option with a degraded-mode warning so the gap is visible
  //      in the UI instead of silently masquerading as a recommendation.
  private static readonly LONG_LEG_MINUTES = 300; // ~5h door-to-door by car
  private static readonly AVG_ROAD_KMH = 80;

  private applyFeasibilityGuard(pair: CityPair, options: TransportOption[]): TransportOption[] {
    const car = options.find((o) => o.mode === 'car' && !o.segments);
    if (!car || car.durationMinutes <= TransportService.LONG_LEG_MINUTES) {
      return options;
    }

    const hasFlight = options.some(
      (o) => o.mode === 'flight' || o.segments?.some((s) => s.mode === 'flight'),
    );
    const out = [...options];

    if (!hasFlight) {
      const estKm = Math.round((car.durationMinutes / 60) * TransportService.AVG_ROAD_KMH);
      out.push(this.estimateFlightOption(estKm));
      this.logger.info('Synthesised estimated flight for long car-only leg', {
        from: pair.from,
        to: pair.to,
        carHours: Math.round(car.durationMinutes / 60),
      });
    }

    const hours = Math.round(car.durationMinutes / 60);
    const note = hasFlight
      ? `Long drive (~${hours}h) — consider flying.`
      : `Long drive (~${hours}h). Live flight/train search was unavailable, so the flight option shown is an estimate — verify before booking.`;
    car.warnings = [note, ...car.warnings.filter((w) => !w.startsWith('Long drive'))];

    return out;
  }

  // Straight-line flight estimate from a road-distance proxy. Marked clearly as
  // an estimate so it is never mistaken for a live fare.
  private estimateFlightOption(distanceKm: number): TransportOption {
    const airborneMin = Math.round((distanceKm / 750) * 60);
    const durationMinutes = airborneMin + 150; // + airport/transfer overhead
    const priceEur = Math.max(45, Math.round(40 + distanceKm * 0.1));
    return {
      mode: 'flight',
      provider: 'estimate',
      durationMinutes,
      priceEur,
      warnings: ['Estimated flight — live pricing/schedule unavailable; verify before booking'],
    };
  }

  // fetchBestDirect is used by MultiLegRouter to resolve hub→destination legs
  // without recursing into multi-leg routing.
  async fetchBestDirect(pair: CityPair): Promise<TransportOption[]> {
    const results = await Promise.allSettled([
      this.fetchFlights(pair),
      this.fetchTrains(pair),
      this.fetchCar(pair).then((opt) => [opt]),
    ]);
    const allOptions: TransportOption[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allOptions.push(...result.value);
      }
    }
    if (allOptions.length === 0) {
      throw new Error(`No direct transport options found from "${pair.from}" to "${pair.to}"`);
    }
    return allOptions;
  }

  // Lower score = better. The preferred mode gets an ~18% discount so it wins
  // ties and near-ties, but a clearly cheaper/faster option still ranks first.
  private sortByScore(options: TransportOption[], preference?: TransportMode): TransportOption[] {
    const hasPrice = options.some((o) => o.priceEur !== undefined);
    const PREFERENCE_DISCOUNT = 0.82;

    const baseScore = (o: TransportOption): number =>
      hasPrice ? (o.priceEur ?? 999) * 0.6 + (o.durationMinutes / 60) * 40 : o.durationMinutes;

    const score = (o: TransportOption): number =>
      preference && o.mode === preference ? baseScore(o) * PREFERENCE_DISCOUNT : baseScore(o);

    return [...options].sort((a, b) => score(a) - score(b));
  }
}
