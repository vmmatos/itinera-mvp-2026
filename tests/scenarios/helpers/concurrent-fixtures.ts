import type { AgentEvent } from '@itinera/shared';

export const TRIP_COUNT = 10;

export function makeTripId(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

export const TRIP_IDS = Array.from({ length: TRIP_COUNT }, (_, i) => makeTripId(i + 1));

export const OWNER_EMAIL = 'owner@example.com';
export const OWNER_NAME = 'Test Owner';

export function makeMockTrip(tripId: string) {
  return {
    id: tripId,
    name: `Test Trip ${tripId.slice(-4)}`,
    status: 'draft',
    region: 'Portugal',
    destinations: [{ city: 'Lisbon', country: 'Portugal', nights: 3 }],
    budgetTotal: 1500,
    budgetCurrency: 'EUR',
    startDate: '2026-07-01',
    endDate: '2026-07-04',
    owner: { id: 'owner-01', name: OWNER_NAME, email: OWNER_EMAIL },
    travellers: [
      {
        id: 'traveller-01',
        preferences: {
          persona: 'adventurer',
          flexibility: 'medium',
          pace: 'medium',
          mustHaves: [],
          dealBreakers: [],
        },
      },
    ],
  };
}

export const AGENT_RESULT = {
  content: {
    proposal: { activities: [] },
    // Approving verdict so the negotiation loop converges on the first round.
    verdict: { approved: true, budgetFeasible: true, issues: [], warnings: [], reasoning: 'ok' },
  },
  reasoning: 'mock reasoning',
  tokensUsed: 100,
};

export type MockAgentEvent = AgentEvent;

export function makeCachedEvent(tripId: string, agent: string, round: number): AgentEvent {
  return {
    tripId,
    type: 'agent.propose',
    agent,
    round,
    timestamp: new Date().toISOString(),
    content: { cached: true, proposal: { activities: [] } },
    reasoning: 'cached result',
    metrics: { latencyMs: 1, tokensUsed: 0 },
  };
}
