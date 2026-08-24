# @itinera/frontend

Nuxt 3 web application for itinera. Users create a trip, watch the 4
AI agents negotiate an itinerary in real time, and review/export the
result. Also hosts an admin debug view of the negotiation internals.

## Purpose

- Trip creation form (`pages/planner.vue`) and dashboard (`pages/dashboard.vue`).
- Live negotiation view (`components/trip/negotiate/**`) driven by an SSE
  stream from `ws-relay`.
- Final itinerary view (`components/trip/itinerary/**`) on `pages/trips/[id].vue`.
- Admin debug console (`pages/admin/index.vue`, `pages/admin/[tripId].vue`)
  for inspecting agent decisions/timeline/metrics per trip.
- Auth (`pages/auth/login.vue`, `pages/auth/callback.vue` — Google OAuth via
  the `auth` service) and a first-run product walkthrough (driver.js).

## How it works

- **Pages**: `index.vue` (landing), `dashboard.vue`, `planner.vue` (trip
  intake form), `auth/login.vue`, `auth/callback.vue`, `admin/index.vue`,
  `admin/[tripId].vue`, `trips/[id].vue` (final itinerary).
- **Composables**:
  - `useApi.ts` — axios instance pointed at `config.public.apiBase` (Kong),
    attaches the bearer token, and transparently retries a request once
    after a 401 by calling `/api/auth/refresh` (queues concurrent 401s so
    only one refresh call fires).
  - `useAgentStream.ts` — connects to `ws-relay`'s `/stream` SSE endpoint
    (`config.public.wsUrl`) for a given `tripId`, parses `event:`/`data:`
    frames by hand (fetch + streaming `ReadableStream`, not `EventSource`,
    so a bearer token header can be attached), auto-reconnects after 3s on
    drop or non-OK response, filters events to the matching `tripId`.
  - `useIdleTimeout.ts` — 30-minute inactivity timer (mouse/key/scroll/touch
    listeners) that fires a caller-supplied callback (used to force
    re-auth/logout on idle).
  - `useAdminDebug.ts` — toggles the admin debug UI affordances.
- **Stores (Pinia)**: `auth.ts` (token/session, OAuth callback handling,
  refresh), `tripPlanner.ts` (trip intake form state), `negotiation.ts`
  (reduces the live SSE event stream into view state for the negotiate
  step), `theme.ts` (dark/light, persisted in `localStorage` under
  `itn-theme`, dark is the SSR default — see the inline script in
  `nuxt.config.ts`), `walkthrough.ts` (whether the driver.js coach-mark
  tour is active, backed by `authStore.user.hasSeenWalkthrough`).
- **Middleware**: `auth.ts` (global-ish route guard — skips `/auth/*`,
  server-side render pass, attempts a silent token refresh if no token is
  held, redirects non-admins away from `/admin/*`), `force-en-locale.global.ts`
  (login/register always render in English regardless of the locale cookie).
- **i18n**: `@nuxtjs/i18n`, locales `en`/`pt` in `i18n/locales/`, `strategy:
  'no_prefix'` — language is a user setting, not a routed concern, so URLs
  never carry a locale prefix.

## Design decisions

- Pinia stores are split by concern (auth/session, trip-intake-form,
  live-negotiation-view, theme, walkthrough) rather than one global store —
  each has an independent lifecycle and most are only relevant on specific
  pages.
- SSE consumption uses `fetch` + manual stream parsing instead of the
  browser `EventSource` API specifically so an `Authorization` header can
  be sent (native `EventSource` cannot set custom headers).
- `useApi`'s 401-retry queues concurrent requests behind a single in-flight
  refresh call rather than letting every failed request trigger its own
  refresh race.
- Dark theme is the unconditional SSR default; the light-mode override is
  applied by an inline `<script>` in `app.head` that runs before first
  paint, avoiding a flash-of-wrong-theme rather than relying on a
  post-hydration Vue watcher.

## Environment variables

Read via `useRuntimeConfig().public` (`nuxt.config.ts:36-42`). No
frontend-specific `.env.example`; documented centrally in the root
`.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `NUXT_PUBLIC_API_BASE` | `http://localhost` | Base URL for the Kong-fronted API (used by `useApi`, `useAgentStream`'s HTTP fallback checks, `stores/auth.ts`, `pages/auth/callback.vue`) |
| `NUXT_PUBLIC_WS_URL` | `http://localhost` | Base URL for the SSE stream (`ws-relay`, via `useAgentStream`) — despite the name, connected over plain HTTP streaming, not a WebSocket |
| `NUXT_PUBLIC_APP_MODE` | `development` | App mode flag, referenced in `nuxt.config.ts` runtime config (not in the root `.env.example` — set directly in `dev/docker-compose.yaml`'s `web` service) |

## Tests

Vitest (`vitest.config.mts`), `environment: 'happy-dom'`, `@vue/test-utils`,
setup file `__tests__/setup.ts`. 41 test files under `__tests__/unit/`:

| Subfolder | Covers |
|---|---|
| `unit/` (root) | Shared components — `AppHeader`, `LanguageSwitcher`, `ThemeToggle`, `TripInputForm`; store `tripPlannerStore`; composable `useAgentStream` |
| `unit/admin/` | Admin debug panels (`MetricsPanel`, `NegotiationPanel`, `TimelinePanel`) and the `useAdminDebug` composable |
| `unit/stores/` | Pinia stores — `auth`, `negotiation`, `theme`, `walkthrough` |
| `unit/utils/` | Pure view-model/reducer utils — `itinerary`, `itineraryViewModel`, `negotiationReducer` |
| `unit/trip/` | Trip-level components — `ActivityCard`, `BudgetBreakdown`, `Timeline`, `TripInputFormWalkthrough` |
| `unit/trip/negotiate/` | Live negotiation UI — `AgentCard`, `AgentList`, `DecisionStream`, `DraftItinerary`, `NegotiateStepV2`, `StagePipeline` |
| `unit/trip/itinerary/` | Final itinerary UI — `AgentChips`, `CostByDayChart`, `DayPanel`, `DaySlot`, `ItineraryStep`(+`Walkthrough`), `NegotiationQuality`, `PriceSummary`, `TimelineRail`, `TransitBlock`, `TravellerSatisfaction` |
| `unit/pages/` | Page-level behavior — `DashboardTripLimit`, `DashboardWalkthrough`, `TripDetail` |

Run: `yarn test` inside `apps/frontend/`, or `make test s=frontend` /
`make test-local s=frontend` from the repo root.

## Models

N/A — this app calls its own backend via Kong; it never calls the
Anthropic API directly. All AI reasoning happens in the backend agent
services.

## Error handling

- `middleware/auth.ts` — no token → attempts a silent refresh before
  redirecting to `/auth/login`; non-admin users are redirected out of
  `/admin/*`.
- `useApi.ts` — a single 401 triggers one refresh attempt (queued for
  concurrent requests); a failed refresh clears the session and redirects
  to login rather than looping.
- `useAgentStream.ts` — any connection failure (network error, non-OK
  response, stream ending) schedules a reconnect after 3s rather than
  surfacing an error to the component; malformed SSE JSON frames are
  silently dropped.
- `useIdleTimeout.ts` — 30-minute inactivity fires a caller-provided
  callback (used to force logout), independent of API errors.

## Performance

- `dev/docker-compose.yaml` gives the `web` container named volumes for
  `node_modules` and `.nuxt` (`frontend-node-modules`, `frontend-nuxt-build`)
  so `yarn install` and the Nuxt build cache survive container restarts
  instead of reinstalling/rebuilding from an empty bind mount every time.
- SSE reconnect uses a fixed 3s delay, not exponential backoff — acceptable
  given it targets a single internal service (`ws-relay`), not a public API.

## Tech decisions

- **Product walkthrough**: `driver.js` coach-marks over the real trip
  planner form, gated by `useWalkthroughStore` and the backend-persisted
  `users.hasSeenWalkthrough` field (mirrors the same pattern as the
  `language` user field) rather than local-storage-only state, so the tour
  doesn't reappear on a different device/browser.
- **i18n `no_prefix` strategy**: language is a per-user setting (stored via
  the backend), not part of the URL — deliberate tradeoff against SEO-style
  locale-prefixed routing, since this app has no public/SEO surface.
- **Admin debug mode**: a first-class composable (`useAdminDebug`) and
  dedicated pages rather than a hidden query-param flag, since it's used
  regularly during development to inspect live agent negotiation events.
