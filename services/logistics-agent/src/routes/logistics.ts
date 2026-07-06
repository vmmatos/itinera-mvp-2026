import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, createLogger } from '@itinera/shared';
import type { TransportMode, TransportOption, RouteGraph, CityStay, TimeWindow, TransportLeg } from '@itinera/shared';
import type { WeatherService } from '@/services/WeatherService';
import type { AttractionDB } from '@/services/AttractionDB';
import type { RedisService } from '@/services/RedisService';
import type { TimingValidator, ScheduledActivity, ScheduledTransport } from '@/validators/TimingValidator';
import type { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import type { HolidayService } from '@/services/HolidayService';
import type { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import type { TransportService } from '@/services/TransportService';
import { buildLogisticsVerdict } from '@/services/LogisticsVerdict';
import { toCountryCode } from '@/utils/countryCodeMapper';
import { config } from '@/config';

const DateInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode:      z.literal('fixed'),
    startDate: z.string(),
    endDate:   z.string(),
  }),
  z.object({
    mode:           z.literal('flexible'),
    days:           z.number().int().min(1),
    preferredMonth: z.string().optional(),
    window:         z.enum(['tight', 'moderate', 'open']),
  }),
]).nullable().optional();

const ValidateSchema = z.object({
  tripId:              z.string().uuid(),
  round:               z.number().int().min(1),
  proposal:            z.record(z.unknown()),
  region:              z.string().default('unknown'),
  context:             z.string().optional().default(''),
  dateInput:           DateInputSchema,
  transportPreference: z.enum(['flight', 'train', 'car', 'best']).default('best').optional(),
});

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const SLOTS = ['morning', 'afternoon', 'evening'] as const;

const logger = createLogger('logistics-routes');

/** Maps HH:MM → slot index (0=morning, 1=afternoon, 2=evening). Returns null if time is absent. */
function timeToSlotIndex(time: string | undefined): number | null {
  if (!time) return null;
  const h = parseInt(time.split(':')[0] ?? '0', 10);
  if (h < 12) return 0;
  if (h < 18) return 1;
  return 2;
}

/**
 * Computes the arrival slot index from departure time + duration.
 * Handles midnight rollover via modulo — result is always 0/1/2.
 */
function computeArrivalSlotIndex(departureTime: string | undefined, durationMinutes: number): number | null {
  if (!departureTime) return null;
  const [hStr, mStr] = departureTime.split(':');
  const totalMinutes = parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10) + durationMinutes;
  const arrivalHour = Math.floor(totalMinutes / 60) % 24;
  if (arrivalHour < 12) return 0;
  if (arrivalHour < 18) return 1;
  return 2;
}

/** True when the journey lands past midnight relative to its departure day (e.g. 21:15 + 3h17m → 00:10 next day). */
function crossesMidnight(departureTime: string | undefined, durationMinutes: number): boolean {
  if (!departureTime) return false;
  const [hStr, mStr] = departureTime.split(':');
  return parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10) + durationMinutes >= 24 * 60;
}

const AttractionQuerySchema = z.object({
  category: z.string().optional(),
});

const WeatherQuerySchema = z.object({
  date: z.string().optional(),
});

export function createLogisticsRouter(
  weather: WeatherService,
  attractions: AttractionDB,
  timing: TimingValidator,
  analyzer: WeatherAnalyzer,
  redis: RedisService,
  holidayService: HolidayService,
  restrictionsValidator: RestrictionsValidator,
  transportService: TransportService,
): Router {
  const router = Router();

  router.post('/validate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { tripId, round, proposal, region, dateInput, transportPreference } = parsed.data;

    const allActivities: ScheduledActivity[] = [];
    const allTransport: ScheduledTransport[] = [];

    type RawDay = Record<string, unknown>;
    const rawItinerary = Array.isArray(proposal['itinerary']) ? (proposal['itinerary'] as RawDay[]) : [];

    for (const day of rawItinerary) {
      const dayNum = typeof day['day'] === 'number' ? day['day'] : 1;
      const rawActivities = Array.isArray(day['activities']) ? (day['activities'] as RawDay[]) : [];
      const rawTransport = Array.isArray(day['transport']) ? (day['transport'] as RawDay[]) : [];

      for (const act of rawActivities) {
        if (typeof act['name'] === 'string' && typeof act['startTime'] === 'string' && typeof act['endTime'] === 'string') {
          allActivities.push({
            day: dayNum,
            name: act['name'],
            startTime: act['startTime'],
            endTime: act['endTime'],
            location: typeof act['location'] === 'string' ? act['location'] : region,
          });
        }
      }
      for (const leg of rawTransport) {
        if (typeof leg['from'] === 'string' && typeof leg['to'] === 'string' && typeof leg['startTime'] === 'string') {
          allTransport.push({
            day: dayNum,
            from: leg['from'],
            to: leg['to'],
            startTime: leg['startTime'],
            durationMinutes: typeof leg['durationMinutes'] === 'number' ? leg['durationMinutes'] : 0,
          });
        }
      }
    }

    const timingResult = timing.validate(allActivities, allTransport);

    // --- Local restrictions ---
    const countryCode = toCountryCode(region);

    const tripDates: string[] = [];
    if (dateInput?.mode === 'fixed') {
      const start = new Date((dateInput as { startDate: string }).startDate);
      const n = Math.max(rawItinerary.length, 1);
      for (let i = 0; i < n; i++) {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);
        tripDates.push(d.toISOString().slice(0, 10));
      }
    }

    const tripYears = [...new Set(tripDates.map((d) => Number(d.slice(0, 4))))];
    const holidays =
      countryCode && tripYears.length > 0
        ? (await Promise.all(tripYears.map((y) => holidayService.getHolidays(countryCode, y)))).flat()
        : [];

    let openingHoursMap: Map<string, Record<string, string>> = new Map();
    try {
      const places = await attractions.getAttractions(region);
      openingHoursMap = new Map(places.map((p) => [p.name.toLowerCase(), p.openingHours]));
    } catch {
      // Google Places unavailable — opening hours check skipped, other restriction checks still run
    }

    // Orchestrator sends act['activity'] + act['time'] (slot) rather than name/startTime/endTime.
    // Build a separate list for restriction checks that handles both field shapes.
    const TIME_SLOT_MAP: Record<string, string> = { morning: '09:00', afternoon: '14:00', evening: '19:00' };
    const activitiesForRestrictions: ScheduledActivity[] = rawItinerary.flatMap((day) => {
      const dayNum = typeof day['day'] === 'number' ? day['day'] : 1;
      const acts = Array.isArray(day['activities']) ? (day['activities'] as RawDay[]) : [];
      return acts
        .map((act) => {
          const name =
            typeof act['name'] === 'string' ? act['name'] :
            typeof act['activity'] === 'string' ? act['activity'] : null;
          if (!name) return null;
          const timeSlot = typeof act['time'] === 'string' ? act['time'].toLowerCase() : '';
          const startTime =
            typeof act['startTime'] === 'string' ? act['startTime'] :
            TIME_SLOT_MAP[timeSlot] ?? '10:00';
          return { day: dayNum, name, startTime, endTime: '', location: region } satisfies ScheduledActivity;
        })
        .filter((a): a is ScheduledActivity => a !== null);
    });

    const restrictionsResult = restrictionsValidator.validate({
      activities: activitiesForRestrictions,
      tripDates,
      countryCode,
      holidays,
      openingHoursMap,
    });
    // --- end restrictions ---

    // --- Transport resolution ---
    const preference = (transportPreference ?? 'best') as TransportMode;
    const transportOptions: Record<number, TransportOption[]> = {};

    await Promise.allSettled(
      rawItinerary
        .filter((day) => day['cityTransition'] && typeof (day['cityTransition'] as Record<string, unknown>)['to'] === 'string')
        .map(async (day) => {
          const ct = day['cityTransition'] as Record<string, unknown>;
          const from = typeof day['city'] === 'string' ? day['city'] : region;
          const to = String(ct['to']);
          const dayNum = typeof day['day'] === 'number' ? day['day'] : 0;
          const departureDateIso = tripDates[dayNum - 1];

          const options = await transportService.resolveTransportOptions(
            { from, to, departureDateIso },
            preference,
          );

          // <2h connection warning on the best option (first in array)
          const best = options[0];
          if (best) {
            const nextDay = rawItinerary.find(
              (d) => typeof d['day'] === 'number' && d['day'] === dayNum + 1,
            );
            const firstActTime =
              Array.isArray(nextDay?.['activities'])
                ? String((nextDay['activities'] as RawDay[])[0]?.['startTime'] ?? '')
                : '';
            if (best.arrivalTime && firstActTime) {
              const arrival = best.arrivalTime.slice(0, 5);
              if (/^\d{2}:\d{2}$/.test(arrival) && /^\d{2}:\d{2}$/.test(firstActTime)) {
                const arrMins = timeToMinutes(arrival);
                const actMins = timeToMinutes(firstActTime);
                if (actMins - arrMins < 120) {
                  best.warnings.push(
                    `Less than 2h gap before first activity on day ${dayNum + 1}`,
                  );
                }
              }
            }
          }

          transportOptions[dayNum] = options;
        }),
    );
    // --- end transport ---

    const isFlexible = dateInput?.mode === 'flexible';
    const flexibleNoMonth = isFlexible && !(dateInput as { preferredMonth?: string }).preferredMonth;

    let forecasts: Awaited<ReturnType<WeatherService['getMultiDayForecast']>> = [];

    if (!flexibleNoMonth) {
      const flexDays = isFlexible ? (dateInput as { days: number }).days : 0;
      const daysToFetch = isFlexible
        ? flexDays + 7
        : Math.max(rawItinerary.length, 1) + 1;
      const weatherCacheKey = isFlexible
        ? `weather:${region}:flex:${(dateInput as { preferredMonth?: string }).preferredMonth}`
        : `weather:${region}:multi`;

      const cached = await redis.get(weatherCacheKey);
      if (cached) {
        forecasts = cached as Awaited<ReturnType<WeatherService['getMultiDayForecast']>>;
      } else {
        try {
          forecasts = await weather.getMultiDayForecast(region, daysToFetch);
          if (Array.isArray(forecasts) && forecasts.length > 0) {
            await redis.set(weatherCacheKey, forecasts, config.WEATHER_CACHE_TTL_SECONDS);
          }
        } catch {
          forecasts = [];
        }
      }
    }

    const hasTransport = Object.keys(transportOptions).length > 0;
    const validation = await analyzer.analyze(
      tripId,
      round,
      rawItinerary,
      forecasts,
      timingResult,
      dateInput ?? null,
      restrictionsResult.warnings,
      hasTransport ? transportOptions : undefined,
    );

    const transportCostEur = Object.values(transportOptions)
      .reduce((sum, opts) => sum + (opts[0]?.priceEur ?? 0), 0);

    const validationContent = (validation.content ?? {}) as Record<string, unknown>;
    const verdict = buildLogisticsVerdict({
      overallRisk: validationContent['overallRisk'],
      aiTimingIssues: Array.isArray(validationContent['timingIssues'])
        ? (validationContent['timingIssues'] as unknown[])
        : [],
      timingResult,
      restrictionWarnings: restrictionsResult.warnings,
      transportOptions,
    });

    const augmentedValidation = {
      ...validation,
      content: {
        ...validationContent,
        restrictionWarnings: restrictionsResult.warnings,
        transportOptions,
        transportCostEur: transportCostEur > 0 ? transportCostEur : undefined,
        verdict,
      },
    };

    res.json({ validation: augmentedValidation });
  });

  // Lightweight endpoint: resolve transport legs for destination pairs only.
  // No weather, no AI — used by orchestrator to inject real routes into the propose context.
  const TransportLegsSchema = z.object({
    destinations: z.array(z.object({ city: z.string(), country: z.string() })).min(2),
    preference: z.enum(['flight', 'train', 'car', 'best']).default('best'),
    departureDateIso: z.string().optional(),
  });

  router.post('/transport-legs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = TransportLegsSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { destinations, preference, departureDateIso } = parsed.data;
    const legs: Record<string, TransportOption[]> = {};

    await Promise.allSettled(
      destinations.slice(0, -1).map(async (origin, i) => {
        const dest = destinations[i + 1];
        if (!dest) return;
        const key = `${origin.city}->${dest.city}`;
        const options = await transportService.resolveTransportOptions(
          { from: origin.city, to: dest.city, departureDateIso },
          preference as TransportMode,
        );
        legs[key] = options.slice(0, 4); // top 4 options per pair
      }),
    );

    res.json({ legs });
  });

  // Structural planning endpoint: generates route_graph — city order, transport legs,
  // time windows, sleep points, and per-block budget allocation.
  // Pure code + transport APIs — no LLM involved.
  const PlanSchema = z.object({
    tripId:              z.string().uuid(),
    destinations:        z.array(z.object({ city: z.string(), country: z.string(), nights: z.number().int().min(1) })).min(1),
    dateInput:           DateInputSchema,
    transportPreference: z.enum(['flight', 'train', 'car', 'best']).default('best'),
    budgetTotal:         z.coerce.number().positive(),
    budgetCurrency:      z.string().default('EUR'),
    groupSize:           z.coerce.number().int().min(1).default(1),
  });

  // Accommodation typically ~35% of experience budget per city
  const ACCOMMODATION_RATIO = 0.35;
  // Transit days with >4h travel block the morning slot
  const TRANSIT_THRESHOLD_MINUTES = 240;
  const SLOT_DURATION_MINUTES = 120;

  router.post('/plan', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = PlanSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { destinations, dateInput, transportPreference, budgetTotal, groupSize } = parsed.data;
    const preference = transportPreference as TransportMode;

    // Compute start date from dateInput
    let startDateStr: string | undefined;
    if (dateInput?.mode === 'fixed') {
      startDateStr = (dateInput as { startDate: string }).startDate;
    } else if (dateInput?.mode === 'flexible' && (dateInput as { resolvedStart?: string }).resolvedStart) {
      startDateStr = (dateInput as { resolvedStart?: string }).resolvedStart;
    }

    const baseDate = startDateStr ? new Date(startDateStr) : new Date();

    // Resolve transport legs for all adjacent destination pairs in parallel
    type LegResult = { index: number; options: TransportOption[] };
    const legResults: LegResult[] = [];

    await Promise.allSettled(
      destinations.slice(0, -1).map(async (origin, i) => {
        const dest = destinations[i + 1];
        if (!dest) return;

        // Departure date = baseDate + sum of nights before this leg
        const nightsBeforeLeg = destinations.slice(0, i + 1).reduce((s, d) => s + d.nights, 0);
        const departureDate = new Date(baseDate);
        departureDate.setUTCDate(baseDate.getUTCDate() + nightsBeforeLeg);
        const departureDateIso = departureDate.toISOString().slice(0, 10);

        try {
          const options = await transportService.resolveTransportOptions(
            { from: origin.city, to: dest.city, departureDateIso },
            preference,
          );
          legResults.push({ index: i, options });
        } catch (err) {
          // A failed leg must still occupy its slot — dropping it silently
          // shifts every later leg and misaligns cityStays inbound/outbound
          // indexing. A distance-aware estimate fills the slot; if even that
          // fails, the placeholder fallback below handles empty options.
          logger.warn('Transport leg resolution failed — using estimate', {
            from: origin.city,
            to: dest.city,
            error: String(err),
          });
          try {
            const estimated = await transportService.estimateLeg({
              from: origin.city, to: dest.city, departureDateIso,
            });
            legResults.push({ index: i, options: [estimated] });
          } catch {
            legResults.push({ index: i, options: [] });
          }
        }
      }),
    );

    legResults.sort((a, b) => a.index - b.index);

    // Build ordered legs
    const totalTransportCostEurPerPerson = legResults.reduce(
      (sum, lr) => sum + (lr.options[0]?.priceEur ?? 0), 0,
    );

    const orderedLegs: TransportLeg[] = legResults.map((lr, i) => {
      const origin = destinations[lr.index];
      const dest = destinations[lr.index + 1];
      const nightsBeforeLeg = destinations.slice(0, lr.index + 1).reduce((s, d) => s + d.nights, 0);
      const departureDate = new Date(baseDate);
      departureDate.setUTCDate(baseDate.getUTCDate() + nightsBeforeLeg);

      const best = lr.options[0] ?? {
        mode: 'car' as const,
        durationMinutes: 120,
        warnings: ['No transport options found — estimate only'],
      };

      return {
        from: origin?.city ?? `City ${lr.index + 1}`,
        to: dest?.city ?? `City ${lr.index + 2}`,
        departureDate: departureDate.toISOString().slice(0, 10),
        bestOption: best,
        alternatives: lr.options.slice(1, 4),
        totalCostEurPerPerson: best.priceEur ?? 0,
      } satisfies TransportLeg;
    });

    // Build city stays with time windows
    const experienceBudgetPerPerson = Math.max(0, budgetTotal / groupSize - totalTransportCostEurPerPerson);
    const totalNights = destinations.reduce((s, d) => s + d.nights, 0);
    const accommodationBudgetPerPersonPerNight =
      totalNights > 0 ? (experienceBudgetPerPerson * ACCOMMODATION_RATIO) / totalNights : 0;

    // ── Travel-day attribution (deterministic reasoning over the schedule) ──
    // A leg departing before noon consumes the DESTINATION's arrival day (fly
    // out early, afternoon free in the new city). A leg departing at/after
    // noon belongs to the ORIGIN's calendar day: the traveller spends the free
    // slots there, the departure slot onwards is outbound transit, and the
    // destination's first usable day is the following one (morning recovery
    // after a late/past-midnight arrival).
    const isLong = (leg: TransportLeg) => leg.bestOption.durationMinutes > TRANSIT_THRESHOLD_MINUTES;

    interface TravelDayPlan {
      owner: 'origin' | 'destination';
      /** owner=origin: block depSlot..evening as outbound-transit on the travel date. */
      outboundFromIdx: number;
      /** owner=destination: block 0..idx as inbound-transit on the travel date. */
      inboundUpToIdx: number | null;
      /** owner=destination + past-midnight arrival: entire travel date blocked. */
      wholeDayTransit: boolean;
      /** Recovery morning on the day AFTER the travel date. */
      nextMorningRecovery: boolean;
      /** Journey exceeds the transit threshold — its last blocked slot is recovery. */
      longJourney: boolean;
    }

    const legPlans: TravelDayPlan[] = orderedLegs.map((leg) => {
      const best = leg.bestOption;
      const depIdx = timeToSlotIndex(best.departureTime);
      const crosses = crossesMidnight(best.departureTime, best.durationMinutes);

      if (depIdx !== null && depIdx >= 1) {
        // Afternoon/evening departure → origin's day.
        const arrHour = best.arrivalTime ? parseInt(best.arrivalTime.split(':')[0] ?? '0', 10) : null;
        const lateArrival = crosses || (arrHour !== null && arrHour >= 22);
        return {
          owner: 'origin',
          outboundFromIdx: depIdx,
          inboundUpToIdx: null,
          wholeDayTransit: false,
          nextMorningRecovery: lateArrival || isLong(leg),
          longJourney: isLong(leg),
        };
      }

      // Morning departure (or no times — car legs assume a 09:00 start).
      if (crosses) {
        return {
          owner: 'destination',
          outboundFromIdx: 2,
          inboundUpToIdx: 2,
          wholeDayTransit: true,
          nextMorningRecovery: true,
          longJourney: isLong(leg),
        };
      }
      const arrIdx =
        timeToSlotIndex(best.arrivalTime) ??
        computeArrivalSlotIndex(best.departureTime, best.durationMinutes) ??
        (isLong(leg) ? 0 : computeArrivalSlotIndex('09:00', best.durationMinutes));
      let upTo: number | null = null;
      if (arrIdx !== null) {
        const raw = Math.max(arrIdx, depIdx ?? 0);
        upTo = isLong(leg) ? Math.min(raw + 1, 2) : raw;
      }
      return {
        owner: 'destination',
        outboundFromIdx: 2,
        inboundUpToIdx: upTo,
        wholeDayTransit: false,
        nextMorningRecovery: false,
        longJourney: isLong(leg),
      };
    });

    const cityStays: CityStay[] = destinations.map((dest, i) => {
      const nightsBeforeArrival = destinations.slice(0, i).reduce((s, d) => s + d.nights, 0);
      const arrivalDate = new Date(baseDate);
      arrivalDate.setUTCDate(baseDate.getUTCDate() + nightsBeforeArrival);
      const departureDate = new Date(baseDate);
      departureDate.setUTCDate(baseDate.getUTCDate() + nightsBeforeArrival + dest.nights);

      const inboundPlan = i > 0 ? legPlans[i - 1] : undefined;
      const outboundPlan = legPlans[i]; // undefined for the final city

      const dateAt = (offsetDays: number): string => {
        const d = new Date(arrivalDate);
        d.setUTCDate(arrivalDate.getUTCDate() + offsetDays);
        return d.toISOString().slice(0, 10);
      };

      const pushDay = (
        dateStr: string,
        blockFor: (idx: number) => TimeWindow['blockedReason'] | undefined,
      ): void => {
        for (const slot of SLOTS) {
          const idx = SLOTS.indexOf(slot);
          const blockedReason = blockFor(idx);
          timeWindows.push({
            date: dateStr,
            slot,
            durationMinutes: SLOT_DURATION_MINUTES,
            isTransitDay: blockedReason !== undefined,
            blockedReason,
          });
        }
      };

      const timeWindows: TimeWindow[] = [];
      for (let n = 0; n < dest.nights; n++) {
        const dateStr = dateAt(n);
        const isFirstDay = n === 0;
        const isSecondDay = n === 1;

        // Travel date owned by the origin → this stay has no presence there.
        if (isFirstDay && inboundPlan?.owner === 'origin') continue;

        pushDay(dateStr, (idx) => {
          if (isFirstDay && inboundPlan && inboundPlan.owner === 'destination' && inboundPlan.inboundUpToIdx !== null && idx <= inboundPlan.inboundUpToIdx) {
            const recovery =
              !inboundPlan.wholeDayTransit &&
              inboundPlan.longJourney &&
              idx === inboundPlan.inboundUpToIdx;
            return recovery ? 'inbound-recovery' : 'inbound-transit';
          }
          // Morning after a late/past-midnight arrival is recovery, not sightseeing.
          if (isSecondDay && inboundPlan?.nextMorningRecovery && idx === 0) return 'inbound-recovery';
          return undefined;
        });
      }

      // Origin-owned travel date: this stay gains that day — free slots before
      // departure (its tourist agent fills them), outbound-transit afterwards.
      if (outboundPlan?.owner === 'origin') {
        pushDay(dateAt(dest.nights), (idx) =>
          idx >= outboundPlan.outboundFromIdx ? 'outbound-transit' : undefined,
        );
      }

      return {
        city: dest.city,
        country: dest.country,
        arrivalDate: arrivalDate.toISOString().slice(0, 10),
        departureDate: departureDate.toISOString().slice(0, 10),
        nights: dest.nights,
        timeWindows,
        sleepPoint: `${dest.city} city centre`,
        budgetPerPersonPerNight: Math.round(accommodationBudgetPerPersonPerNight),
      } satisfies CityStay;
    });

    const routeGraph: RouteGraph = {
      orderedLegs,
      cityStays,
      totalTransportCostEurPerPerson: Math.round(totalTransportCostEurPerPerson),
      totalDurationDays: totalNights,
    };

    res.json({ routeGraph });
  });

  router.get('/attractions/:region', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsedQuery = AttractionQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      next(new ValidationError(parsedQuery.error.flatten().fieldErrors.toString()));
      return;
    }

    const region = req.params['region'];
    if (!region) {
      next(new ValidationError('region param is required'));
      return;
    }

    const places = await attractions.getAttractions(region, parsedQuery.data.category);
    res.json({ attractions: places, cachedAt: new Date().toISOString() });
  });

  router.get('/weather/:region', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsedQuery = WeatherQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      next(new ValidationError(parsedQuery.error.flatten().fieldErrors.toString()));
      return;
    }

    const region = req.params['region'];
    if (!region) {
      next(new ValidationError('region param is required'));
      return;
    }

    const { date } = parsedQuery.data;
    const cacheKey = `weather:${region}:${date ?? 'current'}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      res.json({ weather: cached, cachedAt: cacheKey });
      return;
    }

    const forecast = await weather.getForecast(region, date);
    await redis.set(cacheKey, forecast, config.WEATHER_CACHE_TTL_SECONDS);
    res.json({ weather: forecast, cachedAt: new Date().toISOString() });
  });

  return router;
}
