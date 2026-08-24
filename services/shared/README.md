# @itinera/shared

## Purpose

Internal shared library for all itinera backend services: cross-cutting
types, Express middleware, the AI provider abstraction, error classes, the
Winston logger factory, and small reusable domain helpers (preference
scoring, transport priority). This is a library, not a running service — it
has no `PORT`, no HTTP server, and no Docker service entry of its own.

## How it works

Every service depends on `@itinera/shared` (workspace package) and imports
from its single barrel `src/index.ts`, which re-exports:

- `logger` — `createLogger(serviceName)` (Winston, JSON format, silent in
  `NODE_ENV=test`)
- `errors` — `AppError` base class + typed subclasses
  (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`,
  `ConflictError`, `TooManyTripsError`)
- `types` — shared domain types: `agent.ts` (`AgentName`, `AgentAction`),
  `aiProvider.ts` (`IAIProvider`), `api.ts`, `auth.ts`, `budget.ts`,
  `entities.ts`, `localTransport.ts`, `negotiation.ts`, `preferences.ts`,
  `workflow.ts` (the `WorkflowState` enum used by the orchestrator's state
  machine)
- `middleware` — `authMiddleware` (JWT verify + role check),
  `requireRole(role)`, `errorHandler` (maps `AppError` → structured JSON,
  falls back to 500), `requestLogger`
- `services` — `BaseService` (base class providing a scoped logger),
  `AnthropicService` (concrete `IAIProvider` implementation),
  `aiProviderFactory.createAIProvider(type, apiKey, model)`,
  `RabbitMQPublisher`, `RedisService`, plus two pure helper modules:
  `preferences.ts`, `transportPriority.ts`
- `config/agentRegistry` — static agent metadata (used for persona
  color/name lookups)

## Design decisions

- **Provider-agnostic `IAIProvider` interface** (`types/aiProvider.ts`): the
  interface exposes only `content`, `latencyMs`, `tokensUsed`, and a generic
  `truncated?: boolean` — no Anthropic-specific values (like raw
  `stop_reason` strings) leak into the shared type. Each provider
  implementation is responsible for mapping its own native finish/stop
  reason onto that boolean, so callers never need to know which provider is
  live.
- **Factory + exhaustive switch** (`aiProviderFactory.ts`): `createAIProvider`
  takes an `AIProviderType` union (currently only `'anthropic'`) and uses a
  `never`-typed exhaustiveness check in the `default` branch, so adding a
  second provider without updating the factory is a compile error, not a
  silent runtime gap.
- **`AppError.isOperational`**: distinguishes expected/handled errors
  (4xx, safe to return to the client with a code+message) from unexpected
  ones — `errorHandler` only exposes the real message for operational
  errors (or when `NODE_ENV=development`); everything else collapses to a
  generic `"Internal server error"` in production.
- **Logger is silent in tests**: `createLogger` swaps to an empty
  `transports: []` array when `NODE_ENV === 'test'`, so test output isn't
  polluted by service logs.

## Prompt templates

N/A — no LLM calls live in this package. `AnthropicService` is a generic
`complete(systemPrompt, messages, options)` wrapper; the actual prompt text
sent to it is owned by each calling service (see their own READMEs).

## Environment variables

This package reads no env vars via a zod schema of its own (it has no
`src/config/index.ts`). It does read two raw process env vars directly at
call time, both owned/set by whichever service imports it:

| Variable | Read in | Purpose |
|---|---|---|
| `LOG_LEVEL` | `logger/index.ts` | Winston log level (default `'info'`) |
| `NODE_ENV` | `logger/index.ts`, `middleware/errorHandler.ts` | Silences logger transports and gates verbose error messages when `'test'`/`'development'` |
| `JWT_SECRET` | `middleware/auth.ts` | Required — throws if unset when `authMiddleware` verifies a token |
| `JWT_ISSUER` | `middleware/auth.ts` | Optional — if set, `jwt.verify` enforces the `iss` claim |

## Tests

5 files under `src/__tests__/unit/`:

- `AnthropicService.test.ts`
- `auth.test.ts`
- `errorHandler.test.ts`
- `preferences.test.ts`
- `transportPriority.test.ts`

Run: `yarn workspace @itinera/shared test` or `cd services/shared && yarn test`
(Vitest). Also exercised indirectly by `make test-unit` / `make test` since
every other service depends on the built `dist/` output.

## Models

N/A — no LLM calls in this package itself; it only provides the abstraction
(`IAIProvider`) and one concrete implementation (`AnthropicService`) that
calling services configure with their own API key/model.

## Error handling

- `AnthropicService.complete()` retries up to 3 times on HTTP 429 or 5xx
  responses only (`isRetryable` checks `err.status`), with exponential
  backoff (`1000 * 2^(attempt-1)` ms). Non-retryable errors or the final
  attempt re-throw the original error after logging it.
- A truncated completion (`stop_reason === 'max_tokens'`) is not treated as
  an error — it's returned successfully with `truncated: true` and a
  `logger.warn`, since downstream JSON parsing is where truncation actually
  bites; the comment in code notes truncated output "produces invalid JSON
  downstream — make it loud."
- `errorHandler` middleware is the single place that turns any thrown error
  into an HTTP response: known `AppError` instances map to their own status
  code/error code, everything else becomes a logged 500 with a generic
  message in production.
- `authMiddleware` never throws synchronously to Express — it always calls
  `next(err)` with a typed `UnauthorizedError`/`ForbiddenError`, keeping
  error shape consistent across services.

## Performance

- This package is **not** installed via `node_modules` resolution alone in
  Docker — the dev compose setup bind-mounts `services/shared/dist:ro` into
  every other service's container. A fresh clone must run
  `make build-shared` (`yarn install` + `yarn workspace @itinera/shared build`)
  **before** `make dev`/`make up`, otherwise services mount an empty `dist/`
  directory and fail at import time. `make dev` already runs this as its
  first step, but `make up s=<service>` for a single service also depends
  on it.
- No caching/pooling logic lives in this package itself — `RedisService`
  and `RabbitMQPublisher` are thin base wrappers; connection lifecycle
  (retry/heartbeat) is implemented per-service on top of them.

## Tech decisions

- Yarn workspace package (`services/shared`), built with plain `tsc` (no
  bundler) — `main`/`types` point at `dist/index.js` / `dist/index.d.ts`.
- `preferences.ts` and `transportPriority.ts` are pure, dependency-free
  helper modules (no I/O) — kept in `shared` because both the orchestrator
  and multiple agents need the same scoring/priority logic and it must not
  drift between services.
