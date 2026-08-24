# sharing

Shareable-link generation and PDF export service for itineraries. Port `3008` (debug `9236`). Redis-backed, no Postgres.

## Purpose

Lets a trip's final itinerary be shared via a public, unauthenticated link and exported as a PDF. Two concerns: generating/resolving time-limited share links (`ShareLinkGenerator`), and rendering an itinerary to PDF (`PDFGeneratorService`) for download or email attachment (via the notification service).

## How it works

- **`ShareLinkGenerator`** (`src/services/ShareLinkGenerator.ts`) — `generate(tripId, itinerary, createdBy)` creates a random `shareId` (`crypto.randomUUID()`), stores a `ShareRecord` (itinerary snapshot + metadata) in Redis with a TTL (`SHARE_LINK_TTL_SECONDS`), and returns a public URL built from `SHARING_BASE_URL`. `resolve(shareId)` reads the record back, throwing `NotFoundError` (from `@itinera/shared`) once expired/absent — Redis TTL is the expiry mechanism, not a manual timestamp check.
- **Route split by trust level**: `src/routes/share.protected.ts` (authenticated — generating a link) vs `src/routes/share.public.ts` (unauthenticated — resolving/viewing a shared link via `GET /:id`), plus `export.ts` (PDF export) and `health.ts`.
- **`PDFGeneratorService`** (`src/services/PDFGeneratorService.ts`) — renders itinerary HTML (`src/templates/itinerary.ts`, `renderItineraryHtml`) and prints it to PDF via `puppeteer-core` with a headless, sandboxed Chromium launch (`--no-sandbox`, `--disable-dev-shm-usage`, `--single-process`, etc. — container-friendly flags). Executable path defaults to `/usr/bin/chromium-browser` unless overridden.
- **`NotificationClient`** (`src/services/NotificationClient.ts`) — calls the notification service's `/api/v1/email/itinerary-pdf` endpoint to deliver a generated PDF by email, authenticating with a short-lived (5-minute) service-role JWT it mints itself (`jwt.sign({ sub: 'sharing', role: 'service', iss: ... }, config.JWT_SECRET, { expiresIn: '5m' })`) rather than forwarding a user token.

## Design decisions

- **Redis TTL as the source of truth for link expiry** — no cron/cleanup job needed; an expired share simply isn't in Redis anymore, and `resolve()` treats "not found" and "expired" identically.
- **Public vs protected route split at the router level**, not via a shared middleware toggle — makes it structurally obvious which endpoints skip Kong's JWT/ACL requirements.
- **`puppeteer-core` (not full `puppeteer`)** — expects a system-installed Chromium (`PUPPETEER_EXECUTABLE_PATH`) rather than bundling its own, keeping the Docker image smaller.
- **Service-to-service auth via a self-minted short-lived JWT**, not by forwarding the end-user's token — `NotificationClient` acts as its own service identity when calling notification.

## Prompt templates

N/A — no LLM calls in this service.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3008` | HTTP listen port |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `LOG_LEVEL` | `info` | Logger verbosity |
| `REDIS_HOST` / `PORT` | `localhost` / `6379` | Redis connection (share record storage) |
| `JWT_SECRET` | *(required)* | Signs the service-to-service token for `NotificationClient`; also validates protected-route tokens |
| `JWT_ISSUER` | *(optional)* | Expected/issued `iss` claim |
| `SHARE_LINK_TTL_SECONDS` | `604800` (7 days) | Share link lifetime — also the Redis key TTL |
| `SHARING_BASE_URL` | `http://localhost:3008` | Base URL used to build public share URLs |
| `PUPPETEER_EXECUTABLE_PATH` | *(optional, falls back to `/usr/bin/chromium-browser`)* | Chromium binary for PDF rendering |
| `NOTIFICATION_URL` | `http://notification:3007` | Base URL for emailing generated PDFs |

## Tests

5 unit test files under `src/__tests__/unit/`: `share.routes.test.ts`, `PDFGeneratorService.test.ts`, `ShareLinkGenerator.test.ts`, `itinerary.template.test.ts`, `NotificationClient.test.ts`.

Run with `make test s=sharing` or `make test-local s=sharing`; `yarn test`/`yarn test:unit` inside the service.

## Models

N/A — no AI provider dependency.

## Error handling

- `ShareLinkGenerator.resolve()` throws the shared `NotFoundError` type on a missing/expired record, which the route handlers forward via `next(err)` to the shared error-handling middleware (`@itinera/shared`) rather than handling ad hoc per route.
- `PDFGeneratorService.generate()` wraps rendering in `try`/`finally`, always calling `browser.close()` even if `page.pdf()` throws — avoids leaking headless Chromium processes on render failure.
- `NotificationClient.sendItineraryPdf` makes a plain `fetch` call with no explicit timeout — a hung notification service would hang the sharing request; no retry/backoff is implemented here.

## Performance

- Redis is used purely as a TTL-backed key-value store for share records — no additional caching layer beyond that.
- PDF generation is synchronous per request (one headless Chromium launch per export) — there's no queueing or pooling of browser instances, so concurrent PDF exports each pay the full Chromium startup cost.

## Tech decisions

- Chosen sandboxing flags (`--no-sandbox`, `--disable-setuid-sandbox`, `--single-process`, `--no-zygote`) are specifically the set needed to run headless Chromium inside a restricted Docker container, not general Puppeteer defaults.
