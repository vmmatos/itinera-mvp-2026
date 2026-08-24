# ws-relay

## Purpose

Bridges RabbitMQ to Server-Sent Events (SSE) so the admin UI (and the
trip-negotiation frontend) can watch agent activity in real time without
polling. The smallest service in the system: no database, no Redis, no AI
dependency — it only consumes one queue and fans events out over HTTP.
Runs on port 3009.

## How it works

- `src/index.ts` wires an Express app (`helmet`, `requestLogger`,
  `errorHandler`) and, on startup, connects a `RabbitMQConsumer` and calls
  `consumer.consume('admin.realtime', handler)`. The `admin.realtime` queue
  is bound (per `infrastructure/rabbitmq/definitions.json`) to the
  `agent.events` topic exchange — the same exchange every agent service and
  the orchestrator publish to.
- Each consumed `AgentEvent` is validated against `AgentEventSchema` (from
  `@itinera/shared`) before being handed to the handler; malformed messages
  are `nack`'d (not requeued) and logged, not forwarded.
- The handler derives an SSE `eventType` from the event's `type` prefix
  (`event.type.split('.')[0]`) and routes it through `SSEManager`: if the
  event carries a `tripId`, it's broadcast only to clients subscribed to
  that trip (`broadcastToTrip`); otherwise it's broadcast to everyone
  (`broadcast`).
- `GET /stream` (`routes/stream.ts`) is the SSE endpoint: JWT-protected via
  the shared `authMiddleware`, accepts optional `tripId` and `role` query
  params. A client requesting `role=admin` is rejected with 403 unless the
  authenticated user's JWT role is actually `admin`. On connect it sets the
  standard SSE headers (including `X-Accel-Buffering: no` so nginx doesn't
  buffer the stream) and registers the response with `SSEManager`; on
  socket close it deregisters the client.
- `startWithRetry()` wraps the whole startup sequence in an infinite retry
  loop (5s delay) — if the initial RabbitMQ connection fails at boot, the
  process doesn't crash, it just keeps retrying.

## Design decisions

- **No database, no Redis, no AI SDK** — this service's only job is
  "consume a queue, push to open HTTP connections," so it carries none of
  the other services' dependencies. It's the leanest `package.json` in the
  repo.
- **`role=admin` is enforced server-side**, not just hidden in the UI — a
  regular user's JWT can't upgrade itself to the admin broadcast channel by
  passing a query param.
- **Per-trip vs. global broadcast branching lives in the RabbitMQ consumer
  callback**, not in `SSEManager` — `SSEManager` just knows how to send to
  "everyone" or "clients subscribed to trip X"; the decision of which one
  to use per event is made once, at the point the event is dequeued.
- **Malformed messages are dropped, not retried**: `nack(msg, false, false)`
  (no requeue) on both a schema-validation failure and a processing
  exception — a genuinely malformed event isn't going to become valid on
  redelivery, so retrying it would just loop forever.

## Prompt templates

N/A — no LLM calls.

## Environment variables

From `src/config/index.ts` (zod `ConfigSchema`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3009` | HTTP port |
| `NODE_ENV` | `development` | `development \| production \| test` |
| `LOG_LEVEL` | `info` | Winston log level |
| `RABBITMQ_HOST` | *(required, no default)* | RabbitMQ host |
| `RABBITMQ_PORT` | `5672` | RabbitMQ port |
| `RABBITMQ_DEFAULT_USER` | *(required, no default)* | RabbitMQ user |
| `RABBITMQ_DEFAULT_PASS` | *(required, no default)* | RabbitMQ password |
| `JWT_SECRET` | *(required, no default)* | Verifies the `Authorization` bearer token on `/stream` |
| `JWT_ISSUER` | `itinera` | Enforced `iss` claim |

Note: unlike most other services, this one's `src/config/index.ts` has no
`import 'dotenv/config'` of its own — `dotenv/config` is imported once in
`src/index.ts` instead, before `@/config` is loaded, so the effect is the
same in practice, but it's worth knowing when adding a new config-reading
module here.

## Tests

3 files under `src/__tests__/unit/`:

- `RabbitMQConsumer.test.ts`
- `SSEManager.test.ts`
- `stream.test.ts`

Run: `yarn workspace @itinera/ws-relay test` or `cd services/ws-relay &&
yarn test`, or `make test s=ws-relay`.

## Models

N/A — no LLM calls in this service.

## Error handling

- `RabbitMQConsumer.connect()` attaches `error`/`close` listeners on the
  connection that both trigger `scheduleReconnect()` — matches the
  RabbitMQ-heartbeat gotcha documented in the root `CLAUDE.md` (idle
  connections get silently closed after ~7 minutes without a heartbeat
  option, and reconnection must be wired explicitly via `connection.on('close', ...)`).
- Message-level errors (invalid JSON, schema mismatch) are caught per
  message and `nack`'d without crashing the consumer loop — one bad message
  never takes down the stream for every connected client.
- Process-level startup failure (e.g. RabbitMQ not reachable yet) is
  retried indefinitely at a fixed 5s interval via `startWithRetry`, rather
  than crash-looping the container.
- SSE clients are cleaned up on `req.on('close')` — a dropped connection
  doesn't leak a registered client in `SSEManager`.

## Performance

- `channel.prefetch(1)` limits the consumer to one unacknowledged message
  at a time — deliberately conservative for a fan-out service where the
  actual work (writing to open HTTP sockets) is cheap and ordering/backpressure
  matters more than throughput.
- No caching layer — there's nothing to cache; state is just the current
  set of open SSE connections, held in memory in `SSEManager`.
- Depends on `services/shared/dist` being built first (`make build-shared`).

## Tech decisions

- SSE (not WebSockets) was chosen for the admin real-time feed — one-way
  server→client push is all that's needed, and SSE rides over plain HTTP
  through Kong/nginx without extra proxy configuration for upgrade
  handshakes.
- Graceful shutdown (`SIGTERM`/`SIGINT`) explicitly closes all SSE
  connections (`sseManager.closeAll()`) and the RabbitMQ connection before
  exiting, so a rolling deploy doesn't leave dangling client sockets.
