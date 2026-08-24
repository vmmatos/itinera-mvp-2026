# logistics-agent

Timing, weather, places, routing/transport and local-restrictions service for the itinera negotiation pipeline. Port `3005` (debug `9233`). The largest service in the stack by both env-var surface and test count.

## Purpose

Resolves everything about *where and when* an itinerary's activities actually happen: geocoding and place lookups (Google Places), inter-city and local transport options (Google Routes, SerpAPI flights, heuristic driving/transit/walking), weather-driven risk assessment (OpenWeatherMap), venue pricing overlays, special events (Ticketmaster), and public-holiday/closure restrictions. Emits a `LogisticsVerdict` the orchestrator uses to decide whether the itinerary needs a repair round.

## How it works

Entry point `POST /logistics` (`src/routes/logistics.ts`). Of the ~20 files under `src/services/`, only **`WeatherAnalyzer`** (in `src/agents/`) calls the LLM — everything else is deterministic external-API integration or heuristic calculation:

- **Deterministic services**: `PlacesService` (Google Places New, with mandatory `X-Goog-FieldMask` header — see Error handling), `MapService`, `TransportService` (inter-city routing, flights via SerpAPI), `LocalTransportService` (local drive/transit/walk resolution), `ActivityTransportResolver`, `MultiLegRouter`, `TransportScorer` (weighted ranking of transport candidates), `HubLookup` (airport snapping), `HolidayService`, `SpecialEventsService` (Ticketmaster), `HotelPriceService`, `RestaurantPricing`, `PricingOverlay`, `PricingEnricher`, `AttractionPriceRepository`, `AttractionDB`, `WeatherService` (raw OWM fetch/cache).
- **Validators**: `TimingValidator` (day-by-day schedule feasibility), `RestrictionsValidator` (holiday/closure conflicts).
- **`WeatherAnalyzer`** (`src/agents/`) — the sole LLM call. Combines the itinerary, multi-day weather forecast, `TimingValidator` output, and any pre-computed restriction warnings, and asks Claude for a structured day-by-day risk assessment with named alternative suggestions.
- **`LogisticsVerdict`** (`src/services/LogisticsVerdict.ts`, `buildLogisticsVerdict`) — derives the final stance: `approved` is `true` only when the itinerary is physically feasible **and** carries no outstanding warnings, so any warning (critical timing conflict, tight transport connection <2h, travel day >4h) keeps the negotiation loop running until the orchestrator refines it away.

## Design decisions

- **LLM used only for weather/risk judgment**, never for the underlying facts (routing, pricing, place data) — those come from real APIs or explicit heuristics, keeping the negotiation deterministic and reproducible wherever possible.
- **Fail-closed distance/matching thresholds rather than fabricated results** — e.g. `MIN_FLIGHT_DISTANCE_KM` (300km) prevents synthesizing flights for short land legs; `MAX_AIRPORT_SNAP_KM` (300km) prevents a place snapping to a wildly distant airport hub when no real match exists in the dataset (documented example: Cabo Verde incorrectly snapping to Las Palmas, ~1600km) — resolution fails and the caller falls back to an estimate instead.
- **`*_MOCK` flags use `z.enum(['true','false']).transform(...)`, not `z.coerce.boolean()`** — `z.coerce.boolean()` does JS `Boolean(str)`, so the literal string `"false"` (any non-empty string) coerces to `true`. This was a real production bug (`LOCAL_TRANSIT_MOCK`/`EVENTS_MOCK` silently forced-on) — see `config/index.ts` inline comments and `ApiKeySecurity.test.ts` / `config.test.ts`.
- **Weighted transport scoring** (`TransportScorer`, `TRANSPORT_WEIGHT_COST/DURATION/PREFERENCE/TRANSFERS`) ranks candidate transport options by a lower-is-better composite score rather than a single hard rule.
- **Empty external API keys degrade the feature, not the request** — `SERPAPI_KEY`/`TICKETMASTER_API_KEY` default to `''`; an empty key disables flight search or events lookup and the caller falls back to an estimate or skips the feature, rather than failing the whole logistics call.

## Prompt templates

One template: `src/config/prompts/logistics-validator.txt`, loaded by `WeatherAnalyzer`.

Summary of what it instructs the model to do:
- Assess weather impact on outdoor activities, timing conflicts, and local restriction warnings across a multi-day itinerary.
- Classify `weatherRisk` per fixed numeric rules baked into the prompt (high: rain >70%, wind >50km/h, temp <5°C or >38°C; medium: rain 30–70%, wind 30–50km/h, temp 5–10°C or 32–38°C; low otherwise).
- **Naming rule**: every suggestion must reference a real, named alternative venue with practical details (e.g. "Replace with Museu Nacional de Arte Antiga — 10 min walk, open until 18h, €6/person"), never a generic instruction like "move to an indoor activity".
- Local restrictions are framed as warnings to work around, never as trip blockers — always propose a real named alternative, never suggest cancellation.
- When transport legs are provided: flag legs over 240 minutes (recommend ≤2 activities that day) and legs with a "<2h gap" warning (recommend buffer time) as `timingIssues`, without duplicating them into `dayAssessments`.
- Must respond with a single JSON object matching an exact schema (`overallRisk`, `dayAssessments[]`, `timingIssues[]`, `summary`) — no markdown fences, no text outside the JSON.
- The prompt explicitly forbids inventing/shifting/nulling a date when a "Trip calendar" block maps day numbers to ISO dates.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3005` | HTTP listen port |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `AI_PROVIDER` | required / `claude-sonnet-4-20250514` / `anthropic` | LLM config for `WeatherAnalyzer` |
| `POSTGRES_*`, `REDIS_HOST/PORT`, `RABBITMQ_*`, `JWT_SECRET`/`JWT_ISSUER` | see other services | Standard infra connections |
| `CACHE_TTL_SECONDS` | `3600` | Generic Redis cache TTL |
| `WEATHER_CACHE_TTL_SECONDS` | `1800` | Weather forecast cache |
| `ATTRACTIONS_CACHE_TTL_SECONDS` | `86400` | Attraction/place data cache |
| `TRANSPORT_CACHE_TTL_SECONDS` | `21600` (6h) | Resolved transport legs — SerpAPI is 250 searches/month, cached to avoid re-resolving the same city pair per preflight/day/round |
| `AIRPORT_CACHE_TTL_SECONDS` | `2592000` (30d) | Airport lookup cache |
| `OPENWEATHERMAP_API_KEY` / `_BASE_URL` | required / `https://api.openweathermap.org` | Weather forecasts |
| `OWM_FORECAST_HORIZON_DAYS` | `5` | Free OWM plan only exposes a 5-day/3h window from *now* — beyond this the app neither calls the API nor fabricates numbers |
| `GOOGLE_PLACES_API_KEY` / `_BASE_URL` | required / `https://places.googleapis.com/v1` | Places (New) lookups |
| `GOOGLE_MAPS_API_KEY` / `_BASE_URL` | required / `https://maps.googleapis.com/maps/api` | Geocoding/Distance Matrix |
| `GOOGLE_ROUTES_BASE_URL` | `https://routes.googleapis.com` | Routes API v2 (replaces the sunsetting legacy Directions API for transit/rail) |
| `SERPAPI_KEY` / `_BASE_URL` | `''` (disabled) / `https://serpapi.com/search` | Flight search (`engine=google_flights`); empty key disables flight search and the feasibility guard estimates instead |
| `MIN_FLIGHT_DISTANCE_KM` | `300` | Below this, flights are never fetched/synthesized — short legs must resolve to ground modes |
| `MAX_AIRPORT_SNAP_KM` | `300` | Beyond this a place-to-airport snap is treated as bogus and resolution fails instead |
| `CAR_COST_EUR_PER_KM` | `0.22` | Per-person fuel/toll heuristic for inter-city driving legs |
| `TRANSPORT_WEIGHT_COST` / `_DURATION` / `_PREFERENCE` / `_TRANSFERS` | `0.6` / `40` / `0.18` / `15` | Weighted transport ranking coefficients (`TransportScorer`) |
| `LOCAL_DRIVE_COST_EUR_PER_KM` | `1.5` | Taxi/rideshare proxy heuristic (deliberately higher than the fuel-only inter-city rate) |
| `LOCAL_TRANSIT_FLAT_FARE_EUR` | `2.0` | Flat local bus/metro fare heuristic (no per-city ticket-price API exists) |
| `DAY_TRIP_DISTANCE_THRESHOLD_KM` | `20` | At/above this, an activity venue is treated as a day trip and resolved via the full inter-city `TransportService` |
| `LOCAL_WALK_MAX_KM` | `1.5` | Above this, walking is never offered as a local transport candidate |
| `LOCAL_TRANSIT_MOCK` | `false` | Mocks local Routes API calls in dev (quota-saving); `'true'`/`'false'` string enum, not `z.coerce.boolean()` |
| `MEALS_PER_DAY` | `2` | Assumed meals/day for the blended restaurant-cost budget category |
| `TICKETMASTER_API_KEY` / `_BASE_URL` | `''` (disabled) / `https://app.ticketmaster.com/discovery/v2` | Special events lookup |
| `EVENTS_MOCK` | `false` | Same string-enum footgun fix as `LOCAL_TRANSIT_MOCK` |
| `EVENTS_CACHE_TTL_SECONDS` | `21600` | Events cache |
| `EVENTS_MAX_PER_CITY` | `20` | Cap on events returned per city |

## Tests

24 unit test files under `src/__tests__/unit/` — the most of any service — covering every deterministic service (`ActivityTransportResolver`, `AttractionDB`, `AttractionPriceRepository`, `HolidayService`, `HotelPriceService`, `HubLookup`, `LocalTransportService`, `MapService`, `MultiLegRouter`, `PlacesService`, `PricingEnricher`, `PricingOverlay`, `RestaurantPricing`, `SpecialEventsService`, `TransportScorer`, `TransportService`, `WeatherService`), both validators (`RestrictionsValidator`, `TimingValidator`), the verdict builder (`LogisticsVerdict`), the LLM path (`WeatherAnalyzer`), env parsing (`config.test.ts`), route wiring (`logistics.routes.test.ts`), and an explicit `ApiKeySecurity.test.ts` guarding against key leakage.

Run with `make test s=logistics-agent` or `make test-local s=logistics-agent`; `yarn test`/`yarn test:unit` inside the service. `src/scripts/diagnose-google-apis.ts` is a standalone script for manually verifying Google API keys/field masks against live endpoints outside the test suite.

## Models

Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-4-20250514`) — used only by `WeatherAnalyzer` for the weather/timing/restriction risk assessment. Every other capability in this service is non-LLM.

## Error handling

- **Google Places/Routes `X-Goog-FieldMask` gotcha**: both APIs require an explicit `X-Goog-FieldMask` request header — omitting it returns `400 INVALID_ARGUMENT`, not a permissions error. Set in `PlacesService.ts`, `TransportService.ts`, and `LocalTransportService.ts`. Don't confuse this with `403 API_KEY_SERVICE_BLOCKED` (the API isn't enabled/allowed on the key itself — fixed by re-creating the key with the API included in *API restrictions* from the start; editing restrictions after creation did not resolve a stuck block in practice).
- Zod `EnvSchema.safeParse` exits the process at boot on invalid/missing required env vars.
- Empty `SERPAPI_KEY`/`TICKETMASTER_API_KEY` fail open — the feature is disabled and a fallback/estimate path is taken rather than the request failing.
- Distance-threshold guards (`MIN_FLIGHT_DISTANCE_KM`, `MAX_AIRPORT_SNAP_KM`) fail closed into an estimate rather than returning a fabricated route.

## Performance

- Multi-tier Redis caching with per-domain TTLs tuned to API cost/freshness tradeoffs: transport legs cached 6h (SerpAPI quota is scarce — 250 searches/month), airport lookups cached 30 days (static data), weather cached 30 minutes, attractions cached 24h, events cached 6h.
- `LOCAL_TRANSIT_MOCK`/`EVENTS_MOCK` let developers iterate without burning paid API quota.

## Tech decisions

- Real per-city ticket pricing for local transit doesn't exist as an API, so the service deliberately pairs real Google Routes `transitDetails` (duration/line data) with one flat fare heuristic (`LOCAL_TRANSIT_FLAT_FARE_EUR`) rather than attempting Google's inconsistently-covered `transitFare` field.
- No taxi/rideshare API exists in this stack (no Uber API), so `LOCAL_DRIVE_COST_EUR_PER_KM` is a deliberately higher proxy heuristic than the inter-city fuel-only rate.
