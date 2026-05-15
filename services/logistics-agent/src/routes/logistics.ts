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

const TimePattern = /^\d{2}:\d{2}$/;

const ActivitySchema = z.object({
  name: z.string().min(1),
  startTime: z.string().regex(TimePattern, 'startTime must be HH:mm'),
  endTime: z.string().regex(TimePattern, 'endTime must be HH:mm'),
  location: z.string().min(1),
  isOutdoor: z.boolean(),
});

const TransportSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  startTime: z.string().regex(TimePattern, 'startTime must be HH:mm'),
  durationMinutes: z.number().int().nonnegative(),
});

const ItineraryDaySchema = z.object({
  day: z.number().int().min(1),
  date: z.string().optional(),
  activities: z.array(ActivitySchema).default([]),
  transport: z.array(TransportSchema).default([]),
});

const ValidateSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposal: z.object({
    itinerary: z.array(ItineraryDaySchema).min(1),
  }),
  region: z.string().min(1),
  context: z.string().optional().default(''),
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

    const { tripId, round, proposal, region } = parsed.data;

    const allActivities: ScheduledActivity[] = [];
    const allTransport: ScheduledTransport[] = [];

    for (const day of proposal.itinerary) {
      for (const act of day.activities) {
        allActivities.push({
          day: day.day,
          name: act.name,
          startTime: act.startTime,
          endTime: act.endTime,
          location: act.location,
        });
      }
      for (const leg of day.transport) {
        allTransport.push({
          day: day.day,
          from: leg.from,
          to: leg.to,
          startTime: leg.startTime,
          durationMinutes: leg.durationMinutes,
        });
      }
    }

    const timingResult = timing.validate(allActivities, allTransport);

    const weatherCacheKey = `weather:${region}:multi`;
    let forecasts = await redis.get(weatherCacheKey);
    if (!forecasts) {
      forecasts = await weather.getMultiDayForecast(region, proposal.itinerary.length + 1);
      await redis.set(weatherCacheKey, forecasts, config.WEATHER_CACHE_TTL_SECONDS);
    }

    const validation = await analyzer.analyze(
      tripId,
      round,
      proposal.itinerary,
      forecasts as Awaited<ReturnType<WeatherService['getMultiDayForecast']>>,
      timingResult,
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
