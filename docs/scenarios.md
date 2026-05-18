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

## Scenario 003 — 4 people, mixed preferences (planned)

**File:** `tests/scenarios/003-four-people-mixed.test.ts`
**Status:** planned

Full 4-agent negotiation (Alice, Bob, Carlos, Diana) with partially overlapping preferences
requiring the orchestrator to balance competing demands across ≥2 rounds.

---

## Scenario 004 — Budget constraint binding (planned)

**File:** `tests/scenarios/004-budget-constraint.test.ts`
**Status:** planned

Scenario where agent proposals exceed the budget cap, requiring the FinanceAgent
to flag violations and the CompromiseGenerator to substitute lower-cost alternatives.

---

## Scenario 005 — Logistical conflict resolution (planned)

**File:** `tests/scenarios/005-logistical-conflicts.test.ts`
**Status:** planned

Scenario where initial proposals have timing overlaps or unrealistic travel times,
requiring the LogisticsAgent to flag issues and the ProposalRefiner to adjust.

---

## Scenario 006 — Max rounds reached, no convergence (planned)

**File:** `tests/scenarios/006-no-convergence.test.ts`
**Status:** planned

Stress test verifying that the negotiation engine halts gracefully at the round
limit when preferences are irreconcilable, and returns the best available compromise.
