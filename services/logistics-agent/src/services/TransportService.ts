import { BaseService } from '@itinera/shared';
import type { TransportMode, TransportOption } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';
import type { RedisService } from '@/services/RedisService';
import type { PlacesService } from '@/services/PlacesService';
import { resolveMultiLegOptions } from '@/services/MultiLegRouter';
import { byCity, nearestAirport } from '@/data/airports';

export interface CityPair {
  from: string;
  to: string;
  departureDateIso?: string;
}

// ── SerpApi Google Flights response shapes ───────────────────────
interface SerpFlightLeg {
  departure_airport?: { id?: string; name?: string; time?: string };
  arrival_airport?: { id?: string; name?: string; time?: string };
  duration?: number; // minutes
  airline?: string;
  flight_number?: string;
}

interface SerpFlightOption {
  flights?: SerpFlightLeg[];
  layovers?: Array<{ id?: string; duration?: number }>;
  total_duration?: number; // minutes
  price?: number; // in requested currency, per the configured passenger count
}

interface SerpFlightsResponse {
  best_flights?: SerpFlightOption[];
  other_flights?: SerpFlightOption[];
  error?: string;
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

/** "HH:MM" from a SerpApi local timestamp "YYYY-MM-DD HH:MM", or undefined. */
function serpClock(t?: string): string | undefined {
  if (!t || t.length < 16) return undefined;
  return t.slice(11, 16);
}

export class TransportService extends BaseService {
  // redis + places are optional so unit tests can construct without them.
  constructor(
    private readonly mapService: MapService,
    private readonly redis?: RedisService,
    private readonly places?: PlacesService,
  ) {
    super('transport-service');
  }

  async resolveTransportOptions(
    pair: CityPair,
    preference: TransportMode,
  ): Promise<TransportOption[]> {
    // Always offer every mode as an alternative; the user's preferred mode is
    // favoured in the ranking (F4) but a clearly better option can still win.
    // Resolution is cached per city-pair+date (preference-independent) so the
    // preflight, per-day and per-round passes don't each burn API quota.
    const options = await this.fetchBestCached(pair);
    return this.sortByScore(options, preference === 'best' ? undefined : preference);
  }

  private normKey(s: string): string {
    return s.toLowerCase().split(',')[0]!.trim().replace(/\s+/g, '-');
  }

  // Cache wrapper around fetchBest, keyed by normalised city pair + date.
  private async fetchBestCached(pair: CityPair): Promise<TransportOption[]> {
    const key = `transport:legs:${this.normKey(pair.from)}|${this.normKey(pair.to)}|${pair.departureDateIso?.slice(0, 10) ?? 'na'}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<TransportOption[]>(key);
        if (hit && hit.length > 0) {
          this.logger.debug('Transport cache hit', { key });
          return hit;
        }
      } catch (err) {
        this.logger.debug('Transport cache read failed', { error: String(err) });
      }
    }
    const options = await this.fetchBest(pair);
    if (this.redis) {
      try {
        await this.redis.set(key, options, config.TRANSPORT_CACHE_TTL_SECONDS);
      } catch (err) {
        this.logger.debug('Transport cache write failed', { error: String(err) });
      }
    }
    return options;
  }

  // Resolve a destination (city, town or region) to an IATA airport code for
  // SerpApi, which needs codes rather than names. Layered: exact dataset match
  // first, then geocode + nearest airport. Cached 30 days. Null when unresolved.
  private async resolveAirport(place: string): Promise<string | null> {
    const cacheKey = `transport:airport:${this.normKey(place)}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<{ iata: string }>(cacheKey);
        if (hit?.iata) return hit.iata;
      } catch { /* cache miss path */ }
    }

    let iata: string | null = byCity(place)?.iata ?? null;
    if (!iata && this.places) {
      try {
        const coord = await this.places.geocodePlace(place);
        if (coord) iata = nearestAirport(coord.lat, coord.lng).iata;
      } catch (err) {
        this.logger.debug('Airport geocode failed', { place, error: String(err) });
      }
    }

    if (iata && this.redis) {
      try { await this.redis.set(cacheKey, { iata }, config.AIRPORT_CACHE_TTL_SECONDS); } catch { /* best-effort */ }
    }
    return iata;
  }

  // Airlines publish schedules ~330 days out; clamp far-future trip dates so a
  // flexible booking a year+ ahead still returns representative fares.
  private static readonly FLIGHT_HORIZON_DAYS = 300;

  private flightSearchDate(departureDateIso?: string): string {
    const nearTerm = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (!departureDateIso) return nearTerm.toISOString().slice(0, 10);
    const d = new Date(`${departureDateIso.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return nearTerm.toISOString().slice(0, 10);
    const horizonMs = TransportService.FLIGHT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    if (d.getTime() - Date.now() > horizonMs) return nearTerm.toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  private async fetchFlights(pair: CityPair): Promise<TransportOption[]> {
    if (!config.SERPAPI_KEY) {
      throw new Error('SerpApi key not configured');
    }

    const [originIata, destIata] = await Promise.all([
      this.resolveAirport(pair.from),
      this.resolveAirport(pair.to),
    ]);
    if (!originIata || !destIata) {
      throw new Error(`No airport found for "${pair.from}" or "${pair.to}"`);
    }
    if (originIata === destIata) {
      throw new Error(`Same airport for "${pair.from}" and "${pair.to}" — no flight`);
    }

    const qs = new URLSearchParams({
      engine: 'google_flights',
      departure_id: originIata,
      arrival_id: destIata,
      outbound_date: this.flightSearchDate(pair.departureDateIso),
      type: '2', // one-way (no return_date needed)
      currency: 'EUR',
      hl: 'en',
      api_key: config.SERPAPI_KEY,
    });

    const res = await fetch(`${config.SERPAPI_BASE_URL}?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`SerpApi google_flights error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as SerpFlightsResponse;
    if (data.error) {
      throw new Error(`SerpApi google_flights returned: ${data.error}`);
    }

    const itineraries = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
    if (itineraries.length === 0) {
      throw new Error(`No flight found from "${pair.from}" to "${pair.to}"`);
    }

    return itineraries
      .slice(0, 5)
      .map((itin): TransportOption => {
        const legs = itin.flights ?? [];
        const first = legs[0];
        const last = legs[legs.length - 1];
        const durationMinutes = itin.total_duration ?? legs.reduce((s, l) => s + (l.duration ?? 0), 0);
        const stops = itin.layovers?.length ?? Math.max(0, legs.length - 1);
        const warnings: string[] = [];
        if (stops > 0) warnings.push(`${stops} stop${stops > 1 ? 's' : ''}`);
        if (durationMinutes > 240) warnings.push('Travel exceeds 4h — consider reducing activities on travel day');
        return {
          mode: 'flight',
          provider: first?.airline ?? 'Google Flights',
          durationMinutes,
          // SerpApi times are local "YYYY-MM-DD HH:MM" — slice HH:MM directly.
          departureTime: serpClock(first?.departure_airport?.time),
          arrivalTime: serpClock(last?.arrival_airport?.time),
          priceEur: typeof itin.price === 'number' ? Math.round(itin.price) : undefined,
          flightNumber: first?.flight_number?.replace(/\s+/g, ''),
          warnings,
        };
      })
      .sort((a, b) => (a.priceEur ?? 9e9) - (b.priceEur ?? 9e9));
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
