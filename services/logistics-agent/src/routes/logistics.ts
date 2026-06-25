import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@itinera/shared';
import type { TransportMode, TransportOption } from '@itinera/shared';
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
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
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
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
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
