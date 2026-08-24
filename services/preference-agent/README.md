# preference-agent

Port `3002` · Kong route `/preference-agent` (per `infrastructure/kong/configure.sh`)

## Purpose

Hosts the four traveller-preference personas — **Alice** (culture), **Bob**
(relaxation), **Carlos** (action), **Diana** (gastronomy) — that run in
parallel during the negotiation workflow (`PARALLEL_TURISTIC_PLANNING` state
in the orchestrator's `WorkflowEngine`). Each persona is the same code path
(`PreferenceAgent extends BaseAgent`) instantiated four times with a
different `AgentName` and a different pair of prompt files. The service has
no opinion of its own — it is a thin AI-calling shell around four system
prompts.

## How it works

- `BaseAgent` (`src/agents/BaseAgent.ts`) implements three entry points:
  - `propose(tripId, round, context)` — free-form itinerary proposal (legacy
    v1 negotiation path).
  - `react(tripId, round, proposals, context)` — reacts to other agents'
    proposals (legacy v1 path).
  - `proposeForSlot(tripId, round, slots)` — the v2 path used by the current
    `WorkflowEngine`: the orchestrator pre-computes time slots (per city,
    per day, per morning/afternoon/evening) from the logistics route graph,
    and each persona only fills those slots — it never chooses destinations,
    transport, or accommodation.
- `PreferenceAgent` (`src/agents/PreferenceAgent.ts`) is a thin subclass:
  its constructor reads `config/prompts/${name}.txt` as the base
  `systemPrompt` and, if present, `config/prompts/${name}-slots.txt` as
  `slotSystemPrompt`. `proposeForSlot` uses `slotSystemPrompt ?? systemPrompt`.
- Results are cached in Redis per `tripId:agent:round:action` for 3600s
  (`CACHE_TTL_SECONDS` in `BaseAgent.ts`) so a retried workflow step doesn't
  re-call the LLM.
- Every call publishes an `AgentEvent` to RabbitMQ via `RabbitMQPublisher`
  (routing key `agent.<name>.<action>`). **The orchestrator, not this
  service, is responsible for persisting proposals** — `ProposalStorageService.save()`
  exists in this codebase but is never called by the agents themselves (see
  `buildAgentEvent`/publish path in `BaseAgent.callAIAndBuild`).

## Design decisions

- One persona = one prompt pair, not one persona = one class hierarchy —
  keeps behavioural differences entirely in the prompt files, so tuning a
  persona's voice or rules never touches TypeScript.
- Slot-based proposing (v2) replaced free-form itinerary proposing (v1)
  specifically to make merging deterministic — see `orchestrator-agent`'s
  `ItineraryMerger`, which relies on personas returning one proposal per
  slot with a stable `id`.
- `proposeForSlot` assigns a `randomUUID()` to any slot proposal missing an
  `id` (the LLM never generates one) — added so the merge stage can trace
  an itinerary activity back to its originating proposal via `proposalIds`
  instead of reconstructing a `city+date+slot` key from two independently
  generated LLM outputs.
- Budget enforcement is advisory-then-corrective, not a hard gate: the
  `*-slots.txt` prompts tell the model to stay within
  `budgetPerPersonBlock`, but nothing stops it overshooting. `findBudgetOverruns`
  / `buildBudgetCorrectionMessage` (`src/agents/budgetCheck.ts`) detect an
  overrun and re-ask the model once with the actual numbers; if it still
  overshoots, the proposal is let through rather than dropped — a starved
  persona (zero activities) is considered a worse failure than a
  budget miss, which downstream finance/validation can still catch.

## Prompt templates

All in `src/config/prompts/`, loaded via `fs.readFileSync` in the
`PreferenceAgent` constructor. Each persona has a **base** prompt (legacy
free-form `propose`/`react` path) and a **slots** prompt (current
`proposeForSlot` path):

| File | Used for |
|---|---|
| `alice.txt` / `alice-slots.txt` | Culture, museums, history. Names real venues (never "a museum"), returns a full itinerary proposal (base) or per-slot activities (slots). |
| `bob.txt` / `bob-slots.txt` | Relaxation, beach, wine. Same structure, culture swapped for coastal/relaxation venues. |
| `carlos.txt` / `carlos-slots.txt` | Adventure, hiking, outdoor sports. Same structure, real trail/park/operator names. |
| `diana.txt` / `diana-slots.txt` | Gastronomy, fine dining, food markets. Same structure, real restaurant/market names. |

Common rules baked into every base prompt: never suggest a different
destination than the one already chosen, always name real venues with
realistic EUR per-person costs, respond with strict JSON only (a `proposal`
object, or a `reaction` object when reacting to others).

Common rules baked into every `-slots.txt` prompt: the persona is only
filling pre-defined `morning`/`afternoon`/`evening` slots — it must not
invent destinations, transport, or accommodation, and must respect
per-slot `durationMinutes` and `budgetPerPersonBlock`. Each slots prompt
also defines behaviour for `isTransitDay` slots (`inbound-transit`,
`inbound-recovery`, `outbound-transit`) and for group-level overrides that
outrank the persona's own taste:
- `pace` (`low`/`medium`/`high`) controls how densely a day is packed.
- `mustHaves` are themes the group asked for — the persona must try to
  cover each one at least once, even outside its usual taste.
- `avoids` are hard exclusions — never proposed, a neutral alternative is
  used instead.

Output shape differs slightly between personas only in the activity
`category` enum (e.g. Alice: `culture | museum | history | mixed`; Carlos:
`hiking | adventure | outdoor | sports | mixed`) — everything else
(fields, transit rules, group-preference rules) is identical across all
four `-slots.txt` files.

## Environment variables

From `src/config/index.ts` (zod `EnvSchema`, service exits on invalid env):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP port |
| `NODE_ENV` | `development` | `development \| production \| test` |
| `LOG_LEVEL` | `info` | Winston log level |
| `ANTHROPIC_API_KEY` | *(required)* | Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Model id |
| `AI_PROVIDER` | `anthropic` | Only `anthropic` is implemented |
| `POSTGRES_HOST` | `localhost` | — |
| `POSTGRES_PORT` | `5432` | — |
| `POSTGRES_DB` | `itinera` | — |
| `POSTGRES_USER` | `itinera` | — |
| `POSTGRES_PASSWORD` | *(required)* | — |
| `REDIS_HOST` | `localhost` | Proposal cache |
| `REDIS_PORT` | `6379` | — |
| `RABBITMQ_HOST` | `localhost` | — |
| `RABBITMQ_PORT` | `5672` | — |
| `RABBITMQ_DEFAULT_USER` | `itinera` | — |
| `RABBITMQ_DEFAULT_PASS` | *(required)* | — |
| `RABBITMQ_EXCHANGE` | `agent.events` | Topic exchange for agent events |
| `JWT_SECRET` | *(required)* | Shared JWT verification secret |
| `JWT_ISSUER` | *(optional)* | Expected `iss` claim |

## Tests

`src/__tests__/unit/` (Vitest, run via `make test s=preference-agent` or
`yarn test` inside the service):

- `BaseAgent.test.ts` — propose/react/proposeForSlot flows, cache hit/miss,
  schema-validation retry-then-throw behaviour, budget-overrun re-ask.
- `PreferenceAgent.test.ts` is not present as a separate file — persona
  wiring is covered by `agents.personas.test.ts`.
- `agents.personas.test.ts` — the four persona classes load their correct
  prompt files and `agentName`.
- `budgetCheck.test.ts` — `findBudgetOverruns` / `buildBudgetCorrectionMessage`.
- `preferences.routes.test.ts` — HTTP route layer.

## Models

`ANTHROPIC_MODEL` (default `claude-sonnet-4-20250514`) via the shared
provider-agnostic `IAIProvider` interface, selected by `AI_PROVIDER`
(currently only `anthropic` is implemented in
`services/shared/src/services/aiProviderFactory.ts`).

## Error handling

- `tryParseJSON` strips ```` ```json ```` fences before parsing; a still-unparseable
  response degrades to `{ raw: content }` for the legacy `propose`/`react`
  path (no schema enforced there).
- For `proposeForSlot` (schema-enforced path), a response that fails
  `SlotProposalsOutputSchema` triggers exactly one retry with the
  validation issues fed back to the model; if it's *still* invalid, the
  call throws rather than silently saving unusable content — a deliberate
  change from the legacy path's silent `{raw}` fallback, since a silent
  fallback there was indistinguishable downstream from "this persona had
  nothing to propose."
- `PROPOSE_SLOTS_MAX_TOKENS = 16000` (vs the shared provider's 4096
  default) — a persona proposes across every slot in the trip in one call,
  and the default budget was found to truncate mid-JSON on anything past a
  small 1–2 city trip.
- Budget overruns (see Design decisions) are corrected with one re-ask,
  not treated as an error — the trip previously burned two full re-merge
  cycles downstream after a persona overshot a €2200 budget block by
  ~€2200, before this correction existed.

## Performance

- Redis caches every `propose`/`react`/`proposeForSlot` result for 1 hour
  keyed by `tripId:agent:round:action`, avoiding duplicate LLM calls on
  workflow retries.
- Bind-mounts `services/shared/dist` read-only in `dev/docker-compose.yaml`
  — run `make build-shared` after a fresh clone or the container starts
  against an empty directory.

## Tech decisions

- No AI logic lives outside the prompt files — `PreferenceAgent` itself has
  no persona-specific branching, so adding a fifth persona is a config
  change (new prompt files + `AgentName` entry), not a code change.
- `ProposalStorageService` and its `Proposal` entity exist in this service
  but are dead code from the agents' perspective (never invoked) — proposal
  persistence is centralized in `orchestrator`.
