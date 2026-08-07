import { BaseService } from '@itinera/shared';
import type { LocalTransportOption } from '@itinera/shared';
import { config } from '@/config';
import type { MapService } from '@/services/MapService';
import type { RedisService } from '@/services/RedisService';

interface RoutesTransitStep {
  transitDetails?: {
    transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } };
  };
}

interface RoutesLeg {
  steps?: RoutesTransitStep[];
}

interface RoutesRoute {
  duration?: string; // e.g. "1200s"
  legs?: RoutesLeg[];
}

interface RoutesResponse {
  routes?: RoutesRoute[];
  error?: { code: number; message: string; status: string };
}

/** Parse a Routes API duration string ("1200s") into whole minutes. */
function parseRoutesDuration(d?: string): number {
  if (!d) return 0;
  const secs = Number(d.replace(/s$/, ''));
  return Number.isFinite(secs) ? Math.ceil(secs / 60) : 0;
}

// Fixture used when LOCAL_TRANSIT_MOCK=true — avoids burning net-new Routes
// API quota while developing/testing this feature.
const MOCK_TRANSIT_ROUTE: RoutesResponse = {
  routes: [
    {
      duration: '1500s',
      legs: [{ steps: [{ transitDetails: { transitLine: { name: 'Local Line', vehicle: { type: 'BUS' } } } }] }],
    },
  ],
};

/**
 * Resolves local, point-to-point transport candidates (drive/transit/walk)
 * between a base city and a single activity's venue — the granularity
 * TransportService deliberately does not cover (it only resolves whole
 * inter-city legs). Real duration always comes from Google; cost is always
 * a heuristic since no ticket-price/Uber-price API exists in this stack.
 */
export class LocalTransportService extends BaseService {
  constructor(
    private readonly mapService: MapService,
    private readonly redis?: RedisService,
  ) {
    super('local-transport-service');
  }

  async resolveCandidates(from: string, to: string): Promise<LocalTransportOption[]> {
    const [driveResult, transitResult] = await Promise.allSettled([
      this.fetchDrive(from, to),
      this.fetchTransitCached(from, to),
    ]);

    const options: LocalTransportOption[] = [];

    if (driveResult.status === 'fulfilled') {
      options.push(driveResult.value);
    } else {
      this.logger.debug('Local drive option unavailable', { from, to, reason: String(driveResult.reason) });
    }

    if (transitResult.status === 'fulfilled') {
      options.push(transitResult.value);
    } else {
      this.logger.debug('Local transit option unavailable', { from, to, reason: String(transitResult.reason) });
    }

    const driveDistanceKm = driveResult.status === 'fulfilled' ? driveResult.value.distanceKm : undefined;
    if (driveDistanceKm !== undefined && driveDistanceKm <= config.LOCAL_WALK_MAX_KM) {
      try {
        options.push(await this.fetchWalk(from, to));
      } catch (err) {
        this.logger.debug('Local walk option unavailable', { from, to, error: String(err) });
      }
    }

    if (options.length === 0) {
      throw new Error(`No local transport options found from "${from}" to "${to}"`);
    }
    return options;
  }

  private async fetchDrive(from: string, to: string): Promise<LocalTransportOption> {
    const travelTime = await this.mapService.getTravelTime(from, to, 'driving');
    return {
      mode: 'drive',
      durationMinutes: travelTime.durationMinutes,
      distanceKm: travelTime.distanceKm,
      // Taxi/rideshare proxy heuristic — no Uber API exists in this stack.
      priceEur:
        Number.isFinite(travelTime.distanceKm) && travelTime.distanceKm > 0
          ? Math.round(travelTime.distanceKm * config.LOCAL_DRIVE_COST_EUR_PER_KM)
          : undefined,
      warnings: [],
    };
  }

  private async fetchWalk(from: string, to: string): Promise<LocalTransportOption> {
    const travelTime = await this.mapService.getTravelTime(from, to, 'walking');
    return {
      mode: 'walk',
      durationMinutes: travelTime.durationMinutes,
      distanceKm: travelTime.distanceKm,
      priceEur: 0,
      warnings: [],
    };
  }

  private normKey(s: string): string {
    return s.toLowerCase().split(',')[0]!.trim().replace(/\s+/g, '-');
  }

  private async fetchTransitCached(from: string, to: string): Promise<LocalTransportOption> {
    const key = `local-transport:transit:${this.normKey(from)}|${this.normKey(to)}`;
    if (this.redis) {
      try {
        const hit = await this.redis.get<LocalTransportOption>(key);
        if (hit) {
          this.logger.debug('Local transit cache hit', { key });
          return hit;
        }
      } catch (err) {
        this.logger.debug('Local transit cache read failed', { error: String(err) });
      }
    }

    const option = await this.fetchTransit(from, to);

    if (this.redis) {
      try {
        await this.redis.set(key, option, config.TRANSPORT_CACHE_TTL_SECONDS);
      } catch (err) {
        this.logger.debug('Local transit cache write failed', { error: String(err) });
      }
    }
    return option;
  }

  private async fetchTransit(from: string, to: string): Promise<LocalTransportOption> {
    const data = config.LOCAL_TRANSIT_MOCK
      ? MOCK_TRANSIT_ROUTE
      : await this.callComputeRoutes(from, to);

    if (data.error) {
      throw new Error(`Google Routes API returned ${data.error.status}: ${data.error.message}`);
    }

    const route = data.routes?.[0];
    if (!route) {
      throw new Error(`No local transit route found from "${from}" to "${to}"`);
    }

    const durationMinutes = parseRoutesDuration(route.duration);
    const steps = route.legs?.flatMap((l) => l.steps ?? []) ?? [];
    const transit = steps.find((s) => s.transitDetails);
    const transitLine =
      transit?.transitDetails?.transitLine?.name ?? transit?.transitDetails?.transitLine?.nameShort;
    const transitVehicleType = transit?.transitDetails?.transitLine?.vehicle?.type;

    return {
      mode: 'transit',
      durationMinutes,
      // Flat heuristic fare — Google's per-route transitFare field has too
      // inconsistent per-city coverage to rely on; deliberately not attempted.
      priceEur: config.LOCAL_TRANSIT_FLAT_FARE_EUR,
      transitLine,
      transitVehicleType,
      warnings: [],
    };
  }

  private async callComputeRoutes(from: string, to: string): Promise<RoutesResponse> {
    // Near-term departure — this is a same-trip local hop, not a scheduled
    // booking, so we only need a representative transit route, not a
    // date-accurate one (mirrors TransportService.fetchTrains's rationale).
    const departureTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(`${config.GOOGLE_ROUTES_BASE_URL}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'routes.duration,routes.legs.steps.transitDetails.transitLine.name,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.vehicle.type',
      },
      body: JSON.stringify({
        origin: { address: from },
        destination: { address: to },
        travelMode: 'TRANSIT',
        // No transitPreferences restriction — unlike TransportService's
        // inter-city TRAIN-only search, local trips should surface bus,
        // subway, tram or light rail, whichever Google indexes.
        computeAlternativeRoutes: false,
        departureTime,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Routes API error ${res.status}: ${text}`);
    }
    return (await res.json()) as RoutesResponse;
  }
}
