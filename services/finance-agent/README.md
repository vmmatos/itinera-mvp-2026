# finance-agent

Budget validation and negotiation service for the itinera negotiation pipeline. Port `3004` (debug `9232`).

## Purpose

Given a merged itinerary and a group's budget constraint, finance-agent computes the real cost breakdown, checks it against the budget (with a tolerance band), and — only when genuinely over budget — asks an LLM to propose concrete, named cost-saving alternatives. It never hard-blocks a trip; it issues a **verdict** (approved / feasible-with-changes / infeasible) that the orchestrator's `WorkflowEngine` acts on.

## How it works

Entry point is `POST /finance` (`src/routes/finance.ts`), backed by four collaborating classes under `src/agents/`:

- **`CostCalculator`** — deterministic. Sums cost items (accommodation, activities, meals, transport) from the merged proposal into a `CostBreakdown` (group total + per-person + per-category). Costs may be flagged `isEstimate: true` with a `source` (`google_places_price_level` | `attraction_db` | `heuristic_estimate`) when no real quote exists.
- **`BudgetValidator`** — deterministic. Compares `CostBreakdown.grandTotal` against the trip's budget, applying a tolerance ceiling (`budgetTotal * (1 + tolerancePct/100)`). Returns `status: 'within_budget' | 'within_tolerance' | 'over_budget'`.
- **`BudgetBreakdownBuilder`** — deterministic. Formats the breakdown for API/UI consumption.
- **`AlternativeFinder`** (extends `BaseFinanceAgent`) — the **only** LLM-calling class in this service. Skips the LLM call entirely when `status` is `within_budget` or `within_tolerance` (a tolerance overrun is approved with a warning — spending a call hunting for cuts the orchestrator won't act on is wasted quota). When truly `over_budget`, it sends the full itinerary, cost breakdown, and overrun amount to Claude and asks for named, priced alternatives.

`src/services/FinanceVerdict.ts` (`buildFinanceVerdict`) turns the breakdown + validation + alternatives into the `FinanceVerdict` shape the orchestrator consumes: `approved` (fits now), `budgetFeasible` (fits after the best suggested savings — when `false` the orchestrator rejects the trip and asks the user to reformulate), `withinTolerance`, `issues[]`, and a human-readable `reasoning` string that also names the largest offending cost category.

## Design decisions

- **Soft veto, not hard block** (per project convention) — finance never fails a trip outright; it always returns a verdict the orchestrator can act on (repair loop, tolerance approval, or reformulation request).
- **LLM call is gated on actual need** — 3 of the 4 agent classes are pure arithmetic; only the negotiation step calls out to Claude, and only when the itinerary is genuinely over the tolerance band.
- **`BUDGET_TOLERANCE_PCT` must match the orchestrator's copy of the same constant** — the orchestrator's `WorkflowEngine` uses it independently to compute repair targets (`budgetTotal * (1 + BUDGET_TOLERANCE_PCT/100)`); the two are not read from a shared source, so they must be kept in sync manually across `.env` files.

## Prompt templates

One template: `src/config/prompts/budget-negotiator.txt`, loaded by `AlternativeFinder`.

Summary of what it instructs the model to do:
- Given an itinerary + cost breakdown + exact overrun amount, identify the highest-cost items that can be substituted without gutting the core trip experience.
- Suggest 2–4 specific cheaper alternatives per over-budget category, with an estimated saving each, and a revised total budget estimate.
- **Naming rule**: alternatives must be real, specific, named venues with realistic EUR market prices for the destination (e.g. "The Independente Hostel & Suites (Lisbon, ~€45/night/person)"), never generic descriptions like "a cheaper hotel".
- Must respond with a single JSON object only (`suggestions[]`, `totalPotentialSaving`, `revisedBudgetEstimate`, `negotiationSummary`) — no prose outside the JSON.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3004` | HTTP listen port |
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `LOG_LEVEL` | `info` | Logger verbosity |
| `ANTHROPIC_API_KEY` | *(required)* | Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model used by `AlternativeFinder` |
| `AI_PROVIDER` | `anthropic` | Provider selector (only `anthropic` implemented) |
| `POSTGRES_HOST` / `PORT` / `DB` / `USER` | `localhost` / `5432` / `itinera` / `itinera` | Postgres connection |
| `POSTGRES_PASSWORD` | *(required)* | Postgres password |
| `REDIS_HOST` / `PORT` | `localhost` / `6379` | Redis connection |
| `RABBITMQ_HOST` / `PORT` / `DEFAULT_USER` | `localhost` / `5672` / `itinera` | RabbitMQ connection |
| `RABBITMQ_DEFAULT_PASS` | *(required)* | RabbitMQ password |
| `RABBITMQ_EXCHANGE` | `agent.events` | Topic exchange for published agent events |
| `JWT_SECRET` | *(required)* | Shared JWT signing secret (validated at the Kong layer, re-verified here) |
| `JWT_ISSUER` | *(optional)* | Expected `iss` claim |
| `CACHE_TTL_SECONDS` | `3600` | Generic Redis cache TTL |
| `BUDGET_TOLERANCE_PCT` | `10` | Overrun tolerance band (0–50); **must match the orchestrator's value** |

## Tests

6 unit test files under `src/__tests__/unit/`:
- `AlternativeFinder.test.ts` — LLM call gating (skips on within-budget/tolerance), prompt construction, flexible-date pricing note
- `BudgetBreakdownBuilder.test.ts`
- `BudgetValidator.test.ts` — tolerance ceiling math, status transitions
- `CostCalculator.test.ts` — category summation, estimate flags
- `FinanceVerdict.test.ts` — verdict derivation for each budget status
- `finance.routes.test.ts` — HTTP layer

Run with `make test s=finance-agent` (Docker) or `make test-local s=finance-agent` (host). Inside the service: `yarn test` / `yarn test:unit`.

## Models

Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-4-20250514`) via the shared provider-agnostic `AnthropicService` — used only by `AlternativeFinder`, only when a trip is genuinely over budget beyond the tolerance band.

## Error handling

- Env validation via zod `EnvSchema.safeParse` — invalid/missing required vars (`ANTHROPIC_API_KEY`, `POSTGRES_PASSWORD`, `RABBITMQ_DEFAULT_PASS`, `JWT_SECRET`) exit the process at boot rather than failing at request time.
- The shared `AnthropicService` (used via `BaseFinanceAgent`) retries 429/5xx responses up to 3× with exponential backoff and flags `truncated: true` when the response hits `max_tokens`, rather than silently returning a cut-off JSON blob.
- No fetch timeout is wired specifically in this service beyond the shared Anthropic client's own retry/backoff — a hung Claude call is bounded by the SDK's defaults, not an explicit per-request timeout here.

## Performance

- `CACHE_TTL_SECONDS` (default 3600s) backs a generic Redis cache for repeated lookups (`RedisService`) — reduces redundant Postgres/AI round-trips within a negotiation session.
- The AI call is skipped entirely for `within_budget`/`within_tolerance` proposals, which is the primary cost/latency optimization in this service (avoids an unnecessary ~several-second Claude round-trip on every negotiation round).

## Tech decisions

- Cost items can carry an `isEstimate` flag with a `source` tag distinguishing real quotes from heuristic guesses — this feeds transparency in the UI (see `docs/proposals` currency/estimate related work) rather than presenting all numbers as equally authoritative.
- `FinanceVerdict.reasoning` always names the largest offending cost category when over budget, giving the orchestrator (and the repair-loop LLM prompt) a concrete steer rather than a generic "over budget" signal.
