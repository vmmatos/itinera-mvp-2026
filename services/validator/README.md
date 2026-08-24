# validator

## Purpose

Produces the single `validationScore` (0–100) that the orchestrator's
`WorkflowStateMachine` gates on at `FINAL_VALIDATION`: a score ≥60 lets the
trip proceed to `FINISH`; below that, the workflow retries `MERGE_AND_SCORE`
(budget permitting) using `context.scoreFeedback` to steer the next attempt.
Entirely rule-based — no AI calls, no LLM dependency at all. Runs on port
3006.

## How it works

- `src/index.ts` wires an Express app exposing `routes/validator.ts` (the
  scoring endpoint) and `routes/health.ts`.
- `POST /validate` (see `routes/validator.ts`) accepts `{ tripId, round,
  proposal, groupPreferences?, compliance?, constraints? }`, loads
  `Traveller` rows for the trip via TypeORM, and runs four independent
  calculators against the proposal:
  - **`ScoringEngine`** — per-traveller persona-fit score: a traveller with
    a hard "avoid" match in the proposal is vetoed outright (score 0); a
    traveller with no stated preferences scores 100 by default; otherwise
    score = `earned / denominator` over the traveller's `mustHaves`/`categories`.
  - **`FairnessCalculator`** — spread of per-traveller scores across the
    group (nobody should get a much worse itinerary than the others).
  - **`ComplianceScorer`** — blends `ScoringEngine`'s persona-fit output
    with optional `compliance.finance`/`compliance.logistics` signals
    (budget overage, transport downgrades, restriction warnings, weather
    risk) into the final 0–100 that gates `FINAL_VALIDATION`.
  - **`ConstraintChecker`** — hard pass/fail checks (budget/duration/traveller-count),
    driven by the optional `constraints` block.
  - **`MetricsCollector`** — records the round's metrics for
    `TripMetric`/`SatisfactionScore` persistence (orchestrator-owned entities,
    validator just computes the numbers).
- `ValidationService` orchestrates the four calculators and persists a
  `Proposal` row via `ProposalStorageService`.
- `RabbitMQPublisher` publishes a `validator`-authored event (via
  `AgentAction: 'score'`) so the admin SSE feed shows the score in real time.

## Design decisions

- **Zero AI dependency by design**: unlike the other four agents,
  `validator` has no `@anthropic-ai/sdk` dependency and no `ANTHROPIC_*` env
  vars — scoring is deterministic and auditable, which matters since it's
  the pass/fail gate for the whole negotiation.
- **`groupPreferences` at the trip level, not duplicated per-traveller**:
  the request schema comment explains this was a deliberate choice — the
  orchestrator already holds `mustHaves`/`avoids` in the workflow context,
  and re-deriving it from `trips` here would duplicate schema ownership
  across two services for one field. It's optional so a legacy trip (brief
  still embedded inside each traveller's own preference blob) still scores.
- **`pace` is explicitly not accepted** in `GroupPreferencesSchema` — flagged
  in a code comment referencing `ScoringEngine`, i.e. a deliberate scope
  exclusion, not an oversight.
- **`compliance` and `constraints` are both optional**, backward-compatible
  additions: an orchestrator on an older build that sends neither still gets
  persona-only scoring exactly as before — `ConstraintChecker`'s budget
  branch was previously dead code until `constraints` started being sent.
- **`travellerId`/`userId` alias handled via a Zod `.transform()`**: a
  `@deprecated` comment notes pre-M109 callers keyed travellers by user id;
  the transform normalizes both onto `travellerId` at the request boundary
  rather than pushing that branching into the scoring logic itself.

## Prompt templates

N/A — no LLM calls.

## Environment variables

From `src/config/index.ts` (zod `EnvSchema`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3006` | HTTP port |
| `NODE_ENV` | `development` | `development \| production \| test` |
| `LOG_LEVEL` | `info` | Winston log level |
| `POSTGRES_HOST` | `localhost` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port |
| `POSTGRES_DB` | `itinera` | Database name |
| `POSTGRES_USER` | `itinera` | Database user |
| `POSTGRES_PASSWORD` | *(required, no default)* | Database password |
| `RABBITMQ_HOST` | `localhost` | RabbitMQ host |
| `RABBITMQ_PORT` | `5672` | RabbitMQ port |
| `RABBITMQ_DEFAULT_USER` | `itinera` | RabbitMQ user |
| `RABBITMQ_DEFAULT_PASS` | *(required, no default)* | RabbitMQ password |
| `RABBITMQ_EXCHANGE` | `agent.events` | Topic exchange the score event is published to |
| `JWT_SECRET` | *(required, no default)* | Verifies incoming requests via `@itinera/shared` `authMiddleware` |
| `JWT_ISSUER` | *(optional)* | Enforced `iss` claim if set |

## Tests

7 files under `src/__tests__/unit/`:

- `ScoringEngine.test.ts`
- `FairnessCalculator.test.ts`
- `ComplianceScorer.test.ts`
- `ConstraintChecker.test.ts`
- `MetricsCollector.test.ts`
- `ProposalStorageService.sql.test.ts`
- `validator.routes.test.ts`

Run: `yarn workspace @itinera/validator test` or `cd services/validator &&
yarn test`, or `make test s=validator`.

## Models

N/A, rule-based — no Anthropic model configured or called.

## Error handling

- Request validation is `zod`-based at the route boundary
  (`ValidateSchema`, `TravellerPreferenceSchema`); malformed requests fail
  fast with a `ValidationError` before any scoring runs, routed through the
  shared `errorHandler` middleware.
- The `travellerId`/`userId` transform raises a Zod issue (`ctx.addIssue`)
  if neither id field is present, rather than silently defaulting to
  `undefined` and producing a mis-scored traveller.
- `compliance`/`constraints` being absent is not an error — the code
  explicitly falls back to persona-only scoring rather than rejecting the
  request, to stay compatible with older orchestrator builds.

## Performance

- Scoring is synchronous, in-process, pure computation over the request
  payload plus one `Traveller` lookup — no external API calls, so latency
  is dominated by the Postgres round-trip, not by any calculator.
- No caching layer (no Redis dependency) — nothing here is expensive enough
  to warrant one.
- Depends on `services/shared/dist` being built first (`make build-shared`).

## Tech decisions

- The four calculators (`ScoringEngine`, `FairnessCalculator`,
  `ComplianceScorer`, `ConstraintChecker`) are separate classes with a
  single responsibility each, composed by `ValidationService` — makes each
  scoring rule independently unit-testable (reflected in the 1:1 test-file
  mapping above) without needing a live database or HTTP layer.
- Publishes to the same `agent.events` topic exchange as every other agent
  (`AgentName: 'validator'`), keeping the admin SSE feed provider-agnostic
  about which service emitted a given event.
