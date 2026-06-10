export const TRIP_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
export const OWNER_EMAIL = 'traveller@example.com';
export const OWNER_NAME = 'Maria Santos';

export const MOCK_TRIP = {
  id: TRIP_ID,
  name: 'Lisbon Long Weekend',
  region: 'Lisbon, Portugal',
  ownerId: 'user-42',
  owner: { id: 'user-42', email: OWNER_EMAIL, name: OWNER_NAME },
  travellers: [
    { preferences: { persona: 'culture', flexibility: 'medium', pace: 'medium' } },
    { preferences: { persona: 'gastronomy', flexibility: 'high', pace: 'medium' } },
    { preferences: { persona: 'relaxation', flexibility: 'medium', pace: 'low' } },
    { preferences: { persona: 'action', flexibility: 'high', pace: 'high' } },
  ],
  proposals: [],
  metrics: [],
  destinations: [{ country: 'Portugal', city: 'Lisbon', nights: 3 }],
  budgetTotal: 2000,
  budgetCurrency: 'EUR',
  startDate: new Date('2026-09-10'),
  endDate: new Date('2026-09-13'),
  status: 'draft',
  createdAt: new Date('2026-06-01T10:00:00Z'),
  updatedAt: new Date('2026-06-01T10:00:00Z'),
};

export const AGENT_RESULT = {
  content: {
    itinerary: [
      {
        day: 1,
        activities: [
          { time: '10:00', activity: 'Belém Tower visit', cost: 12, currency: 'EUR', satisfies: ['alice', 'bob'] },
          { time: '14:00', activity: 'Pastéis de Belém lunch', cost: 15, currency: 'EUR', satisfies: ['alice', 'bob', 'carlos', 'diana'] },
        ],
      },
    ],
    satisfactionEstimates: { alice: 0.85, bob: 0.80, carlos: 0.75, diana: 0.78 },
    unresolvedConflicts: [],
    compromiseRationale: 'Balanced mix of culture, gastronomy, and relaxation.',
  },
  reasoning: 'All agents agreed on core activities.',
  latencyMs: 350,
  tokensUsed: 1200,
};
