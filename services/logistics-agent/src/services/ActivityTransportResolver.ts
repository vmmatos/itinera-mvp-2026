import { BaseService, evaluateTransportPriority, evaluateLocalTransportPriority, mapTransportModeToLocalPreference } from '@itinera/shared';
import type { TransportMode, TransportOption, TransportLeg, LocalTransportPriorityResult } from '@itinera/shared';
import { config } from '@/config';
import type { PlacesService } from '@/services/PlacesService';
import type { LocalTransportService } from '@/services/LocalTransportService';
import type { TransportService } from '@/services/TransportService';
import { byCity, haversineKm } from '@/data/airports';

export interface ActivityInput {
  activity?: string;
  venue?: string;
  estimatedCostPerPerson?: number;
  localTransport?: LocalTransportPriorityResult;
  dayTripTransport?: TransportOption;
  [key: string]: unknown;
}

export interface DayInput {
  day: number;
  city: string;
  activities: ActivityInput[];
  transport?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ActivityTransportResult {
  itinerary: DayInput[];
  satelliteLegs: TransportLeg[];
}

// Same placeholder pattern WorkflowEngine.TRANSIT_ACTIVITY_PATTERN uses to
// keep travel/check-in/rest slots out of itinerary-cost logic — duplicated
// here (rather than shared) since orchestrator and logistics-agent are
// separate services that cannot import each other's src/.
const PLACEHOLDER_ACTIVITY_PATTERN =
  /travel|fly|flight|drive|depart|journey|transfer|transit|check[ -]?in|check[ -]?out|rest|arriv/i;

// A single local hop (hotel → activity) has no access to the trip's overall
// budget at this granularity, so these are fixed, generous sanity ceilings —
// not a real budget check (BudgetValidator still owns that downstream).
const LOCAL_BUDGET_CEILING_EUR_PER_PERSON = 40;
const LOCAL_TIME_LIMIT_MINUTES = 90;
// Round-trip day-trip ceilings — roughly double the single-leg inter-city
// defaults WorkflowEngine uses, since this covers both directions.
const DAY_TRIP_BUDGET_CEILING_EUR_PER_PERSON = 150;
const DAY_TRIP_TIME_LIMIT_MINUTES = 480;

/**
 * Resolves how to get from each day's base city to each activity's specific
 * venue — the granularity nothing in this codebase covered before. Forks on
 * distance: a different-town day trip (e.g. Sintra from a Lisbon base) reuses
 * the full inter-city TransportService as a round-trip satellite leg; a
 * genuinely local hop resolves drive/transit/walk candidates instead.
 */
export class ActivityTransportResolver extends BaseService {
  constructor(
    private readonly places: PlacesService,
    private readonly localTransport: LocalTransportService,
    private readonly transportService: TransportService,
  ) {
    super('activity-transport-resolver');
  }

  async resolveForItinerary(
    itinerary: DayInput[],
    dateByDay: Map<number, string>,
    preferredTransport: TransportMode,
  ): Promise<ActivityTransportResult> {
    const satelliteLegs: TransportLeg[] = [];

    const resultItinerary = await Promise.all(
      itinerary.map(async (day) => {
        const cityCoord = await this.geocodeCached(day.city);

        const activities = await Promise.all(
          day.activities.map(async (activity) => {
            if (this.isPlaceholder(activity)) return activity;
            if (!activity.venue) return activity;

            const venueCoord = await this.geocodeCached(activity.venue);
            if (!cityCoord || !venueCoord) return activity;

            const distanceKm = haversineKm(cityCoord.lat, cityCoord.lng, venueCoord.lat, venueCoord.lng);

            if (distanceKm >= config.DAY_TRIP_DISTANCE_THRESHOLD_KM) {
              const leg = await this.resolveDayTrip(
                day.city,
                activity.venue,
                dateByDay.get(day.day),
                preferredTransport,
              ).catch((err) => {
                this.logger.debug('Day-trip transport resolution failed', {
                  from: day.city, to: activity.venue, error: String(err),
                });
                return null;
              });
              if (!leg) return activity;

              satelliteLegs.push(leg);
              this.appendSatelliteTransportEntry(day, leg);
              return { ...activity, dayTripTransport: leg.bestOption };
            }

            const local = await this.resolveLocal(day.city, activity.venue, preferredTransport).catch((err) => {
              this.logger.debug('Local transport resolution failed', {
                from: day.city, to: activity.venue, error: String(err),
              });
              return null;
            });
            if (!local) return activity;

            this.appendLocalTransportEntry(day, day.city, activity.venue, local);
            return { ...activity, localTransport: local };
          }),
        );

        return { ...day, activities };
      }),
    );

    return { itinerary: resultItinerary, satelliteLegs };
  }

  private isPlaceholder(activity: ActivityInput): boolean {
    if (activity.estimatedCostPerPerson === 0) return true;
    return typeof activity.activity === 'string' && PLACEHOLDER_ACTIVITY_PATTERN.test(activity.activity);
  }

  private async geocodeCached(place: string): Promise<{ lat: number; lng: number } | null> {
    const known = byCity(place);
    if (known) return { lat: known.lat, lng: known.lng };
    try {
      return await this.places.geocodePlace(place);
    } catch (err) {
      this.logger.debug('Geocode failed', { place, error: String(err) });
      return null;
    }
  }

  private async resolveDayTrip(
    baseCity: string,
    venue: string,
    departureDateIso: string | undefined,
    preferredTransport: TransportMode,
  ): Promise<TransportLeg | null> {
    const [outboundOptions, returnOptions] = await Promise.all([
      this.transportService.resolveTransportOptions({ from: baseCity, to: venue, departureDateIso }, preferredTransport),
      this.transportService.resolveTransportOptions({ from: venue, to: baseCity, departureDateIso }, preferredTransport),
    ]);
    if (outboundOptions.length === 0 || returnOptions.length === 0) return null;

    const outbound = evaluateTransportPriority(
      preferredTransport,
      outboundOptions,
      DAY_TRIP_BUDGET_CEILING_EUR_PER_PERSON,
      DAY_TRIP_TIME_LIMIT_MINUTES,
    );

    // Apply the same selected mode to the return leg when available; otherwise
    // fall back to the return leg's own top-ranked option.
    const matchingReturn = returnOptions.find((o) => o.mode === outbound.selectedMode) ?? returnOptions[0]!;

    const combined: TransportOption = {
      mode: outbound.selectedOption.mode,
      provider: outbound.selectedOption.provider,
      durationMinutes: outbound.selectedOption.durationMinutes + matchingReturn.durationMinutes,
      priceEur:
        outbound.selectedOption.priceEur !== undefined || matchingReturn.priceEur !== undefined
          ? (outbound.selectedOption.priceEur ?? 0) + (matchingReturn.priceEur ?? 0)
          : undefined,
      warnings: [
        ...outbound.selectedOption.warnings,
        ...matchingReturn.warnings,
        'Round-trip day trip — outbound and return resolved independently',
      ],
    };

    return {
      from: baseCity,
      to: venue,
      departureDate: departureDateIso ?? '',
      bestOption: combined,
      alternatives: outboundOptions.filter((o) => o !== outbound.selectedOption).slice(0, 3),
      totalCostEurPerPerson: combined.priceEur ?? 0,
    };
  }

  private async resolveLocal(
    baseCity: string,
    venue: string,
    preferredTransport: TransportMode,
  ): Promise<LocalTransportPriorityResult | null> {
    const candidates = await this.localTransport.resolveCandidates(baseCity, venue);
    if (candidates.length === 0) return null;

    return evaluateLocalTransportPriority(
      mapTransportModeToLocalPreference(preferredTransport),
      candidates,
      LOCAL_BUDGET_CEILING_EUR_PER_PERSON,
      LOCAL_TIME_LIMIT_MINUTES,
    );
  }

  // Same shape/tagging convention as WorkflowEngine.buildTransportEntry for
  // ordinary inter-city legs — deliberately untagged (no isEstimate/source):
  // this leg was resolved by the same TransportService as every other leg,
  // so it inherits BudgetBreakdownBuilder's "untagged transport = real" default.
  private appendSatelliteTransportEntry(day: DayInput, leg: TransportLeg): void {
    const entry = {
      from: leg.from,
      to: leg.to,
      mode: leg.bestOption.mode,
      provider: leg.bestOption.provider,
      durationMinutes: leg.bestOption.durationMinutes,
      priceEur: leg.bestOption.priceEur,
      cost: leg.bestOption.priceEur,
      currency: 'EUR',
      warnings: leg.bestOption.warnings,
    };
    day.transport = Array.isArray(day.transport) ? [...day.transport, entry] : [entry];
  }

  // Local drive/transit/walk costs are new heuristic categories that never
  // existed before this feature — must be explicitly tagged, or
  // BudgetBreakdownBuilder.aggregateFlags silently defaults untagged
  // transport items to isEstimate:false (confirmed real pricing).
  private appendLocalTransportEntry(
    day: DayInput,
    from: string,
    to: string,
    result: LocalTransportPriorityResult,
  ): void {
    const entry = {
      from,
      to,
      mode: result.selectedMode,
      durationMinutes: result.selectedOption.durationMinutes,
      priceEur: result.selectedOption.priceEur ?? 0,
      cost: result.selectedOption.priceEur ?? 0,
      currency: 'EUR',
      isEstimate: true,
      source: result.selectedMode === 'transit' ? 'google_routes_transit_heuristic_fare' : 'heuristic_estimate',
      warnings: result.selectedOption.warnings,
    };
    day.transport = Array.isArray(day.transport) ? [...day.transport, entry] : [entry];
  }
}
