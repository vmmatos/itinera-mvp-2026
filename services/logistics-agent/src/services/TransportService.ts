import { BaseService } from '@itinera/shared';
import type { TransportMode, TransportOption, TransportSegment } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';
import type { RedisService } from '@/services/RedisService';
import type { PlacesService } from '@/services/PlacesService';
import { resolveMultiLegOptions, buildDisplaySummary } from '@/services/MultiLegRouter';
import { byCity, nearestAirport, nearestAirports, haversineKm } from '@/data/airports';
import { getHubs } from '@/services/HubLookup';
import { rankTransportOptions } from '@/services/TransportScorer';

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
    transitLine?: { name?: string; nameShort?: string; agencies?: Array<{ name?: string }> };
    stopDetails?: {
      departureTime?: string; // RFC3339
      arrivalTime?: string;
      departureStop?: { name?: string };
      arrivalStop?: { name?: string };
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
    // favoured in the weighted ranking (TransportScorer) but a clearly better
    // option can still win. Resolution is cached per city-pair+date
    // (preference-independent) so the preflight, per-day and per-round passes
    // don't each burn API quota — ranking is applied after the cache.
    const options = await this.fetchBestCached(pair);
    return rankTransportOptions(options, preference === 'best' ? undefined : preference);
  }

  private normKey(s: string): string {
    return s
      .toLowerCase()
      .split(',')[0]!
      .trim()
      .replace(/[àáâãä]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/ç/g, 'c')
      .replace(/ñ/g, 'n')
      .replace(/\s+/g, '-');
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

  // Resolve a city/region to an IATA airport code for SerpApi.
  // role='origin': only exact-dataset + geocode; NOT HubLookup — a rural origin
  //   without its own airport must go via the multi-leg router (which adds the
  //   access leg); showing a direct flight as if it departs from the hub is
  //   misleading and undercuts the multi-leg composed option.
  // role='destination': also tries HubLookup — landing at a nearby hub and
  //   continuing by bus is a valid option when the dest lacks its own airport.
  private async resolveAirport(place: string, role: 'origin' | 'destination' = 'destination'): Promise<string | null> {
    const cacheKey = `transport:airport:${role}:${this.normKey(place)}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<{ iata: string | null }>(cacheKey);
        if (hit !== null && hit !== undefined) return hit.iata ?? null;
      } catch { /* cache miss path */ }
    }

    let iata: string | null = byCity(place)?.iata ?? null;

    // Tier 2: geocode → nearest airport (Places API; destination role only).
    // Origins without their own IATA must route via multi-leg, which explicitly adds
    // the access leg. Geocoding an origin to a nearby airport silently drops that leg
    // and misrepresents the real departure city (e.g. Beja → FAO, 50km away).
    if (!iata && role === 'destination' && this.places) {
      try {
        const coord = await this.places.geocodePlace(place);
        if (coord) {
          const airport = nearestAirport(coord.lat, coord.lng);
          const snapKm = haversineKm(coord.lat, coord.lng, airport.lat, airport.lng);
          if (snapKm <= config.MAX_AIRPORT_SNAP_KM) {
            iata = airport.iata;
          } else {
            this.logger.debug('Nearest airport too far — snap rejected', {
              place, airport: airport.iata, snapKm: Math.round(snapKm),
            });
          }
        }
      } catch (err) {
        this.logger.debug('Airport geocode failed', { place, error: String(err) });
      }
    }

    // Tier 3 (destination role only): HubLookup — rural/remote destinations map
    // to a nearby hub airport (e.g. fly into Faro near Mértola, Dublin near Galway).
    // Not applied to origins: a flight departing from the hub without the access
    // leg shown would be misleading; the multi-leg router handles that correctly.
    if (!iata && role === 'destination') {
      const hubs = getHubs(place);
      const airportHub = hubs.find((h) => h.hubType === 'airport');
      if (airportHub) {
        iata = byCity(airportHub.hubCity)?.iata ?? null;
        if (iata) {
          this.logger.debug('Airport resolved via HubLookup', { place, hub: airportHub.hubCity, iata });
        }
      }
    }

    if (this.redis) {
      try {
        // Cache null (no-airport) results with a short TTL so transient failures
        // (Places API blocked in dev) don't hammer the API on every flight attempt.
        const ttl = iata ? config.AIRPORT_CACHE_TTL_SECONDS : 3600;
        await this.redis.set(cacheKey, { iata: iata ?? null }, ttl);
      } catch { /* best-effort */ }
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

  // strictDest=true disables HubLookup on the destination (used by multi-leg router to
  // prevent double-hub resolution: the router already chose a hub for the origin, so
  // mapping the destination to yet another hub would yield a flight that bypasses the
  // actual destination and leaves the final access leg unaccounted for).
  private async fetchFlights(pair: CityPair, strictDest = false): Promise<TransportOption[]> {
    if (!config.SERPAPI_KEY) {
      throw new Error('SerpApi key not configured');
    }

    const [originIata, destIata] = await Promise.all([
      this.resolveAirport(pair.from, 'origin'),
      this.resolveAirport(pair.to, strictDest ? 'origin' : 'destination'),
    ]);
    if (!originIata || !destIata) {
      throw new Error(`No airport found for "${pair.from}" or "${pair.to}"`);
    }
    if (originIata === destIata) {
      throw new Error(`Same airport for "${pair.from}" and "${pair.to}" — no flight`);
    }

    // When the destination was resolved via HubLookup (rural city → nearby hub airport),
    // the flight lands at the hub but the passenger still needs ground transport to the
    // actual city. Add that access leg's time + cost so scoring reflects door-to-door reality.
    let destHubAccessMinutes = 0;
    let destHubAccessCostEur = 0;
    if (!strictDest && byCity(pair.to)?.iata !== destIata) {
      const destHubs = getHubs(pair.to);
      const airportHub = destHubs.find(
        (h) => h.hubType === 'airport' && byCity(h.hubCity)?.iata === destIata,
      );
      if (airportHub) {
        destHubAccessMinutes = airportHub.accessMinutes;
        destHubAccessCostEur = airportHub.accessCostEur;
        this.logger.debug('Adding destination hub access time to flight options', {
          dest: pair.to,
          hub: airportHub.hubCity,
          accessMinutes: destHubAccessMinutes,
        });
      }
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
        const airborneMinutes = itin.total_duration ?? legs.reduce((s, l) => s + (l.duration ?? 0), 0);
        // Include destination ground leg (airport → city) when destination is a rural hub-resolved city.
        const durationMinutes = airborneMinutes + destHubAccessMinutes;
        const stops = itin.layovers?.length ?? Math.max(0, legs.length - 1);
        const warnings: string[] = [];
        if (stops > 0) warnings.push(`${stops} stop${stops > 1 ? 's' : ''}`);
        if (durationMinutes > 240) warnings.push('Travel exceeds 4h — consider reducing activities on travel day');
        if (destHubAccessMinutes > 0) {
          const transferH = Math.round((destHubAccessMinutes / 60) * 10) / 10;
          warnings.push(`+${transferH}h transfer from ${destIata} airport to ${pair.to} (not included in flight time above)`);
        }
        return {
          mode: 'flight',
          provider: first?.airline ?? 'Google Flights',
          durationMinutes,
          // SerpApi times are local "YYYY-MM-DD HH:MM" — slice HH:MM directly.
          departureTime: serpClock(first?.departure_airport?.time),
          arrivalTime: serpClock(last?.arrival_airport?.time),
          priceEur: typeof itin.price === 'number' ? Math.round(itin.price) + destHubAccessCostEur : undefined,
          flightNumber: first?.flight_number?.replace(/\s+/g, ''),
          originAirport: first?.departure_airport?.name
            ? `${first.departure_airport.id ?? originIata} – ${first.departure_airport.name}`
            : originIata ?? undefined,
          destinationAirport: last?.arrival_airport?.name
            ? `${last.arrival_airport.id ?? destIata} – ${last.arrival_airport.name}`
            : destIata ?? undefined,
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
            'routes.duration,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.agencies,routes.legs.steps.transitDetails.stopDetails',
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
        // Real rail operator (e.g. "SBB", "SNCF", "CP") as reported by Google for
        // this specific route — never assume a nationality when it's missing.
        const agencyName = transit?.transitDetails?.transitLine?.agencies?.[0]?.name;
        const departureTimeIso = transit?.transitDetails?.stopDetails?.departureTime;
        const departureStopName = transit?.transitDetails?.stopDetails?.departureStop?.name;
        const lastTransitStep = [...steps].reverse().find((s) => s.transitDetails?.stopDetails?.arrivalTime);
        const arrivalTimeIso = lastTransitStep?.transitDetails?.stopDetails?.arrivalTime;
        const arrivalStopName = lastTransitStep?.transitDetails?.stopDetails?.arrivalStop?.name;
        return {
          mode: 'train',
          provider: agencyName ?? trainLine ?? 'Train',
          durationMinutes,
          departureTime: clockFromIso(departureTimeIso),
          arrivalTime: clockFromIso(arrivalTimeIso),
          priceEur: estimateRailFareEur(durationMinutes),
          trainLine,
          fromStop: departureStopName,
          toStop: arrivalStopName,
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
      // Fuel+tolls heuristic so the drive carries a price and competes fairly
      // in the weighted ranking instead of being treated as unpriced.
      priceEur:
        Number.isFinite(travelTime.distanceKm) && travelTime.distanceKm > 0
          ? Math.round(travelTime.distanceKm * config.CAR_COST_EUR_PER_KM)
          : undefined,
      warnings: durationMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : [],
    };
  }

  // Geodesic distance between the two endpoints, or undefined when geocoding is
  // unavailable — callers must treat undefined as "no distance guard" and never
  // block an option for lack of data. Coordinates are Redis-cached (30d).
  private async geodesicKm(from: string, to: string): Promise<number | undefined> {
    const [a, b] = await Promise.all([this.geocodeCached(from), this.geocodeCached(to)]);
    if (!a || !b) return undefined;
    return haversineKm(a.lat, a.lng, b.lat, b.lng);
  }

  private async geocodeCached(place: string): Promise<{ lat: number; lng: number } | null> {
    // A dataset airport city needs no geocode round-trip — use its coordinates.
    const known = byCity(place);
    if (known) return { lat: known.lat, lng: known.lng };
    if (!this.places) return null;

    const cacheKey = `transport:coords:${this.normKey(place)}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<{ coords: { lat: number; lng: number } | null }>(cacheKey);
        if (hit !== null && hit !== undefined) return hit.coords;
      } catch { /* cache miss path */ }
    }

    let coords: { lat: number; lng: number } | null = null;
    try {
      coords = await this.places.geocodePlace(place);
    } catch (err) {
      this.logger.debug('Geocode failed', { place, error: String(err) });
    }

    if (this.redis) {
      try {
        // Null (geocode failure) cached briefly so transient API failures don't
        // hammer Places on every resolution.
        const ttl = coords ? config.AIRPORT_CACHE_TTL_SECONDS : 3600;
        await this.redis.set(cacheKey, { coords }, ttl);
      } catch { /* best-effort */ }
    }
    return coords;
  }

  private async fetchBest(pair: CityPair): Promise<TransportOption[]> {
    // Guard: same-city pair (LLM sometimes emits city→city self-transitions).
    const normA = pair.from.toLowerCase().split(',')[0]!.trim();
    const normB = pair.to.toLowerCase().split(',')[0]!.trim();
    if (normA === normB) return [];

    // Distance guard: below MIN_FLIGHT_DISTANCE_KM a flight makes no sense —
    // never search, synthesise or hub-compose one. This is what stops fabricated
    // flights on short land legs (e.g. Mértola→Comporta, ~150km) and protects
    // SerpApi quota. Fabrication only happens when an endpoint lacks its own
    // airport and gets snapped to a distant one via geocode/HubLookup — a pair
    // of true airport cities (LIS↔OPO) is a real route, so it skips the guard.
    // Unknown distance (geocode down) leaves flights enabled: never block an
    // option for lack of data.
    const bothHaveOwnAirports = byCity(pair.from) !== undefined && byCity(pair.to) !== undefined;
    const distanceKm = bothHaveOwnAirports ? undefined : await this.geodesicKm(pair.from, pair.to);
    const flightsAllowed =
      bothHaveOwnAirports || distanceKm === undefined || distanceKm >= config.MIN_FLIGHT_DISTANCE_KM;
    if (!flightsAllowed) {
      this.logger.debug('Flights disabled for short leg', { from: pair.from, to: pair.to, distanceKm });
    }

    const [directResults, multiLegResults, driveToHubResults] = await Promise.allSettled([
      Promise.allSettled([
        ...(flightsAllowed ? [this.fetchFlights(pair)] : []),
        this.fetchTrains(pair),
        this.fetchCar(pair).then((opt) => [opt]),
      ]),
      resolveMultiLegOptions(pair, (p) => this.fetchBestDirect(p), {
        skipAirportHubs: !flightsAllowed,
      }),
      flightsAllowed ? this.fetchDriveToHub(pair) : Promise.resolve([]),
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
    if (driveToHubResults.status === 'fulfilled') {
      allOptions.push(...driveToHubResults.value);
    }

    if (allOptions.length === 0) {
      throw new Error(`No transport options found from "${pair.from}" to "${pair.to}"`);
    }

    return this.applyFeasibilityGuard(pair, this.applyDetourCap(allOptions), flightsAllowed);
  }

  // Composed routes that take much longer than simply driving are absurd
  // detours (e.g. bus south to a hub then back past the origin) — drop them.
  private static readonly DETOUR_CAP_MULTIPLIER = 2.5;

  private applyDetourCap(options: TransportOption[]): TransportOption[] {
    const directCar = options.find((o) => o.mode === 'car' && !o.segments);
    if (!directCar) return options;
    const cap = directCar.durationMinutes * TransportService.DETOUR_CAP_MULTIPLIER;
    return options.filter((o) => !o.segments || o.durationMinutes <= cap);
  }

  // Hybrid "drive to a nearby airport, then fly" composition — the organic
  // option for a car-leaning traveller on a long leg from a city without its
  // own airport (e.g. Mértola→Barcelona as car to Faro/Lisboa + flight).
  // Candidates are the nearest dataset airports; the onward flight goes through
  // the same strict path the multi-leg router uses. Only called for legs at or
  // above MIN_FLIGHT_DISTANCE_KM.
  private static readonly DRIVE_TO_HUB_CANDIDATES = 2;

  private async fetchDriveToHub(pair: CityPair): Promise<TransportOption[]> {
    // Origin already has its own airport → the direct flight path covers it.
    if (byCity(pair.from)) return [];
    const origin = await this.geocodeCached(pair.from);
    if (!origin) return [];

    const candidates = nearestAirports(origin.lat, origin.lng, TransportService.DRIVE_TO_HUB_CANDIDATES)
      .filter((a) => haversineKm(origin.lat, origin.lng, a.lat, a.lng) <= config.MAX_AIRPORT_SNAP_KM);
    const results: TransportOption[] = [];

    await Promise.allSettled(
      candidates.map(async (airport) => {
        const [drive, flights] = await Promise.all([
          this.mapService.getTravelTime(pair.from, airport.city, 'driving'),
          this.fetchFlights({ from: airport.city, to: pair.to, departureDateIso: pair.departureDateIso }, true),
        ]);

        const flight = flights[0];
        if (!flight) return;

        const accessSegment: TransportSegment = {
          from: pair.from,
          to: airport.city,
          mode: 'car',
          provider: 'Google Maps',
          durationMinutes: drive.durationMinutes,
          priceEur: Math.round(drive.distanceKm * config.CAR_COST_EUR_PER_KM),
        };
        const flightSegment: TransportSegment = {
          from: airport.city,
          to: pair.to,
          mode: 'flight',
          provider: flight.provider,
          durationMinutes: flight.durationMinutes,
          priceEur: flight.priceEur,
          departureTime: flight.departureTime,
          flightNumber: flight.flightNumber,
          fromStop: flight.originAirport,
          toStop: flight.destinationAirport,
        };

        const segments = [accessSegment, flightSegment];
        const totalMinutes = drive.durationMinutes + flight.durationMinutes;
        const totalCostEur = (accessSegment.priceEur ?? 0) + (flight.priceEur ?? 0);

        results.push({
          mode: 'flight',
          provider: flight.provider,
          durationMinutes: totalMinutes,
          departureTime: flight.departureTime,
          arrivalTime: flight.arrivalTime,
          priceEur: totalCostEur,
          flightNumber: flight.flightNumber,
          warnings: [
            ...(totalMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : []),
            ...flight.warnings.filter((w) => !w.includes('Travel exceeds 4h')),
          ],
          segments,
          displaySummary: buildDisplaySummary(segments, totalMinutes, totalCostEur),
        });
      }),
    );

    return results;
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

  private applyFeasibilityGuard(
    pair: CityPair,
    options: TransportOption[],
    flightsAllowed: boolean,
  ): TransportOption[] {
    const car = options.find((o) => o.mode === 'car' && !o.segments);
    if (!car || car.durationMinutes <= TransportService.LONG_LEG_MINUTES) {
      return options;
    }

    const hasFlight = options.some(
      (o) => o.mode === 'flight' || o.segments?.some((s) => s.mode === 'flight'),
    );
    const out = [...options];

    // Never synthesise a flight below the minimum flight distance — a long
    // drive on a short geodesic leg (mountain roads) has no plausible air route.
    if (!hasFlight && flightsAllowed) {
      const estKm = Math.round((car.durationMinutes / 60) * TransportService.AVG_ROAD_KMH);
      out.push(this.estimateFlightOption(estKm));
      this.logger.info('Synthesised estimated flight for long car-only leg', {
        from: pair.from,
        to: pair.to,
        carHours: Math.round(car.durationMinutes / 60),
      });
    }

    const hours = Math.round(car.durationMinutes / 60);
    let note: string;
    if (hasFlight) {
      note = `Long drive (~${hours}h) — consider flying.`;
    } else if (flightsAllowed) {
      note = `Long drive (~${hours}h). Live flight/train search was unavailable, so the flight option shown is an estimate — verify before booking.`;
    } else {
      note = `Long drive (~${hours}h).`;
    }
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

  // Distance-aware last-resort estimate for a leg where every real mode failed
  // to resolve (no airport coverage, no road, APIs down). Used by the route-graph
  // endpoint instead of a fixed placeholder so an intercontinental leg is never
  // presented as a short drive. Long legs get a synthesised flight, short legs a
  // car estimate; unknown distance falls back to a generic 2h car placeholder.
  async estimateLeg(pair: CityPair): Promise<TransportOption> {
    const km = await this.geodesicKm(pair.from, pair.to);
    if (km === undefined) {
      return {
        mode: 'car',
        durationMinutes: 120,
        warnings: ['No transport options found — estimate only'],
      };
    }
    if (km >= config.MIN_FLIGHT_DISTANCE_KM) {
      const flight = this.estimateFlightOption(Math.round(km));
      return {
        ...flight,
        warnings: ['No transport options found — estimated flight, verify before booking'],
      };
    }
    return {
      mode: 'car',
      durationMinutes: Math.round((km / TransportService.AVG_ROAD_KMH) * 60),
      priceEur: Math.round(km * config.CAR_COST_EUR_PER_KM),
      warnings: ['No transport options found — estimate only'],
    };
  }

  // fetchBestDirect is used by MultiLegRouter to resolve hub→destination legs
  // without recursing into multi-leg routing.
  async fetchBestDirect(pair: CityPair): Promise<TransportOption[]> {
    const results = await Promise.allSettled([
      this.fetchFlights(pair, true), // strictDest: no HubLookup on dest (multi-leg context)
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

}
