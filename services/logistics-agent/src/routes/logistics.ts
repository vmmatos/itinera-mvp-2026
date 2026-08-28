import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, createLogger, matchesPreferenceTerm } from '@itinera/shared';
import type { TransportMode, TransportOption, RouteGraph, CityStay, TimeWindow, TransportLeg, RestrictionWarning, SpecialEvent, AgentEvent } from '@itinera/shared';
import type { WeatherService, WeatherForecast } from '@/services/WeatherService';
import { isDateWithinForecastHorizon, deriveWeatherRisk } from '@/services/WeatherService';
import type { AttractionDB } from '@/services/AttractionDB';
import type { RedisService } from '@/services/RedisService';
import type { TimingValidator, ScheduledActivity, ScheduledTransport } from '@/validators/TimingValidator';
import type { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
import type { HolidayService } from '@/services/HolidayService';
import type { SpecialEventsService } from '@/services/SpecialEventsService';
import type { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import type { TransportService } from '@/services/TransportService';
import type { PricingEnricher } from '@/services/PricingEnricher';
import type { ActivityTransportResolver, DayInput } from '@/services/ActivityTransportResolver';
import { applyPricingOverlay } from '@/services/PricingOverlay';
import { DEFAULT_MEAL_PRICE_EUR, DEFAULT_PICKS_PER_CITY } from '@/services/RestaurantPricing';
import type { PricedDay, PricedAccommodation } from '@/services/PricingOverlay';
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

const RestrictionsSchema = z.object({
  tripId:    z.string().uuid(),
  itinerary: z.array(z.record(z.unknown())).default([]),
  region:    z.string().default('unknown'),
  dateInput: DateInputSchema,
});

const EventsSchema = z.object({
  tripId:    z.string().uuid(),
  itinerary: z.array(z.record(z.unknown())).default([]),
  region:    z.string().default('unknown'),
  dateInput: DateInputSchema,
  mustHaves: z.array(z.string()).default([]),
});

const RestrictionWarningSchema = z.object({
  day:          z.number(),
  activityName: z.string(),
  warningType:  z.enum(['public_holiday', 'sunday_closure', 'monday_closure', 'opening_hours']),
  message:      z.string(),
});

const WeatherAssessmentSchema = z.object({
  tripId:              z.string().uuid(),
  round:               z.number().int().min(1),
  itinerary:           z.array(z.record(z.unknown())).default([]),
  region:              z.string().default('unknown'),
  dateInput:           DateInputSchema,
  restrictionWarnings: z.array(RestrictionWarningSchema).optional(),
});

/** Flattens a fixed dateInput into one ISO date per itinerary day. Empty for flexible dates. */
function buildTripDates(rawItinerary: Array<Record<string, unknown>>, dateInput: z.infer<typeof DateInputSchema>): string[] {
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
  return tripDates;
}

/** UTC today as YYYY-MM-DD — the day the OpenWeatherMap 5-day window is anchored to. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches (and Redis-caches) the free 5-day forecast for ONE city.
 *
 * The cache key is `weather:{city}:{todayISO}:{days}` because the free
 * 5-day/3h endpoint always returns now→now+5d: the payload is a pure function
 * of (city, today, requested day count). The previous `weather:{region}:multi`
 * key was blind to both — a short trip's payload was served to a longer one
 * asking for more days, and a forecast cached late on day X stayed "valid"
 * into day X+1, where every date in it is stale.
 */
async function fetchCityForecast(
  city: string,
  daysToFetch: number,
  redis: RedisService,
  weather: WeatherService,
): Promise<WeatherForecast[]> {
  const cacheKey = `weather:${city}:${todayIso()}:${daysToFetch}`;

  const cached = await redis.get(cacheKey);
  if (cached) return cached as WeatherForecast[];

  try {
    const forecasts = await weather.getMultiDayForecast(city, daysToFetch);
    if (Array.isArray(forecasts) && forecasts.length > 0) {
      await redis.set(cacheKey, forecasts, config.WEATHER_CACHE_TTL_SECONDS);
    }
    return forecasts;
  } catch (err) {
    logger.warn('Weather fetch failed — continuing without a forecast for this city', {
      city,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Resolves weather per the itinerary's OWN per-day `city` field rather than
 * the trip's single free-text `region` string. A multi-city trip's region
 * (e.g. "Barcelona + Dublin + Comporta", however the user typed/separated it)
 * is not one geocodable place, and even when geocoding survives it, blending
 * one city's forecast across every day of a multi-city trip is simply wrong
 * for the other cities' days. Each unique city is fetched (and cached) once;
 * each day's date is then matched to the forecast from the city that day
 * actually belongs to. Days with no city of their own fall back to
 * `fallbackRegion` (legacy /validate proposal shape).
 *
 * Two gates decide whether OpenWeatherMap is contacted at all — both return an
 * empty list rather than approximate data:
 *   1. Only FIXED dates have a calendar to forecast against. "Some week in
 *      September" is not a question the API can answer, and the previous
 *      behaviour (returning the region's near-term forecast unfiltered) put
 *      this week's weather on a trip months away.
 *   2. Only dates inside the free 5-day horizon are fetchable. A trip three
 *      weeks out used to geocode and fetch every city, then discard all of it.
 */
async function fetchWeatherForecastsForItinerary(
  rawItinerary: Array<Record<string, unknown>>,
  fallbackRegion: string,
  dateInput: z.infer<typeof DateInputSchema>,
  tripDates: string[],
  redis: RedisService,
  weather: WeatherService,
): Promise<WeatherForecast[]> {
  if (dateInput?.mode !== 'fixed' || tripDates.length === 0) {
    logger.info('Weather skipped — forecasts are only fetched for fixed trip dates', {
      mode: dateInput?.mode ?? 'none',
    });
    return [];
  }

  const inHorizon = new Set(tripDates.filter((d) => isDateWithinForecastHorizon(d)));
  if (inHorizon.size === 0) {
    logger.info('Weather skipped — no trip date falls inside the forecast horizon', {
      firstTripDate: tripDates[0],
      horizonDays: config.OWM_FORECAST_HORIZON_DAYS,
    });
    return [];
  }

  const cityByDate = new Map<string, string>();
  rawItinerary.forEach((day, i) => {
    const date = tripDates[i];
    if (!date || !inHorizon.has(date)) return;
    const city = typeof day['city'] === 'string' && day['city'].trim() ? day['city'] : fallbackRegion;
    cityByDate.set(date, city);
  });
  if (cityByDate.size === 0) return [];

  const uniqueCities = [...new Set(cityByDate.values())];
  const forecastEntries = await Promise.all(
    uniqueCities.map(async (city): Promise<[string, WeatherForecast[]]> => [
      city,
      await fetchCityForecast(city, config.OWM_FORECAST_HORIZON_DAYS, redis, weather),
    ]),
  );
  const forecastsByCity = new Map(forecastEntries);

  const result: WeatherForecast[] = [];
  for (const [date, city] of cityByDate) {
    const match = forecastsByCity.get(city)?.find((f) => f.date === date);
    if (match) result.push(match);
  }
  return result;
}

/**
 * Public holiday / Sunday-Monday closure / opening-hours checks — pure code,
 * no LLM, no weather, no transport. Shared by /validate (legacy, still
 * exercised by its own tests) and the lean /restrictions endpoint.
 */
async function computeRestrictionWarnings(
  rawItinerary: Array<Record<string, unknown>>,
  region: string,
  dateInput: z.infer<typeof DateInputSchema>,
  holidayService: HolidayService,
  restrictionsValidator: RestrictionsValidator,
  attractions: AttractionDB,
): Promise<RestrictionWarning[]> {
  const countryCode = toCountryCode(region);
  const tripDates = buildTripDates(rawItinerary, dateInput);

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
    const acts = Array.isArray(day['activities']) ? (day['activities'] as Array<Record<string, unknown>>) : [];
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

  const result = restrictionsValidator.validate({
    activities: activitiesForRestrictions,
    tripDates,
    countryCode,
    holidays,
    openingHoursMap,
  });

  return result.warnings;
}

/**
 * Real-world special events (festivals, concerts, sports, etc — any
 * Ticketmaster Discovery API segment) happening in the destination cities
 * during the trip. Pure informational enrichment: never wired into scoring
 * or preference-agent proposals. Fixed-date trips only — same gate as
 * fetchWeatherForecastsForItinerary, since "some week in September" has no
 * calendar to query events against.
 */
async function computeSpecialEvents(
  rawItinerary: Array<Record<string, unknown>>,
  region: string,
  dateInput: z.infer<typeof DateInputSchema>,
  mustHaves: string[],
  eventsService: SpecialEventsService,
): Promise<SpecialEvent[]> {
  const tripDates = buildTripDates(rawItinerary, dateInput);
  if (dateInput?.mode !== 'fixed' || tripDates.length === 0) {
    logger.info('Special events skipped — only checked for fixed trip dates', {
      mode: dateInput?.mode ?? 'none',
    });
    return [];
  }

  // Same per-day city resolution as fetchWeatherForecastsForItinerary: the
  // itinerary's own per-day `city` field, falling back to the trip region.
  const cityByDate = new Map<string, string>();
  rawItinerary.forEach((day, i) => {
    const date = tripDates[i];
    if (!date) return;
    const city = typeof day['city'] === 'string' && day['city'].trim() ? day['city'] : region;
    cityByDate.set(date, city);
  });
  if (cityByDate.size === 0) return [];

  const datesByCity = new Map<string, string[]>();
  for (const [date, city] of cityByDate) {
    const dates = datesByCity.get(city) ?? [];
    dates.push(date);
    datesByCity.set(city, dates);
  }

  const results = await Promise.allSettled(
    [...datesByCity.entries()].map(async ([city, dates]) => {
      const sorted = [...dates].sort();
      const startDate = sorted[0]!;
      const endDate = sorted[sorted.length - 1]!;
      const events = await eventsService.getEvents(city, startDate, endDate);
      return events.filter((e) => sorted.includes(e.startDate));
    }),
  );

  const dayByDate = new Map(tripDates.map((date, i) => [date, i + 1]));
  const events = results
    .filter((r): r is PromiseFulfilledResult<SpecialEvent[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .map((event) => {
      const haystack = `${event.name} ${event.genre ?? ''} ${event.category}`;
      return {
        ...event,
        day: dayByDate.get(event.startDate),
        matchesMustHave: mustHaves.some((term) => matchesPreferenceTerm(term, haystack)),
      };
    });

  return events;
}

/**
 * Weather + timing impact assessment for the final merged itinerary. Lean
 * counterpart to /validate's inline weather block: skips transport
 * resolution and pricing (the orchestrator already resolved those before
 * calling this), and reads activities/transport in the orchestrator's v2
 * shape (act['activity']/act['time'] slot, leg['departureTime']) rather than
 * the legacy name/startTime/endTime proposal shape /validate expects.
 */
async function computeWeatherAssessment(
  tripId: string,
  round: number,
  rawItinerary: Array<Record<string, unknown>>,
  region: string,
  dateInput: z.infer<typeof DateInputSchema>,
  weather: WeatherService,
  timing: TimingValidator,
  analyzer: WeatherAnalyzer,
  redis: RedisService,
  restrictionWarnings?: RestrictionWarning[],
) {
  const TIME_SLOT_MAP: Record<string, string> = { morning: '09:00', afternoon: '14:00', evening: '19:00' };

  const activities: ScheduledActivity[] = rawItinerary.flatMap((day) => {
    const dayNum = typeof day['day'] === 'number' ? day['day'] : 1;
    const acts = Array.isArray(day['activities']) ? (day['activities'] as Array<Record<string, unknown>>) : [];
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

  const transportLegs: ScheduledTransport[] = rawItinerary.flatMap((day) => {
    const dayNum = typeof day['day'] === 'number' ? day['day'] : 1;
    const legs = Array.isArray(day['transport']) ? (day['transport'] as Array<Record<string, unknown>>) : [];
    return legs
      .map((leg) => {
        const from = typeof leg['from'] === 'string' ? leg['from'] : null;
        const to = typeof leg['to'] === 'string' ? leg['to'] : null;
        const startTime =
          typeof leg['departureTime'] === 'string' ? leg['departureTime'] :
          typeof leg['startTime'] === 'string' ? leg['startTime'] : null;
        if (!from || !to || !startTime) return null;
        return {
          day: dayNum,
          from,
          to,
          startTime,
          durationMinutes: typeof leg['durationMinutes'] === 'number' ? leg['durationMinutes'] : 0,
        } satisfies ScheduledTransport;
      })
      .filter((l): l is ScheduledTransport => l !== null);
  });

  const timingResult = timing.validate(activities, transportLegs);
  // Computed once and threaded into all three consumers (fetch gate, analyzer
  // prompt, forecast merge) so they provably agree on the same calendar.
  const tripDates = buildTripDates(rawItinerary, dateInput);
  const forecasts = await fetchWeatherForecastsForItinerary(rawItinerary, region, dateInput, tripDates, redis, weather);

  const event = await analyzer.analyze(tripId, round, rawItinerary, forecasts, timingResult, dateInput ?? null, restrictionWarnings, undefined, tripDates);
  return mergeRealForecastIntoAssessment(event, forecasts, tripDates);
}

/**
 * Reconciles the LLM's qualitative risk assessment with the real forecast
 * numbers (hi/lo temp, condition, rain%).
 *
 * Matching is by DAY INDEX, not by the LLM's own `date`. The model is asked
 * for a date but routinely returns null or a wrong one — the itinerary JSON it
 * sees carries `day: <number>` and often no date at all — and because the old
 * match was an exact date-string comparison, real temperatures never reached
 * the UI even for a trip starting tomorrow. The authoritative date is
 * `tripDates[day - 1]`; it is stamped onto the entry so downstream consumers
 * never see the model's guess. The model's own date survives only as a
 * fallback when the day number is unusable.
 *
 * When the model returned no usable dayAssessments at all (missing key, empty
 * array, or the `{ raw: '…' }` non-JSON fallback) but real forecasts exist,
 * entries are synthesised in code — degrading silently to no weather is the
 * exact failure this card exists to fix.
 *
 * Never throws: the risk assessment is the load-bearing part of this response
 * and must survive any shape mismatch with the event returned intact.
 */
function mergeRealForecastIntoAssessment(
  event: AgentEvent,
  forecasts: WeatherForecast[],
  tripDates: string[],
): AgentEvent {
  try {
    const content = (event.content ?? {}) as Record<string, unknown>;
    const byDate = new Map(forecasts.map((f) => [f.date, f]));
    const raw = content['dayAssessments'];
    const existing = Array.isArray(raw) ? raw : [];

    if (existing.length === 0) {
      if (forecasts.length === 0) return event;

      const synthesised = synthesiseDayAssessments(tripDates, byDate);
      if (synthesised.length === 0) return event;

      logger.warn('LLM returned no dayAssessments — synthesising from the real forecast', {
        days: synthesised.length,
      });

      const overallRisk =
        typeof content['overallRisk'] === 'string'
          ? content['overallRisk']
          : worstRisk(synthesised.map((d) => d.weatherRisk));

      return { ...event, content: { ...content, overallRisk, dayAssessments: synthesised } };
    }

    const merged = existing.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;

      const dayNum = typeof e['day'] === 'number' ? e['day'] : undefined;
      const authoritative =
        dayNum !== undefined && dayNum >= 1 && dayNum <= tripDates.length ? tripDates[dayNum - 1] : undefined;
      const date = authoritative ?? (typeof e['date'] === 'string' ? e['date'] : undefined);
      const match = date ? byDate.get(date) : undefined;

      // A day outside the forecast horizon still deserves a correct date
      // label — it simply gets no numbers, and the UI renders nothing for it.
      if (!match) return authoritative ? { ...e, date: authoritative } : entry;

      return {
        ...e,
        date,
        tempHigh: match.temperature.max,
        tempLow: match.temperature.min,
        condition: match.conditions,
        precipitationProbability: match.precipitationProbability,
      };
    });

    return { ...event, content: { ...content, dayAssessments: merged } };
  } catch {
    return event;
  }
}

interface SynthesisedDayAssessment {
  day: number;
  date: string;
  weatherRisk: 'low' | 'medium' | 'high';
  affectedActivities: never[];
  tempHigh: number;
  tempLow: number;
  condition: string;
  precipitationProbability: number;
}

/** One entry per trip date that has a real forecast. Days without one are omitted. */
function synthesiseDayAssessments(
  tripDates: string[],
  byDate: Map<string, WeatherForecast>,
): SynthesisedDayAssessment[] {
  return tripDates.flatMap((date, i) => {
    const f = byDate.get(date);
    if (!f) return [];
    return [
      {
        day: i + 1,
        date,
        weatherRisk: deriveWeatherRisk(f),
        affectedActivities: [],
        tempHigh: f.temperature.max,
        tempLow: f.temperature.min,
        condition: f.conditions,
        precipitationProbability: f.precipitationProbability,
      },
    ];
  });
}

function worstRisk(risks: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

export function createLogisticsRouter(
  weather: WeatherService,
  attractions: AttractionDB,
  timing: TimingValidator,
  analyzer: WeatherAnalyzer,
  redis: RedisService,
  holidayService: HolidayService,
  restrictionsValidator: RestrictionsValidator,
  transportService: TransportService,
  pricingEnricher: PricingEnricher,
  activityTransportResolver: ActivityTransportResolver,
  eventsService: SpecialEventsService,
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
    const restrictionWarnings = await computeRestrictionWarnings(
      rawItinerary, region, dateInput, holidayService, restrictionsValidator, attractions,
    );
    // --- end restrictions ---

    // --- Transport resolution ---
    const tripDates = buildTripDates(rawItinerary, dateInput);
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

    // --- Real pricing (card #73: accommodation, restaurants, activities) ---
    const fixedDateInput = dateInput?.mode === 'fixed' ? (dateInput as { startDate: string; endDate: string }) : undefined;
    const pricing = await pricingEnricher
      .enrich(
        region,
        rawItinerary.map((day) => ({
          city: typeof day['city'] === 'string' ? day['city'] : undefined,
          activities: (Array.isArray(day['activities']) ? (day['activities'] as RawDay[]) : []).map((act) => ({
            name: typeof act['name'] === 'string' ? act['name'] : undefined,
          })),
        })),
        fixedDateInput?.startDate,
        fixedDateInput?.endDate,
      )
      .catch(() => undefined);
    // --- end pricing ---

    // `tripDates` is already computed above for transport resolution — the
    // same calendar feeds the fetch gate, the analyzer prompt and the merge.
    const forecasts = await fetchWeatherForecastsForItinerary(rawItinerary, region, dateInput, tripDates, redis, weather);

    const hasTransport = Object.keys(transportOptions).length > 0;
    const validation = await analyzer.analyze(
      tripId,
      round,
      rawItinerary,
      forecasts,
      timingResult,
      dateInput ?? null,
      restrictionWarnings,
      hasTransport ? transportOptions : undefined,
      tripDates,
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
      restrictionWarnings,
      transportOptions,
    });

    const augmentedValidation = {
      ...validation,
      content: {
        ...validationContent,
        restrictionWarnings,
        transportOptions,
        transportCostEur: transportCostEur > 0 ? transportCostEur : undefined,
        pricing,
        verdict,
      },
    };

    res.json({ validation: augmentedValidation });
  });

  // Lightweight endpoint: public holiday / Sunday-Monday closure / opening-hours checks
  // only — no weather, no transport, no pricing, no LLM. Used by the orchestrator right
  // after the final itinerary is merged (dates + activities only exist by then).
  router.post('/restrictions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = RestrictionsSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { itinerary, region, dateInput } = parsed.data;
    const warnings = await computeRestrictionWarnings(
      itinerary, region, dateInput, holidayService, restrictionsValidator, attractions,
    );

    res.json({ warnings });
  });

  // Lightweight endpoint: real-world special events (festivals, concerts,
  // sports, etc) in the destination cities during the trip — Ticketmaster
  // Discovery API. Informational only, same non-blocking tier as
  // /restrictions. Used by the orchestrator right after the final itinerary
  // is merged.
  router.post('/events', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = EventsSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { itinerary, region, dateInput, mustHaves } = parsed.data;
    const events = await computeSpecialEvents(itinerary, region, dateInput, mustHaves, eventsService);

    res.json({ events });
  });

  // Weather + timing impact assessment (OpenWeatherMap-backed LLM analysis).
  // Used by the orchestrator right after the final itinerary is merged, same
  // timing as /restrictions — real activities + dates only exist by then.
  router.post('/weather-assessment', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = WeatherAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { tripId, round, itinerary, region, dateInput, restrictionWarnings } = parsed.data;
    try {
      const assessment = await computeWeatherAssessment(
        tripId, round, itinerary, region, dateInput, weather, timing, analyzer, redis, restrictionWarnings,
      );
      res.json({ assessment });
    } catch (err) {
      next(err as Error);
    }
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
    const totalNights = destinations.reduce((s, d) => s + d.nights, 0);
    // The pricing overlay injects MEALS_PER_DAY meals on every itinerary day
    // after the merge — reserve that money now, or the accommodation and
    // experiences envelopes hand out budget that meals will claw back later.
    const mealsReserveEurPerPerson = (totalNights + 1) * config.MEALS_PER_DAY * DEFAULT_MEAL_PRICE_EUR;
    const experienceBudgetPerPerson = Math.max(
      0,
      budgetTotal / groupSize - totalTransportCostEurPerPerson - mealsReserveEurPerPerson,
    );
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

      // Checkout day: origin-owned travel date (existing outbound-transit
      // blocking) OR the last city in the trip — nothing to block there,
      // just a normal free day before heading home. Without this, the
      // last/only city's final calendar day never gets a day-card at all.
      if (!outboundPlan || outboundPlan.owner === 'origin') {
        pushDay(dateAt(dest.nights), (idx) =>
          outboundPlan && idx >= outboundPlan.outboundFromIdx ? 'outbound-transit' : undefined,
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
      mealsReserveEurPerPerson: Math.round(mealsReserveEurPerPerson),
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
    // Never cache a null: a date outside the forecast horizon becomes
    // answerable as it approaches, and a cached miss would hide that.
    if (forecast) await redis.set(cacheKey, forecast, config.WEATHER_CACHE_TTL_SECONDS);
    res.json({ weather: forecast, cachedAt: new Date().toISOString() });
  });

  // Overlays real pricing (attraction DB, Google Places restaurant estimates,
  // hotel price lookups — via the existing PricingEnricher) onto a merged
  // itinerary's cost fields, which otherwise only ever carry the merge LLM's
  // own unlabelled guess. Used by the orchestrator right after merge, same
  // timing as /restrictions and /weather-assessment.
  const PricingOverlaySchema = z.object({
    tripId:        z.string().uuid(),
    itinerary:     z.array(z.record(z.unknown())).default([]),
    accommodation: z.array(z.record(z.unknown())).default([]),
    region:        z.string().default('unknown'),
    dateInput:     DateInputSchema,
    // Per-city EUR/person/night ceiling from the /plan envelope — steers the
    // hotel search toward affordable properties instead of averaging in
    // whatever luxury listings SerpApi happens to return for that city.
    accommodationCeilingByCity: z.record(z.number()).optional(),
  });

  router.post('/pricing-overlay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = PricingOverlaySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { itinerary, accommodation, region, dateInput, accommodationCeilingByCity } = parsed.data;

    try {
      const fixedDateInput = dateInput?.mode === 'fixed' ? dateInput : undefined;
      const pricing = await pricingEnricher.enrich(
        region,
        itinerary.map((day) => ({
          city: typeof day['city'] === 'string' ? day['city'] : undefined,
          activities: (Array.isArray(day['activities']) ? (day['activities'] as Array<Record<string, unknown>>) : []).map(
            (act) => ({ name: typeof act['venue'] === 'string' ? act['venue'] : undefined }),
          ),
        })),
        fixedDateInput?.startDate,
        fixedDateInput?.endDate,
        accommodationCeilingByCity,
        Math.max(config.MEALS_PER_DAY, DEFAULT_PICKS_PER_CITY),
      );

      const result = applyPricingOverlay(
        itinerary as unknown as PricedDay[],
        accommodation as unknown as PricedAccommodation[],
        pricing,
        config.MEALS_PER_DAY,
      );

      res.json(result);
    } catch (err) {
      next(err as Error);
    }
  });

  // Resolves how to get from each day's base city to each activity's venue —
  // day-trip round-trip legs (e.g. Sintra from a Lisbon base) via the full
  // TransportService, or local drive/transit/walk candidates otherwise. Used
  // by the orchestrator right after merge, same timing as /pricing-overlay.
  const LocalTransportSchema = z.object({
    tripId:              z.string().uuid(),
    itinerary:           z.array(z.record(z.unknown())).default([]),
    dateInput:           DateInputSchema,
    transportPreference: z.enum(['flight', 'train', 'car', 'best']).default('best').optional(),
  });

  router.post('/local-transport', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = LocalTransportSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(JSON.stringify(parsed.error.flatten().fieldErrors)));
      return;
    }

    const { itinerary, dateInput, transportPreference } = parsed.data;

    try {
      const tripDates = buildTripDates(itinerary, dateInput);
      const dateByDay = new Map<number, string>();
      for (const day of itinerary) {
        const dayNum = typeof day['day'] === 'number' ? day['day'] : null;
        const date = dayNum !== null ? tripDates[dayNum - 1] : undefined;
        if (dayNum !== null && date) dateByDay.set(dayNum, date);
      }

      const result = await activityTransportResolver.resolveForItinerary(
        itinerary as unknown as DayInput[],
        dateByDay,
        (transportPreference ?? 'best') as TransportMode,
      );

      res.json(result);
    } catch (err) {
      next(err as Error);
    }
  });

  return router;
}
