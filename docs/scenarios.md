# Scenario Test Specifications

End-to-end acceptance scenarios for the multi-agent negotiation engine.
Each scenario tests a distinct real-world trip configuration.

Test files: `tests/scenarios/<NNN>-<slug>.test.ts`
Run: `make test-scenarios`

---

## Scenario 001 — 2 people, compatible preferences

**File:** `tests/scenarios/001-compatible-preferences.test.ts`
**Status:** implemented

### Input

| Field | Value |
|-------|-------|
| Participants | Alice (Culture & History), Bob (Relaxation & Wine) |
| Duration | 2 days |
| Destination | Sintra, Portugal |
| Budget | €300 total |

### Acceptance criteria

| Criterion | Threshold |
|-----------|-----------|
| Convergence | ≤ 4 negotiation rounds |
| Fairness | Satisfaction score ≥ 80% per agent |
| Budget | Final itinerary ≤ €300 total |
| Logistics | No overlapping activity times within a day |

### Rationale

Alice (palaces, walking tours) and Bob (Quinta da Regaleira, wine tasting, scenic views) have
naturally overlapping interests in Sintra. The ConflictAnalyzer should return
`overallConflictScore < 1.0` in round 1, enabling the CompromiseGenerator to produce
a balanced itinerary without further refinement rounds.

---

## Scenario 002 — 4 people, conflicting preferences

**File:** `tests/scenarios/002-conflicting-preferences.test.ts`
**Status:** implemented

### Input

| Field | Value |
|-------|-------|
| Participants | Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining) |
| Duration | 2 days |
| Destinations | Sintra (day 1) + Cascais (day 2), Portugal |
| Budget | €600 total (4 people) |

### Acceptance criteria

| Criterion | Threshold |
|-----------|-----------|
| Convergence | ≤ 6 negotiation rounds |
| Fairness | Satisfaction score ≥ 65% per agent |
| Budget | Final itinerary ≤ €600 total |
| Logistics | No overlapping activity times within a day |
| Coverage | Both destinations represented across itinerary |

### Rationale

Alice (palaces, museums), Bob (wine, coastal leisure), Carlos (hiking, surfing, cycling),
and Diana (fine dining, food markets) have deeply opposing preferences on pace, activity
type, and budget allocation. The ConflictAnalyzer should return `overallConflictScore > 2.0`
in round 1, requiring multiple refinement rounds before the CompromiseGenerator can produce
a balanced itinerary satisfying all four profiles.

---

## Scenario 003 — 4 people, tight budget

**File:** `tests/scenarios/003-tight-budget.test.ts`
**Status:** implemented

### Input

| Field | Value |
|-------|-------|
| Participants | Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining) |
| Duration | 2 days |
| Destinations | Sintra (day 1) + Cascais (day 2), Portugal |
| Budget | €300 total (4 people) — 50% of normal |

### Acceptance criteria

| Criterion | Threshold |
|-----------|-----------|
| Budget flagged | FinanceAgent returns `over_budget` on initial proposals |
| Alternatives | AlternativeFinder provides cost substitutions |
| Convergence | ≤ 4 negotiation rounds |
| Fairness | Satisfaction score ≥ 60% per agent |
| Final budget | Total itinerary ≤ €300 for 4 people |
| Coverage | Both destinations represented across itinerary |

### Rationale

With only €75/person for 2 days, Diana's premium dining (€182/person/day) and Carlos's paid
outdoor activities alone breach the cap. The BudgetValidator must flag `over_budget` on initial
proposals. The AlternativeFinder then calls Claude to propose substitutions (free trails, local
taverns, fish markets). The ConflictAnalyzer should return `overallConflictScore > 2.0` in round 1
due to budget pressure, converging by round 3 after the orchestrator enforces substitutions. Final
compromise achieves ≥60% satisfaction for all four agents at ≤€276 total.

---

## Scenario 004 — Rain forecast

**File:** `tests/scenarios/004-rain-forecast.test.ts`
**Status:** implemented

### Input

| Field | Value |
|-------|-------|
| Participants | Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining) |
| Duration | 2 days |
| Destinations | Sintra (day 1) + Cascais (day 2), Portugal |
| Budget | €600 total (4 people) |
| Weather | 80% rain all day — both days |

### Acceptance criteria

| Criterion | Threshold |
|-----------|-----------|
| Weather flagging | LogisticsAgent returns `overallRisk: 'high'` with all outdoor activities in `affectedActivities[]` |
| Indoor alternatives | `indoorAlternatives[]` provided for every flagged activity |
| Convergence | ≤ 4 negotiation rounds |
| Fairness | Satisfaction score ≥ 60% per agent |
| Final plan | No outdoor activities remain (no trail/hike/surf/cycling/kayak/beach/cliff keywords) |
| Coverage | Both destinations represented across itinerary |

### Rationale

With 80% rain forecast all day, Carlos's outdoor-heavy plan (cliff hike, surfing, coastal cycling,
kayaking) and Bob's beach/coastal activities become high-risk. The WeatherAnalyzer must flag all
exposed activities and provide indoor museum/palace/workshop alternatives. The ConflictAnalyzer
should return `overallConflictScore > 2.0` in round 1 (Carlos's preferences now irreconcilable
with weather constraints). The CompromiseGenerator converges by round 2 with an indoor-only
itinerary covering both Sintra and Cascais, achieving ≥60% satisfaction for all four agents.

---

## Scenario 005 — Inflexible traveller

**File:** `tests/scenarios/005-inflexible-traveller.test.ts`
**Status:** implemented

### Input

| Field | Value |
|-------|-------|
| Participants | Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Elena (Beach & Coastal — `flexibility: low`) |
| Duration | 2 days |
| Destinations | Sintra (day 1) + Cascais (day 2), Portugal |
| Budget | €600 total (4 people) |
| Hard constraint | Elena has `flexibility=low` — beach/coastal activities required on both days |

### Acceptance criteria

| Criterion | Threshold |
|-----------|-----------|
| Hard constraint identified | ConflictAnalyzer returns `hardConstraints[]` with Elena's entry (`flexibility=low`, `topic=beach_coastal`) |
| Initial conflict | `overallConflictScore > 2.0` in round 1 |
| Convergence | ≤ 6 negotiation rounds |
| Elena satisfaction | ≥ 90% in final compromise |
| Group adaptation | Alice, Bob, Carlos each ≥ 65% satisfaction |
| Budget | Final itinerary ≤ €600 total (4 people) |
| Logistics | No overlapping activity times within a day |

### Rationale

Elena's single preference (beach/coastal) with `flexibility=low` acts as a hard constraint the
orchestrator must acknowledge in round 1. Alice's inland palaces and Carlos's mountain trails are
incompatible with this constraint, forcing `overallConflictScore > 2.0`. Over subsequent rounds,
Alice and Carlos adapt their proposals to coastal equivalents (Moorish Castle view walk, Guincho
coastal cycling). By round 3 the orchestrator converges on a compromise that preserves Elena's
beach anchors on both days (≥90% satisfaction) while keeping the rest of the group ≥65%.

---

## Scenario 006 — Max rounds reached, no convergence (planned)

**File:** `tests/scenarios/006-no-convergence.test.ts`
**Status:** planned

Stress test verifying that the negotiation engine halts gracefully at the round
limit when preferences are irreconcilable, and returns the best available compromise.
