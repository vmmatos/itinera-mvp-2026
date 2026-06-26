import { BaseService } from '@itinera/shared';
import type { TransportMode, TransportOption } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';
import type { RedisService } from '@/services/RedisService';
import { resolveMultiLegOptions } from '@/services/MultiLegRouter';

export interface CityPair {
  from: string;
  to: string;
  departureDateIso?: string;
}

// ── sky-scrapper (RapidAPI) response shapes ──────────────────────
// Two-step API: searchAirport (city → skyId/entityId) then searchFlights.
interface SkyAirportResponse {
  data?: Array<{
    navigation?: {
      relevantFlightParams?: { skyId?: string; entityId?: string };
    };
  }>;
}

interface SkyCarrier {
  name?: string;
  alternateId?: string;
}

interface SkyFlightSegment {
  flightNumber?: string;
  marketingCarrier?: SkyCarrier;
}

interface SkyFlightLeg {
  durationInMinutes?: number;
  departure?: string;
  arrival?: string;
  stopCount?: number;
  carriers?: { marketing?: SkyCarrier[] };
  segments?: SkyFlightSegment[];
}

interface SkyItinerary {
  price?: { raw?: number };
  legs?: SkyFlightLeg[];
}

interface SkyFlightsResponse {
  data?: { itineraries?: SkyItinerary[] };
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
  // redis is optional so unit tests can construct without a cache.
  constructor(
    private readonly mapService: MapService,
    private readonly redis?: RedisService,
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

  private get skyHeaders(): Record<string, string> {
    return {
      'X-RapidAPI-Key': config.SKYSCANNER_RAPIDAPI_KEY,
      'X-RapidAPI-Host': config.SKYSCANNER_RAPIDAPI_HOST,
    };
  }

  // Resolve a city/airport name to sky-scrapper's skyId + entityId, required by
  // the searchFlights endpoint. Returns null when no airport matches. Cached for
  // 30 days — airport ids are stable and this is the most-repeated flight call.
  private async resolveAirport(query: string): Promise<{ skyId: string; entityId: string } | null> {
    const city = query.split(',')[0]!.trim();
    const cacheKey = `transport:airport:${this.normKey(city)}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<{ skyId: string; entityId: string }>(cacheKey);
        if (hit?.skyId && hit?.entityId) return hit;
      } catch { /* cache miss path */ }
    }
    const url = `${config.SKYSCANNER_BASE_URL}/api/v1/flights/searchAirport?query=${encodeURIComponent(city)}&locale=en-US`;
    const res = await fetch(url, { headers: this.skyHeaders });
    if (!res.ok) {
      throw new Error(`Skyscanner searchAirport error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as SkyAirportResponse;
    const params = data.data?.[0]?.navigation?.relevantFlightParams;
    if (!params?.skyId || !params?.entityId) return null;
    const result = { skyId: params.skyId, entityId: params.entityId };
    if (this.redis) {
      try { await this.redis.set(cacheKey, result, config.AIRPORT_CACHE_TTL_SECONDS); } catch { /* best-effort */ }
    }
    return result;
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
    if (!config.SKYSCANNER_RAPIDAPI_KEY) {
      throw new Error('Skyscanner API key not configured');
    }

    const [origin, dest] = await Promise.all([
      this.resolveAirport(pair.from),
      this.resolveAirport(pair.to),
    ]);
    if (!origin || !dest) {
      throw new Error(`No airport found for "${pair.from}" or "${pair.to}"`);
    }

    const qs = new URLSearchParams({
      originSkyId: origin.skyId,
      destinationSkyId: dest.skyId,
      originEntityId: origin.entityId,
      destinationEntityId: dest.entityId,
      date: this.flightSearchDate(pair.departureDateIso),
      cabinClass: 'economy',
      adults: '1',
      currency: 'EUR',
      market: 'en-US',
      countryCode: 'US',
    });

    const res = await fetch(`${config.SKYSCANNER_BASE_URL}/api/v2/flights/searchFlights?${qs.toString()}`, {
      headers: this.skyHeaders,
    });
    if (!res.ok) {
      throw new Error(`Skyscanner searchFlights error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as SkyFlightsResponse;
    const itineraries = data.data?.itineraries;
    if (!itineraries || itineraries.length === 0) {
      throw new Error(`No flight found from "${pair.from}" to "${pair.to}"`);
    }

    const options = itineraries.slice(0, 5).map((itin): TransportOption => {
      const leg = itin.legs?.[0];
      const durationMinutes = leg?.durationInMinutes ?? 0;
      const seg = leg?.segments?.[0];
      const carrier = seg?.marketingCarrier ?? leg?.carriers?.marketing?.[0];
      const flightNumber = seg?.flightNumber
        ? `${carrier?.alternateId ?? ''}${seg.flightNumber}`
        : undefined;
      return {
        mode: 'flight',
        provider: carrier?.name ?? 'Skyscanner',
        durationMinutes,
        departureTime: leg?.departure ? leg.departure.slice(11, 16) : undefined,
        arrivalTime: leg?.arrival ? leg.arrival.slice(11, 16) : undefined,
        priceEur: itin.price?.raw !== undefined ? Math.round(itin.price.raw) : undefined,
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
