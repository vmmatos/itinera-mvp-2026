# orchestrator-agent

Port `3003` · Kong route `/orchestrator-agent`

## Purpose

The negotiation/authoring brain of the pipeline. Where `orchestrator` (the
API-facing service) runs the `WorkflowStateMachine`, `orchestrator-agent` is
where the actual LLM calls for conflict analysis, compromise proposals,
refinement, itinerary merging, and budget-repair edit lists happen. It owns
five distinct agent classes, each backed by its own prompt file, each
serving a different `WorkflowState`.

## How it works

Five agent classes, all extending `BaseOrchestratorAgent`
(`src/agents/BaseOrchestratorAgent.ts`), which centralizes the
call-LLM → parse-JSON → schema-validate → retry-once → publish pipeline:

| Class | Prompt | `WorkflowState` it serves |
|---|---|---|
| `ConflictAnalyzer` | `analyze.txt` | pre-merge conflict/consensus analysis (legacy v1 negotiation path) |
| `CompromiseGenerator` | `propose.txt` | legacy v1: first compromise itinerary draft |
| `ProposalRefiner` | `refine.txt` | legacy v1: refines a draft against agent feedback, budget-aware via `remainingRounds` |
| `ItineraryMerger` | `merge.txt` | **`MERGE_AND_SCORE`** — merges the 4 personas' per-slot proposals + the logistics route graph into one itinerary, one target city per call |
| `ItineraryRepairer` | `repair.txt` | **`ITINERARY_REPAIR`** — turns Finance's `suggestedCuts` into a minimal, deterministic edit list against the existing itinerary (never a full re-merge) |

`ItineraryMerger` is the only call marked `strict = true` in
`BaseOrchestratorAgent.callAIAndBuild` — its output feeds transport,
restrictions, and weather logic downstream, so a still-invalid response
after retry throws instead of falling back to `{raw}` content (every other
action tolerates a raw fallback if not strict).

## Design decisions

- **One call per target city** for `ItineraryMerger` (see `merge.txt`'s
  "SCOPE OF THIS CALL" rule) rather than one call for the whole trip —
  keeps each call's output bounded regardless of trip length, at the cost
  of more calls for multi-city trips.
- **Fairness weighted by real travellers, not by agent count**: `merge.txt`
  requires a `personaWeights` map (how many real travellers hold each
  persona) and explicitly forbids a zero-weight persona's proposal from
  winning a contested slot over a proposal from a persona with real
  travellers behind it.
- **Traceability via `proposalIds`**: every merged activity carries the
  `id`(s) of the slot proposal(s) it came from, and every proposal offered
  for the target city gets a `decisions` log entry (`accepted` /
  `merged` / `rejected` + a one-sentence reason) — even the ones not used.
  This is what makes it possible to explain in the UI why a persona's
  proposal was or wasn't used.
- **Repair returns edits, not a rewrite**: `repair.txt` explicitly forbids
  rewriting the itinerary; it must emit a small ordered edit list
  (downgrade/remove against transport, meal, accommodation, or activity)
  applied deterministically by `orchestrator`. This is what keeps the
  budget-repair loop cheap (see `ITINERARY_REPAIR` in the orchestrator's
  `CLAUDE.md` — targeted edits cost roughly 8k tokens vs ~170k for a full
  re-merge).
- **Negotiation deadline awareness**: `refine.txt` reads `round` and
  `remainingRounds` from the feedback and explicitly triages — fix
  everything with rounds to spare, fix only budget/physically-impossible
  issues when rounds are nearly exhausted.
- **Human pacing rule**: both `propose.txt` and `refine.txt` instruct the
  model to treat any day with >4h of inter-city travel as a "travel day" —
  light schedule, one activity at most, no full sightseeing programme
  stacked on top of a long journey.

## Prompt templates

All in `src/config/prompts/`, loaded via `fs.readFileSync` in each agent
class's constructor:

- **`analyze.txt`** — given all agents' proposals for a round, identify
  conflicts (agents involved, topic, 1–5 severity) and consensus areas,
  output an `overallConflictScore` and `roundSummary`. Legacy v1 path.
- **`propose.txt`** — given the conflict analysis and trip context,
  generate one balanced itinerary draft. Enforces the human-pacing rule and
  a "name real venues, never generic descriptions" rule; targets ≥0.7
  `satisfactionEstimates` per persona. Legacy v1 path.
- **`refine.txt`** — given a draft and feedback points, apply targeted
  changes, log each `changesApplied` entry, and re-estimate satisfaction.
  Same real-venue and human-pacing rules as `propose.txt`, plus the
  round-budget triage logic above. Legacy v1 path.
- **`merge.txt`** — the largest and most constrained prompt. Given the full
  route graph, budget plan, and all 4 personas' slot proposals, output the
  itinerary for exactly one named target city: respects the route graph's
  city order/dates/time-windows as the spine, applies `isTransitDay`
  handling (`inbound-transit` / `inbound-recovery` / `outbound-transit`),
  applies group `pace`/`mustHaves`/`avoids` overrides, and emits both the
  merged itinerary and the full `decisions` trace described above.
- **`repair.txt`** — given an over-budget merged itinerary and Finance's
  structured feedback (amount over budget, issues, `suggestedCuts`), return
  the smallest edit list that brings the trip to the budget target,
  ordered by least experience impact (transport/meal downgrade → cut a
  day's most expensive activity → downgrade accommodation → remove an
  activity with no must-have dependency). Never touches an activity tied to
  a group must-have, never empties a day that had several activities.

## Environment variables

From `src/config/index.ts` (zod `EnvSchema`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3003` | HTTP port |
| `NODE_ENV` | `development` | — |
| `LOG_LEVEL` | `info` | — |
| `ANTHROPIC_API_KEY` | *(required)* | — |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | — |
| `AI_PROVIDER` | `anthropic` | — |
| `POSTGRES_HOST` / `PORT` / `DB` / `USER` / `PASSWORD` | see schema | — |
| `REDIS_HOST` / `PORT` | `localhost` / `6379` | Proposal cache |
| `RABBITMQ_HOST` / `PORT` / `DEFAULT_USER` / `DEFAULT_PASS` | see schema | — |
| `RABBITMQ_EXCHANGE` | `agent.events` | — |
| `JWT_SECRET` | *(required)* | — |
| `JWT_ISSUER` | *(optional)* | — |
| `CACHE_TTL_SECONDS` | `3600` | Redis cache TTL for agent results |

## Tests

`src/__tests__/unit/` (8 files, run via `make test s=orchestrator-agent` or
`yarn test`):

- `ConflictAnalyzer.test.ts`, `CompromiseGenerator.test.ts`,
  `ProposalRefiner.test.ts` — legacy v1 agent classes.
- `ItineraryMerger.test.ts` — merge scope, transit-day handling, decision log.
- `ItineraryRepairer.test.ts` — edit-list generation and validation.
- `PriceGuard.test.ts` — price-range plausibility audit.
- `proposalOutput.schema.test.ts` — zod schema coverage for LLM output shape.
- `orchestrator.routes.test.ts` — HTTP route layer.

## Models

`ANTHROPIC_MODEL` (default `claude-sonnet-4-20250514`) via the shared
`IAIProvider`, same pattern as every other agent service.

## Error handling

- **Schema-validated LLM output, not trusted blind**: `propose`/`refine`
  output is checked against `ProposalOutputSchema`, `repair` output against
  `RepairOutputSchema` (`src/schemas/`). On failure, one retry is issued
  with the specific validation issues (and a truncation hint if
  applicable) fed back to the model. Only `ItineraryMerger`'s call is
  `strict` — a still-invalid response there throws; every other action
  falls back to `{ raw: content }` if still invalid after retry (unless
  the caller also passes `strict`).
- **`ITINERARY_MAX_TOKENS = 32000`** for propose/refine/merge/repair calls
  — raised from an earlier 8192 ceiling that truncated on 3+ destination
  trips; truncation is still detected (`response.truncated`) and folded
  into the retry prompt.
- **`PriceGuard.auditPrices`** (`src/services/PriceGuard.ts`) is a
  soft, log-only plausibility check: after a successful `propose`/`refine`
  validation, every accommodation and activity price is checked against a
  per-country EUR range table (falls back to a wide `DEFAULT` range for
  unlisted countries). Out-of-range prices are logged as warnings — this
  never blocks or rewrites the itinerary, it only surfaces LLM-hallucinated
  prices for later stages (finance-agent) to catch.
- Same `tryParseJSON` fence-stripping pattern as `preference-agent`.

## Performance

- Redis caches every agent call result for `CACHE_TTL_SECONDS` (3600s
  default) keyed by trip/round/action, so retried workflow states don't
  re-call the LLM.
- `services/shared/dist` is bind-mounted read-only in dev — run
  `make build-shared` after a fresh clone.

## Tech decisions

- Splitting `ItineraryMerger` from `ItineraryRepairer` (rather than one
  "fix the itinerary" agent) lets the repair path stay a small, targeted,
  deterministic-edit prompt instead of re-running the expensive full merge
  — this is the mechanism behind the ~8k vs ~170k token/cycle difference
  documented in the root `WorkflowEngine` design.
- `PriceGuard`'s per-country range table is intentionally coarse (6
  countries + a default) — it's a plausibility net for gross hallucinations
  (e.g. €333/night in a country where €400 is already the ceiling), not a
  real pricing source; real per-item pricing lives in logistics-agent's
  `HotelPriceService`/`AttractionPriceRepository`.
