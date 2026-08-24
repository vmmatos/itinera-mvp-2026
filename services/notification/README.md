# notification

Email (and stubbed push/SMS) delivery service for the itinera stack. Port `3007` (debug `9235`). No database — stateless consumer of RabbitMQ events.

## Purpose

Sends transactional emails (welcome, itinerary-ready, booking reminders, itinerary PDF attachments) triggered by events published elsewhere in the pipeline (e.g. the orchestrator's `WorkflowEngine` publishing `itinerary_ready`). Push and SMS are present as feature-flagged stubs, not implemented delivery paths.

## How it works

- **`EmailConsumer`** (`src/services/EmailConsumer.ts`) connects to RabbitMQ via `amqplib`, consumes email-send events, validates the payload against `NotificationEmailPayloadSchema` (zod), renders the matching template, and hands it to `EmailService` for delivery. Reconnects on `error`/`close` with a bounded retry count (`maxReconnectAttempts = 5`) and `channel.prefetch(1)` so messages are processed one at a time.
- **`EmailService`** — delivery abstraction (`EmailTransport`) over either SendGrid (`@sendgrid/mail`, gated by `SENDGRID_ENABLED`) or SMTP via `nodemailer` (defaults to the dev Mailhog container).
- **Templates** (`src/templates/`): `welcome.ts`, `itinerary-ready.ts`, `booking-reminder.ts`, `itinerary-pdf.ts`, aggregated via `index.ts` (`renderWelcome`, `renderItineraryReady`, `renderBookingReminder`) — each returns a `RenderedEmail` (subject + body) consumed by `EmailConsumer`.
- **`SmsService`**, **`PushService`** — present in `src/services/` but gated by `TWILIO_ENABLED`/`FCM_ENABLED`, both defaulting to `false`; stubs for a future integration, not wired to a real provider by default.
- HTTP surface (`src/routes/email.ts`, `health.ts`) is minimal — this service is driven primarily by the RabbitMQ consumer, not inbound HTTP calls.

## Design decisions

- **Event-driven, not request/response** — the primary integration point is the RabbitMQ queue, matching the rest of the pipeline's "publish and move on" pattern; other services don't wait on notification delivery.
- **SendGrid for production, Mailhog for dev by default** (`SMTP_HOST` defaults to `mailhog`, port `1025`) — no code branching needed to develop locally without a real SendGrid account.
- **No database** — this service is stateless; delivery status isn't tracked here (a gap, not a decision to track elsewhere — see Error handling).

## Prompt templates

N/A — no LLM calls in this service.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3007` | HTTP listen port |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `LOG_LEVEL` | `info` | Logger verbosity |
| `RABBITMQ_HOST` / `PORT` / `DEFAULT_USER` | `localhost` / `5672` / `itinera` | RabbitMQ connection |
| `RABBITMQ_DEFAULT_PASS` | *(required)* | RabbitMQ password |
| `JWT_SECRET` | *(required)* | Shared JWT signing secret |
| `JWT_ISSUER` | *(optional)* | Expected `iss` claim |
| `SENDGRID_ENABLED` | `false` | Toggles SendGrid as the email transport |
| `SENDGRID_API_KEY` | *(optional)* | Required when `SENDGRID_ENABLED=true` |
| `SMTP_HOST` / `SMTP_PORT` | `mailhog` / `1025` | Dev SMTP fallback (Mailhog) |
| `FCM_ENABLED` | `false` | Push notification stub toggle — no real FCM integration wired |
| `TWILIO_ENABLED` | `false` | SMS stub toggle — no real Twilio integration wired |
| `NOTIFICATION_FROM_EMAIL` | `noreply@itinera.dev` | From-address for outbound email |
| `NOTIFICATION_FROM_NAME` | `Itinera` | From-name for outbound email |

## Tests

4 unit test files under `src/__tests__/unit/`: `EmailService.test.ts`, `templates.test.ts`, `email.routes.test.ts`, `EmailConsumer.test.ts`.

Run with `make test s=notification` or `make test-local s=notification`; `yarn test`/`yarn test:unit` inside the service.

## Models

N/A — no AI provider dependency.

## Error handling

- `EmailConsumer` reconnects RabbitMQ on `error`/`close` events with a bounded attempt count. However, `amqplib.connect(this.url)` (`src/services/EmailConsumer.ts:27`) does **not** pass an explicit `heartbeat` option — per the project's documented RabbitMQ gotcha (see root README), idle connections without a heartbeat get silently closed by RabbitMQ after ~7 minutes. The `close` handler does trigger a reconnect here, but this is a known-gap-by-omission worth fixing explicitly rather than relying on the default.
- Payload validation via `NotificationEmailPayloadSchema` (zod) rejects malformed events before attempting to render/send, rather than throwing deep inside a template.
- No delivery-status tracking or dead-letter handling is implemented for failed sends beyond RabbitMQ's own queue TTLs (`infrastructure/rabbitmq/definitions.json`) — a failed SendGrid/SMTP call is logged, not retried or persisted for follow-up.

## Performance

- `channel.prefetch(1)` processes one message at a time per consumer — simple backpressure, no concurrent batch sending.
- No caching layer (no Redis dependency) — every message triggers a fresh render + send.

## Tech decisions

- Push (`FCM_ENABLED`) and SMS (`TWILIO_ENABLED`) are explicit stubs, not partially-implemented features — both flags default to `false` and there's no corresponding provider wiring, so enabling them without further implementation work would be a no-op or an error, not a working integration.
