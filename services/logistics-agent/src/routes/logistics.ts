import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@itinera/shared';
import type { WeatherService } from '@/services/WeatherService';
import type { AttractionDB } from '@/services/AttractionDB';
import type { RedisService } from '@/services/RedisService';
import type { TimingValidator, ScheduledActivity, ScheduledTransport } from '@/validators/TimingValidator';
import type { WeatherAnalyzer } from '@/agents/WeatherAnalyzer';
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
    preferredMonth: z.string(),
    window:         z.enum(['tight', 'moderate', 'open']),
  }),
]).nullable().optional();

const ValidateSchema = z.object({
  tripId:    z.string().uuid(),
  round:     z.number().int().min(1),
  proposal:  z.record(z.unknown()),
  region:    z.string().default('unknown'),
  context:   z.string().optional().default(''),
  dateInput: DateInputSchema,
});

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
): Router {
  const router = Router();

  router.post('/validate', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposal, region, dateInput } = parsed.data;

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

    const isFlexible = dateInput?.mode === 'flexible';
    const flexDays = isFlexible ? (dateInput as { days: number }).days : 0;
    const daysToFetch = isFlexible
      ? flexDays + 7
      : Math.max(rawItinerary.length, 1) + 1;
    const weatherCacheKey = isFlexible
      ? `weather:${region}:flex:${(dateInput as { preferredMonth: string }).preferredMonth}`
      : `weather:${region}:multi`;

    let forecasts = await redis.get(weatherCacheKey);
    if (!forecasts) {
      try {
        forecasts = await weather.getMultiDayForecast(region, daysToFetch);
        if (Array.isArray(forecasts) && forecasts.length > 0) {
          await redis.set(weatherCacheKey, forecasts, config.WEATHER_CACHE_TTL_SECONDS);
        }
      } catch {
        forecasts = [];
      }
    }

    const validation = await analyzer.analyze(
      tripId,
      round,
      rawItinerary,
      forecasts as Awaited<ReturnType<WeatherService['getMultiDayForecast']>>,
      timingResult,
      dateInput ?? null,
    );

    res.json({ validation });
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
