/**
 * Smoke tests — WorkflowEngine v2 service endpoints
 *
 * Hit real running services. Not mocked. Requires all services started:
 *   make dev && make up s=orchestrator
 *
 * Run:
 *   make test-smoke
 *
 * These verify that each new endpoint introduced for the v2 workflow is
 * reachable and returns a valid schema. They do NOT test business logic
 * (that is covered by scenario and unit tests).
 */

import { describe, it, expect } from 'vitest';

const LOGISTICS_URL = process.env['LOGISTICS_AGENT_URL'] ?? 'http://localhost:3005';
const FINANCE_URL   = process.env['FINANCE_AGENT_URL']   ?? 'http://localhost:3004';
const PREF_URL      = process.env['PREFERENCE_AGENT_URL'] ?? 'http://localhost:3002';
const ORCH_URL      = process.env['ORCHESTRATOR_AGENT_URL'] ?? 'http://localhost:3003';

// Minimal valid payload for logistics /plan
const MINIMAL_LOGISTICS_PAYLOAD = {
  tripId: 'smoke-test-001',
  round: 1,
  destinations: [{ city: 'Porto', country: 'Portugal', nights: 3 }],
  dateInput: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-13' },
  transportPreference: 'train',
  budgetTotal: 1200,
  budgetCurrency: 'EUR',
  groupSize: 2,
};

const MINIMAL_ROUTE_GRAPH = {
  orderedLegs: [],
  cityStays: [
    {
      city: 'Porto', country: 'Portugal',
      arrivalDate: '2026-09-10', departureDate: '2026-09-13',
      nights: 3,
      timeWindows: [{ date: '2026-09-11', slot: 'morning', durationMinutes: 240, isTransitDay: false }],
      sleepPoint: 'Ribeira', budgetPerPersonPerNight: 80,
    },
  ],
  totalTransportCostEurPerPerson: 0,
  totalDurationDays: 3,
};

const MINIMAL_FINANCE_PAYLOAD = {
  tripId: 'smoke-test-001',
  round: 1,
  routeGraph: MINIMAL_ROUTE_GRAPH,
  budgetTotal: 1200,
  budgetCurrency: 'EUR',
  groupSize: 2,
};

const MINIMAL_SLOT_PAYLOAD = {
  tripId: 'smoke-test-001',
  round: 1,
  slots: [
    {
      tripId: 'smoke-test-001', round: 1,
      city: 'Porto', country: 'Portugal',
      dateWindow: { start: '2026-09-10', end: '2026-09-13' },
      availableTimeSlots: [{ date: '2026-09-11', slot: 'morning', durationMinutes: 240, isTransitDay: false }],
      budgetPerPersonBlock: 300, currency: 'EUR',
      mustHaves: [], avoids: [], groupSize: 2,
    },
  ],
  agents: ['alice'],
};

const MINIMAL_BUDGET_PLAN = {
  perBlock: [{ city: 'Porto', transportCostEurPerPerson: 0, accommodationBudgetEurPerPerson: 240, experiencesBudgetEurPerPerson: 360, totalEurPerPerson: 600 }],
  totalEurPerPerson: 600, grandTotal: 1200, feasible: true, bufferPct: 20, currency: 'EUR',
};

const MINIMAL_MERGE_PAYLOAD = {
  tripId: 'smoke-test-001',
  round: 1,
  routeGraph: MINIMAL_ROUTE_GRAPH,
  touristOutputs: {
    alice: { slotProposals: [{ city: 'Porto', slot: 'morning', activity: 'Ribeira Market', cost: 0 }] },
  },
  budgetPlan: MINIMAL_BUDGET_PLAN,
  tripContext: 'Smoke test trip. Budget: €1200 EUR. Group size: 2.',
};

async function post(url: string, body: unknown, authToken?: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  return { status: res.status, data };
}

// JWT for smoke tests — must have a valid signature for the running service.
// When running against make dev the JWT_SECRET=dev-secret is used.
const SMOKE_JWT = process.env['SMOKE_JWT'] ?? '';

describe('Smoke: logistics-agent /plan', () => {
  it('returns a valid RouteGraph with cityStays', async () => {
    const { status, data } = await post(`${LOGISTICS_URL}/plan`, MINIMAL_LOGISTICS_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const body = data as Record<string, unknown>;
    expect(body).toHaveProperty('routeGraph');
    const rg = body['routeGraph'] as Record<string, unknown>;
    expect(Array.isArray(rg['cityStays'])).toBe(true);
    expect((rg['cityStays'] as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('every leg in orderedLegs has a bestOption', async () => {
    const { status, data } = await post(`${LOGISTICS_URL}/plan`, MINIMAL_LOGISTICS_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const rg = (data as Record<string, unknown>)['routeGraph'] as Record<string, unknown>;
    const legs = rg['orderedLegs'] as Array<Record<string, unknown>>;
    for (const leg of legs) {
      expect(leg).toHaveProperty('bestOption');
    }
  });
});

describe('Smoke: finance-agent /estimate', () => {
  it('returns a valid BudgetPlan with feasible field', async () => {
    const { status, data } = await post(`${FINANCE_URL}/estimate`, MINIMAL_FINANCE_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const body = data as Record<string, unknown>;
    expect(body).toHaveProperty('budgetPlan');
    const bp = body['budgetPlan'] as Record<string, unknown>;
    expect(typeof bp['feasible']).toBe('boolean');
    expect(typeof bp['bufferPct']).toBe('number');
    expect(bp['bufferPct'] as number).toBeGreaterThanOrEqual(-100);
  });
});

describe('Smoke: preference-agent /propose-slots', () => {
  it('returns proposals array with one entry per requested agent', async () => {
    const { status, data } = await post(`${PREF_URL}/propose-slots`, MINIMAL_SLOT_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const body = data as Record<string, unknown>;
    expect(body).toHaveProperty('proposals');
    const proposals = body['proposals'] as unknown[];
    expect(proposals.length).toBe(1); // requested agents: ['alice']
  });

  it('slot proposals do not contain a destinations key (slot-scoped only)', async () => {
    const { status, data } = await post(`${PREF_URL}/propose-slots`, MINIMAL_SLOT_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const body = data as Record<string, unknown>;
    const proposals = body['proposals'] as Array<Record<string, unknown>>;
    for (const p of proposals) {
      expect(p).not.toHaveProperty('destinations');
    }
  });
});

describe('Smoke: orchestrator-agent /merge', () => {
  it('returns a merged itinerary array', async () => {
    const { status, data } = await post(`${ORCH_URL}/merge`, MINIMAL_MERGE_PAYLOAD, SMOKE_JWT);
    expect(status).toBe(200);
    const body = data as Record<string, unknown>;
    // /merge may wrap in { itinerary } or return it directly depending on implementation
    const hasItinerary =
      Array.isArray(body['itinerary']) ||
      (body['content'] && Array.isArray((body['content'] as Record<string, unknown>)['itinerary']));
    expect(hasItinerary).toBe(true);
  });
});
