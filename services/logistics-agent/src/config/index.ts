import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3005),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default('itinera'),
  POSTGRES_USER: z.string().default('itinera'),
  POSTGRES_PASSWORD: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  RABBITMQ_HOST: z.string().default('localhost'),
  RABBITMQ_PORT: z.coerce.number().default(5672),
  RABBITMQ_DEFAULT_USER: z.string().default('itinera'),
  RABBITMQ_DEFAULT_PASS: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().default('agent.events'),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(3600),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().default(1800),
  ATTRACTIONS_CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  // Transport resolution is expensive (SerpApi is 250 searches/month). Cache
  // resolved legs (6h) and airport lookups (30d) to avoid burning quota on
  // the preflight + per-day + per-round re-resolution of the same city pairs.
  TRANSPORT_CACHE_TTL_SECONDS: z.coerce.number().default(21600),
  AIRPORT_CACHE_TTL_SECONDS: z.coerce.number().default(2592000),
  OPENWEATHERMAP_API_KEY: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  GOOGLE_MAPS_BASE_URL: z.string().default('https://maps.googleapis.com/maps/api'),
  // Routes API (v2) — modern replacement for the legacy Directions API used for
  // transit/rail routing. The legacy Directions API is being sunset by Google.
  GOOGLE_ROUTES_BASE_URL: z.string().default('https://routes.googleapis.com'),
  GOOGLE_PLACES_BASE_URL: z.string().default('https://places.googleapis.com/v1'),
  OPENWEATHERMAP_BASE_URL: z.string().default('https://api.openweathermap.org'),
  // The free OpenWeatherMap plan only exposes /data/2.5/forecast — a 5-day/3h
  // window that always returns now→now+5d regardless of the requested `cnt`,
  // with no date parameter. Anything beyond this is unknowable: we neither
  // call the API for it nor fabricate numbers to fill the gap.
  OWM_FORECAST_HORIZON_DAYS: z.coerce.number().default(5),
  // SerpApi Google Flights — flight search. engine=google_flights is passed as a
  // query param in code, not baked into the URL. Empty key = flight search disabled
  // (the feasibility guard then estimates flights for long legs).
  SERPAPI_KEY: z.string().default(''),
  SERPAPI_BASE_URL: z.string().default('https://serpapi.com/search'),
  // Below this geodesic distance flights are never fetched, synthesised or
  // composed via airport hubs — short land legs must resolve to ground modes
  // (prevents fabricated flights like Mértola→Comporta and saves SerpApi quota).
  MIN_FLIGHT_DISTANCE_KM: z.coerce.number().default(300),
  // Max distance a geocoded place may be "snapped" to its nearest dataset
  // airport. Beyond this the match is bogus (a region outside dataset coverage
  // snapping to another country's hub, e.g. Cabo Verde→Las Palmas ~1600km) and
  // resolution must fail instead so the caller falls back to an estimate.
  MAX_AIRPORT_SNAP_KM: z.coerce.number().default(300),
  // Per-person driving cost heuristic (fuel + tolls) so car options carry a
  // price and compete fairly in the weighted ranking.
  CAR_COST_EUR_PER_KM: z.coerce.number().default(0.22),
  // Weighted transport ranking (see TransportScorer). Lower score = better.
  TRANSPORT_WEIGHT_COST: z.coerce.number().default(0.6),
  TRANSPORT_WEIGHT_DURATION: z.coerce.number().default(40),
  TRANSPORT_WEIGHT_PREFERENCE: z.coerce.number().default(0.18),
  TRANSPORT_WEIGHT_TRANSFERS: z.coerce.number().default(15),
  // Per-person taxi/rideshare (Uber has no API in this stack) proxy heuristic —
  // deliberately higher than CAR_COST_EUR_PER_KM, which is a fuel-only rate for
  // a road-trip leg, not a paid-driver local trip.
  LOCAL_DRIVE_COST_EUR_PER_KM: z.coerce.number().default(1.5),
  // Flat local bus/metro fare heuristic — no ticket-price API exists for this,
  // so real duration/line data (Google Routes transitDetails) is paired with
  // one flat fare rather than Google's transitFare field (inconsistent
  // per-city coverage, deliberately not attempted).
  LOCAL_TRANSIT_FLAT_FARE_EUR: z.coerce.number().default(2.0),
  // At/above this geodesic distance from the day's base city, an activity's
  // venue is treated as a day trip (e.g. Sintra from Lisbon) and resolved via
  // the full inter-city TransportService instead of local drive/transit/walk.
  DAY_TRIP_DISTANCE_THRESHOLD_KM: z.coerce.number().default(20),
  // Above this distance walking is never offered as a local transport candidate.
  LOCAL_WALK_MAX_KM: z.coerce.number().default(1.5),
  // Net-new Routes API quota consumption (one call per non-placeholder
  // activity) — mock in dev to avoid burning quota while testing the feature.
  // NOT z.coerce.boolean(): that does JS `Boolean(str)`, so the literal
  // string "false" (any non-empty string) coerces to `true`.
  LOCAL_TRANSIT_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Meals assumed per day (lunch + dinner) when injecting the day.meals
  // category from real restaurant picks (or the blended estimate as fallback).
  MEALS_PER_DAY: z.coerce.number().default(2),
  // Net-new Google Places quota consumption (one restaurant text search per
  // trip city) — mock in dev to avoid burning quota while testing meal picks.
  // Same z.coerce.boolean() footgun as LOCAL_TRANSIT_MOCK — enum instead.
  PLACES_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Ticketmaster Discovery API — real-world special events (festivals,
  // concerts, sports, etc) in destination cities. Empty key = feature
  // disabled (same convention as SERPAPI_KEY), fails open elsewhere.
  TICKETMASTER_API_KEY: z.string().default(''),
  TICKETMASTER_BASE_URL: z.string().default('https://app.ticketmaster.com/discovery/v2'),
  // Same z.coerce.boolean() footgun as LOCAL_TRANSIT_MOCK above — enum instead.
  EVENTS_MOCK: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  EVENTS_CACHE_TTL_SECONDS: z.coerce.number().default(21600),
  EVENTS_MAX_PER_CITY: z.coerce.number().default(20),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export function getRabbitMQUrl(): string {
  const { RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS, RABBITMQ_HOST, RABBITMQ_PORT } = config;
  return `amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
}

export function getRedisUrl(): string {
  return `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
}
