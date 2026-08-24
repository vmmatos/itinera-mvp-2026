# @itinera/orchestrator

The negotiation engine, trip CRUD/API surface, and the authenticated entry
point behind Kong for everything trip-related. Owns the Postgres schema for
trips/travellers/proposals/metrics and drives the other 5 agent services
through an explicit state machine.

## Purpose

- REST API for trip lifecycle: create, list, get, update status, fetch
  proposal history (`src/routes/trips.ts`, mounted at `/api/v1/trips`
  behind `authMiddleware`).
- Runs the multi-round negotiation between preference-agent,
  orchestrator-agent, finance-agent, logistics-agent and validator until an
  itinerary is accepted or the trip is best-effort finished/cancelled.
- Publishes every stage transition and agent decision to RabbitMQ so the
  admin UI can watch the negotiation live via `ws-relay`.

## How it works

### API surface (`src/routes/trips.ts`, `src/controllers/TripController.ts`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/trips` | List the caller's trips |
| `POST` | `/api/v1/trips` | Create a trip and kick off the workflow (gated by `MAX_TRIPS_PER_USER`) |
| `POST` | `/api/v1/trips/preview-destinations` | Free-text region → parsed destination list, via `DestinationParser` |
| `GET` | `/api/v1/trips/:id` | Fetch one trip |
| `GET` | `/api/v1/trips/:id/proposals` | Fetch the proposal/round history for a trip |
| `PATCH` | `/api/v1/trips/:id/status` | Update trip status (e.g. accept/cancel) |

`/health` and `/ready` are mounted before `authMiddleware` (public).

### Negotiation pipeline (`src/services/WorkflowEngine.ts`, `WorkflowStateMachine.ts`)

State sequence, enforced by `WorkflowStateMachine.transition()`:

```
INTAKE_COMPLETE
  → LOGISTICS_PLANNING        (route graph: cities, legs, per-city budget envelope)
  → FINANCE_ENVELOPE_CHECK    (is the route graph affordable at all)
  → PARALLEL_TURISTIC_PLANNING (4 preference-agent personas, run concurrently)
  → MERGE_AND_SCORE           (orchestrator-agent merges proposals into one itinerary)
  → FINANCE_VALIDATE ⇄ ITINERARY_REPAIR   (over-budget → targeted edit list → re-validate)
  → FINAL_VALIDATION          (validator score; needs ≥ 60 to proceed)
  → FINISH
(any stage failure, or FINAL_VALIDATION below 60 with retries exhausted) → ASK_REFINEMENT
```

- `FINANCE_VALIDATE` never retries in place — a budget reject always routes
  to `ITINERARY_REPAIR`, which turns the finance agent's `suggestedCuts`
  into a targeted edit list applied to the *existing* itinerary (never a
  full re-merge), then always routes back to `FINANCE_VALIDATE`.
- `FINAL_VALIDATION` requires `validationScore >= 60`; below that it loops
  back to `MERGE_AND_SCORE` using `context.scoreFeedback` to steer the next
  merge attempt, bounded by the per-module retry budget.
- `FINISH` and `ASK_REFINEMENT` are the only terminal states.
- Each module (`logistics`, `finance`, `merge`, `validation`, `tourist`) has
  its own retry counter capped at `WORKFLOW_MAX_RETRIES`; exhausting it does
  **not** fail the trip outright — see Design decisions.

### Key classes

- **`AgentCaller`** — the only thing that talks HTTP to the other 5
  services. Mints a short-lived service JWT per call (`iss` claim
  `config.JWT_ISSUER`), enforces `AGENT_CALL_TIMEOUT_MS` via
  `AbortController`, and retries a **network-level** failure only (fetch
  itself throwing — timeout/DNS/connection reset) up to `options.retries`
  times with a fixed 2s backoff; an HTTP error response (4xx/5xx) means the
  downstream service answered and is never retried here.
- **`EventPublisher`** — RabbitMQ publisher to the `agent.events` topic
  exchange (`config.RABBITMQ_EXCHANGE`). Reconnects on `error`/`close` with
  exponential backoff (1s → 30s cap, 10 attempts) then a 60s cooldown loop;
  connects with `?heartbeat=60` on the AMQP URL.
- **`StateManager`** — persistence layer for proposals/agent logs/final
  metrics against Postgres (`Trip`, `Traveller`, `Proposal`, `AgentLog`,
  `TripMetric` entities).
- **`DestinationParser`** — turns a free-text region string (PT/ES/EN
  country-name aliases) into a structured destination list; has an
  optional LLM fallback (only agent-service code path in this service that
  calls Anthropic directly) for inputs the deterministic alias table can't
  resolve.

### Data model (`src/entities/`)

`Trip` (status, budget, dates, destinations JSONB, workflow_state,
workflow_context JSONB, rejection_reason), `User`, `Traveller` (per-trip
preferences JSONB), `Proposal` (per-round agent output + score + action),
`AgentLog` (per-call latency/tokens/reasoning audit trail), `Attraction`
(logistics-agent's shared attraction price cache), `TripMetric` (final
per-trip aggregate: convergence rounds, forced convergence, block counts,
token/time totals), `SatisfactionScore`.

TypeORM migrations under `src/migrations/` (13 files) are the schema
source of truth after first boot; `infrastructure/postgres/init.sql` only
seeds the baseline tables for a fresh container.

## Design decisions

- **Best-effort delivery**: when the retry budget for a module exhausts but
  a complete itinerary exists, the trip still ships as `confirmed` with
  `workflow_context.overBudget` set, rather than failing the trip outright.
  A cancel always persists a `rejection_reason`.
- **Targeted repair over re-merge**: `ITINERARY_REPAIR` asks
  orchestrator-agent for an edit list (~8k tokens) instead of re-running
  the full merge (~170k tokens) on every budget rejection.
- **Service-to-service auth**: the orchestrator mints its own short-lived
  JWTs for calls to the other agents rather than forwarding the end-user's
  token, so agent services never see user credentials.

## Prompt templates

N/A for this service directly — orchestrator has no `config/prompts/`
directory and makes no LLM calls for the negotiation pipeline itself (that
lives in preference-agent / orchestrator-agent / finance-agent /
logistics-agent). The one exception is `ANTHROPIC_API_KEY`, used only as an
optional fallback inside `DestinationParser` for free-text region parsing
it can't resolve deterministically.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `NODE_ENV` | `development` | — |
| `LOG_LEVEL` | `info` | — |
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD` | `localhost`/`5432`/`itinera`/`itinera`/*(required)* | Trip database |
| `RABBITMQ_HOST/PORT/DEFAULT_USER/DEFAULT_PASS` | `localhost`/`5672`/`itinera`/*(required)* | Event bus connection |
| `RABBITMQ_EXCHANGE` | `agent.events` | Topic exchange all stage/agent events publish to |
| `JWT_SECRET` | *(required)* | Signs both user-facing and service-to-service tokens |
| `JWT_ISSUER` | optional | `iss` claim used when minting service tokens |
| `PREFERENCE_AGENT_URL` / `ORCHESTRATOR_AGENT_URL` / `FINANCE_AGENT_URL` / `LOGISTICS_AGENT_URL` / `VALIDATOR_URL` | `http://<service>:<port>` | Inter-service base URLs |
| `ANTHROPIC_API_KEY` | optional | `DestinationParser`'s LLM fallback only |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | — |
| `AGENT_CALL_TIMEOUT_MS` | `360000` (6 min) | Per-call abort timeout in `AgentCaller` — set above Node/undici's default 5-minute socket timeout, since real merge/repair calls have been observed taking up to ~6 minutes |
| `WORKFLOW_MAX_RETRIES` | `2` | Per-module retry budget in `WorkflowStateMachine` |
| `BUDGET_TOLERANCE_PCT` | `10` | Repair target = `budgetTotal × (1 + pct/100)`; must match finance-agent's own value |
| `MAX_TRIPS_PER_USER` | `3` | Beta guardrail — caps non-cancelled trips per user; not a real billing limit |

## Tests

`src/__tests__/unit/`: `AgentCaller.test.ts`, `DestinationParser.test.ts`,
`TripController.security.test.ts`, `TripService.sql.test.ts`,
`TripService.test.ts`, `WorkflowEngine.test.ts`,
`WorkflowStateMachine.test.ts` (7 files). Plus one integration test,
`src/__tests__/integration/WorkflowEngine.integration.test.ts`.

Run: `make test s=orchestrator` (Docker), `make test-unit` (Docker,
unit-only), `make test-local s=orchestrator` (host).

## Models

Only `DestinationParser`'s fallback path calls the Anthropic API directly
(`ANTHROPIC_MODEL`, default `claude-sonnet-4-20250514`). Everything else in
the negotiation pipeline is orchestration logic — the actual LLM reasoning
happens inside the 4 agent services this service calls out to.

## Error handling

- `AgentCaller` aborts a call at `AGENT_CALL_TIMEOUT_MS` via
  `AbortController` and retries network-level failures only (not HTTP
  error responses) with a fixed 2s backoff, up to a caller-specified count.
- `EventPublisher` auto-reconnects on RabbitMQ `error`/`close` with
  exponential backoff, capped at 10 attempts before falling back to a 60s
  retry loop; connects with an explicit `heartbeat=60` so idle connections
  aren't silently dropped by the broker (see repo-wide debugging notes).
- A missing RabbitMQ channel makes `publish`/`publishToExchange` log a
  warning and skip — a lost admin-feed event never blocks the workflow.
- Per-module retry budget (`WORKFLOW_MAX_RETRIES`) bounds how many times
  the state machine will retry logistics/finance/merge/validation/tourist
  before falling back to best-effort delivery or `ASK_REFINEMENT`.

## Performance

- `AGENT_CALL_TIMEOUT_MS` default (6 min) is set deliberately above Node's
  undici default socket timeout (5 min), since merge/repair calls to
  orchestrator-agent have been observed taking up to ~6 minutes on real
  trips — without an explicit ceiling, those calls failed with an opaque
  `TypeError: fetch failed` instead of a clear timeout.
- `docker-compose` bind-mounts `services/shared/dist:ro` into this
  container — a fresh clone needs `make build-shared` before `make dev`,
  otherwise the mount is an empty directory and the service fails to boot.

## Tech decisions

- Service-to-service calls are authenticated with self-minted short-lived
  JWTs (`role: 'service'`), not the caller's own bearer token — keeps user
  credentials out of inter-service traffic entirely.
- `WorkflowStateMachine` is a small, independently unit-tested pure state
  transition table (`WorkflowStateMachine.test.ts`), decoupled from
  `WorkflowEngine`'s actual I/O (HTTP calls, DB writes, event publishing) —
  keeps the negotiation logic testable without mocking 5 HTTP services.
