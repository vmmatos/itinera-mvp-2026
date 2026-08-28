# auth

## Purpose

Standalone authentication service: email/password login+registration, Google
OAuth2 login, JWT access-token issuance, and httpOnly-cookie refresh-token
rotation. Also owns the small user-profile fields (`language`, `theme`,
`has_seen_walkthrough`) since they hang off the same `User` entity, and
serves them back via `GET /me` and inside every auth response envelope
(`login`/`register`/`refresh`/`exchange` all return `{ token, user }`) so
the client can re-hydrate settings after a reload or OAuth login. Runs on
port 3010.

## How it works

- `src/index.ts` wires an Express app: `helmet`, `cookie-parser`, JSON body
  parsing, mounts `routes/index.ts` (which mounts `routes/auth.ts` under
  `/` and `routes/health.ts`), and `errorHandler` from `@itinera/shared`.
- `routes/auth.ts` (`createAuthRouter`) exposes:
  - `POST /login`, `POST /register` — email/password, delegate to
    `AuthController` → `AuthService`; respond `{ token, user }`
  - `GET /me` (JWT-protected via `authMiddleware`) — current public user
    (`id, email, name, role, language, theme, hasSeenWalkthrough`)
  - `PATCH /me` (JWT-protected via `authMiddleware`) — update `language`
    and/or `theme` (at least one required)
  - `PATCH /me/walkthrough` (JWT-protected) — mark
    `has_seen_walkthrough = true`
  - `GET /oauth2/google`, `GET /oauth2/google/callback` — Passport Google
    OAuth2 flow; only registered if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
    are set, otherwise the initiation route returns `501 NOT_CONFIGURED`
  - `POST /exchange` — one-time-code exchange: the OAuth callback never
    returns tokens directly in the redirect URL; it stores
    `{ token, refreshToken, userId }` in Redis under `auth:exchange:<uuid>`
    for 60 seconds and redirects the browser to
    `${FRONTEND_URL}/auth/callback?code=...`, which then calls `/exchange`
    to trade the one-time code for `{ token, user }` (`redis.getdel`, so
    the code is single-use; `userId` lets `/exchange` load the full public
    user since JWT claims omit `language`/`theme`/`hasSeenWalkthrough`)
  - `POST /refresh` — rotates the refresh token using the httpOnly cookie,
    responds `{ token, user }`
  - `POST /logout` — revokes the refresh token and clears the cookie
- `AuthController` validates request bodies with local `zod` schemas
  (`LoginSchema`, `RegisterSchema`, `UpdateSettingsSchema`) before calling
  `AuthService`.
- `AuthService` (`src/services/AuthService.ts`) does password hashing
  (`bcrypt`), credential checks, `generateToken`/`generateRefreshToken`
  (JWT), and TypeORM lookups against the `User` entity (`src/entities/User.ts`).
- `data-source.ts` configures the TypeORM `DataSource` against the shared
  Postgres instance (same DB as `orchestrator`, different tables/entity).

## Design decisions

- **Users can exist with or without a password hash**: a Google-only user
  has no `passwordHash`; `AuthService.login()` explicitly rejects a
  password-login attempt for such an account with "Account uses social
  login. Please sign in with Google." instead of a generic invalid-credential
  error, so the client can render an accurate message.
- **Refresh token never touches JS-readable storage**: it's set as an
  `httpOnly`, `sameSite: 'lax'` cookie scoped to `path: '/api/auth'`, 7-day
  `maxAge`, `secure` only in production. The access token is returned in
  the JSON body for the client to hold in memory/local state.
- **OAuth code-exchange indirection**: rather than putting the JWT directly
  in the OAuth callback redirect URL (which would leak it into browser
  history/referrers/server logs), the callback stores tokens server-side in
  Redis behind a short-lived, single-use random code and redirects with
  only that opaque code.
- **Kong route is intentionally public**: per
  `infrastructure/kong/configure.sh`, `auth-api` is the one API route
  explicitly excluded from the `jwt` + `acl` plugin pairing applied to
  every other service route (comment: "auth-api is intentionally excluded
  — login/register/oauth2 are public endpoints") — this service is the
  entry point that issues the tokens Kong later verifies for everything
  else.

## Prompt templates

N/A — no LLM calls.

## Environment variables

From `src/config/index.ts` (zod `EnvSchema`, `dotenv/config` loaded):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | HTTP port |
| `NODE_ENV` | `development` | `development \| production \| test` — gates cookie `secure` flag |
| `LOG_LEVEL` | `info` | Winston log level |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port |
| `POSTGRES_DB` | `itinera` | Database name |
| `POSTGRES_USER` | `itinera` | Database user |
| `POSTGRES_PASSWORD` | *(required, no default)* | Database password |
| `REDIS_HOST` | `localhost` | Redis host (OAuth exchange-code store) |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_SECRET` | *(required, no default)* | HMAC secret for signing/verifying access+refresh tokens |
| `JWT_ISSUER` | *(optional)* | If set, embedded as `iss` claim and enforced on verify |
| `JWT_CONSUMER_KEY` | `itinera` | `iss` claim value used to select the matching Kong consumer downstream |
| `GOOGLE_CLIENT_ID` | *(optional)* | Google OAuth2 client id — omitting it disables the Google login routes |
| `GOOGLE_CLIENT_SECRET` | *(optional)* | Google OAuth2 client secret |
| `GOOGLE_CALLBACK_URL` | `http://localhost/api/auth/oauth2/google/callback` | OAuth2 callback URL registered with Google |
| `FRONTEND_URL` | `http://localhost` | Base URL used to build the post-OAuth redirect and failure redirect |

## Tests

2 files under `src/__tests__/unit/`:

- `AuthController.test.ts`
- `AuthService.test.ts`

Run: `yarn workspace @itinera/auth test` or `cd services/auth && yarn test`
(Vitest), or `make test s=auth`.

## Models

N/A — no LLM calls in this service.

## Error handling

- All route handlers funnel unexpected errors to Express's `next(err)`,
  ultimately handled by the shared `errorHandler` middleware (see
  `services/shared/README.md`), which maps `AppError` subclasses
  (`UnauthorizedError`, `ConflictError`, `ValidationError`, `NotFoundError`)
  to their status codes and collapses anything else to a generic 500.
- Request-body validation failures return a `ValidationError` built from the
  first Zod issue message, not the full Zod error tree — keeps client-facing
  messages terse.
- Invalid/expired refresh tokens on `/refresh` clear the cookie and return
  401 rather than throwing, so the client can cleanly redirect to login.
- Google OAuth failures redirect to `${FRONTEND_URL}/auth/login?error=oauth_failed`
  (Passport's `failureRedirect`) rather than returning a JSON error, since
  the browser is mid-redirect at that point.

## Performance

- `bcrypt` hashing cost (`BCRYPT_ROUNDS`) is a fixed constant in
  `AuthService.ts`, not configurable via env — a deliberate simplicity
  choice for this MVP scope.
- The OAuth exchange code in Redis has a 60-second TTL and is deleted on
  first read (`GETDEL`), bounding both the replay window and Redis memory
  usage per login.
- Depends on `services/shared/dist` being built first (`make build-shared`)
  like every other service — see the shared package's README.

## Tech decisions

- Uses `passport` + `passport-google-oauth20` purely for the OAuth2
  handshake; session support is explicitly disabled (`session: false`) since
  this service is stateless/JWT-based, not session-cookie-based.
- `SUPPORTED_LANGUAGES = ['en', 'pt']` is defined and exported from
  `AuthService.ts` itself (not from `@itinera/shared`) and consumed by the
  controller's `UpdateLanguageSchema` — the single source of truth for
  which locales the product supports.
