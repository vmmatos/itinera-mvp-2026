import type { RouteGraph, BudgetPlan } from '@itinera/shared';

export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440099';

export const MOCK_TRIP = {
  id: TRIP_ID,
  name: 'Porto & Lisbon Explorer',
  region: 'Portugal',
  ownerId: 'user-01',
  owner: { id: 'user-01', email: 'traveller@example.com', name: 'Vitor Matos' },
  travellers: [
    { id: 't1', preferences: { persona: 'culture', flexibility: 'medium', pace: 'medium' } },
    { id: 't2', preferences: { persona: 'relaxation', flexibility: 'high', pace: 'low' } },
    { id: 't3', preferences: { persona: 'action', flexibility: 'high', pace: 'high' } },
    { id: 't4', preferences: { persona: 'gastronomy', flexibility: 'medium', pace: 'medium' } },
  ],
  proposals: [],
  metrics: [],
  destinations: [
    { country: 'Portugal', city: 'Porto', nights: 3 },
    { country: 'Portugal', city: 'Lisbon', nights: 3 },
  ],
  budgetTotal: 2400,
  budgetCurrency: 'EUR',
  transportPreference: 'train',
  dateInput: { mode: 'fixed', startDate: '2026-09-10', endDate: '2026-09-16' },
  startDate: new Date('2026-09-10'),
  endDate: new Date('2026-09-16'),
  status: 'draft',
  workflowState: null,
  workflowContext: null,
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-07-01T10:00:00Z'),
  rejectionReason: null,
};

export const ROUTE_GRAPH_NO_LEGS: RouteGraph = {
  orderedLegs: [],
  cityStays: [
    {
      city: 'Porto',
      country: 'Portugal',
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-13',
      nights: 3,
      timeWindows: [
        { date: '2026-09-10', slot: 'afternoon', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-11', slot: 'morning', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-11', slot: 'afternoon', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-12', slot: 'morning', durationMinutes: 240, isTransitDay: false },
      ],
      sleepPoint: 'Ribeira',
      budgetPerPersonPerNight: 80,
    },
    {
      city: 'Lisbon',
      country: 'Portugal',
      arrivalDate: '2026-09-13',
      departureDate: '2026-09-16',
      nights: 3,
      timeWindows: [
        { date: '2026-09-13', slot: 'afternoon', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-14', slot: 'morning', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-14', slot: 'afternoon', durationMinutes: 240, isTransitDay: false },
        { date: '2026-09-15', slot: 'morning', durationMinutes: 240, isTransitDay: false },
      ],
      sleepPoint: 'Chiado',
      budgetPerPersonPerNight: 90,
    },
  ],
  totalTransportCostEurPerPerson: 0,
  totalDurationDays: 6,
};

export const ROUTE_GRAPH_WITH_TRAIN_LEG: RouteGraph = {
  orderedLegs: [
    {
      from: 'Porto',
      to: 'Lisbon',
      departureDate: '2026-09-13',
      bestOption: { mode: 'train', durationMinutes: 195, priceEur: 35, warnings: [] },
      alternatives: [],
      totalCostEurPerPerson: 35,
    },
  ],
  cityStays: ROUTE_GRAPH_NO_LEGS.cityStays,
  totalTransportCostEurPerPerson: 35,
  totalDurationDays: 6,
};

export const BUDGET_PLAN_FEASIBLE: BudgetPlan = {
  perBlock: [
    {
      city: 'Porto',
      transportCostEurPerPerson: 0,
      accommodationBudgetEurPerPerson: 240,
      experiencesBudgetEurPerPerson: 360,
      totalEurPerPerson: 600,
    },
    {
      city: 'Lisbon',
      transportCostEurPerPerson: 35,
      accommodationBudgetEurPerPerson: 270,
      experiencesBudgetEurPerPerson: 295,
      totalEurPerPerson: 600,
    },
  ],
  totalEurPerPerson: 1200,
  grandTotal: 4800,
  feasible: true,
  bufferPct: 16,
  currency: 'EUR',
};

export const BUDGET_PLAN_INFEASIBLE: BudgetPlan = {
  ...BUDGET_PLAN_FEASIBLE,
  feasible: false,
  bufferPct: -8,
};

export const TOURIST_SLOT_RESULTS = [
  {
    content: { slotProposals: [{ city: 'Porto', slot: 'morning', activity: 'Ribeira Market', cost: 0 }] },
    latencyMs: 120,
    tokensUsed: 150,
  },
  {
    content: { slotProposals: [{ city: 'Porto', slot: 'afternoon', activity: 'Wine tasting, Gaia', cost: 25 }] },
    latencyMs: 130,
    tokensUsed: 145,
  },
  {
    content: { slotProposals: [{ city: 'Porto', slot: 'morning', activity: 'Douro valley hike', cost: 0 }] },
    latencyMs: 110,
    tokensUsed: 155,
  },
  {
    content: { slotProposals: [{ city: 'Porto', slot: 'evening', activity: 'Francesinha dinner', cost: 18 }] },
    latencyMs: 125,
    tokensUsed: 148,
  },
];

export const MERGED_ITINERARY_CONTENT = {
  itinerary: [
    {
      day: 1,
      city: 'Porto',
      date: '2026-09-10',
      activities: [
        { name: 'Ribeira Market walk', time: 'morning', city: 'Porto', ownerAgent: 'alice' },
        { name: 'Wine tasting in Gaia', time: 'afternoon', city: 'Porto', ownerAgent: 'bob' },
        { name: 'Francesinha dinner', time: 'evening', city: 'Porto', ownerAgent: 'diana' },
      ],
    },
    {
      day: 4,
      city: 'Lisbon',
      date: '2026-09-13',
      activities: [
        { name: 'Alfama walking tour', time: 'afternoon', city: 'Lisbon', ownerAgent: 'alice' },
      ],
    },
  ],
  accommodation: [
    { city: 'Porto', name: 'Ribeira boutique hotel', pricePerNight: 80 },
    { city: 'Lisbon', name: 'Chiado guesthouse', pricePerNight: 90 },
  ],
  satisfactionEstimates: { alice: 0.82, bob: 0.79, carlos: 0.77, diana: 0.83 },
};

export const FINANCE_APPROVED_RESULT = {
  content: {
    verdict: {
      approved: true,
      budgetFeasible: true,
      issues: [],
      warnings: [],
      reasoning: 'Total spend within budget with adequate buffer.',
    },
  },
  latencyMs: 280,
  tokensUsed: 320,
};

export const FINANCE_REJECTED_RESULT = {
  content: {
    verdict: {
      approved: false,
      budgetFeasible: false,
      issues: ['Accommodation costs exceed allocation for Lisbon'],
      warnings: [],
      reasoning: 'Costs exceed budget by 8%.',
    },
  },
  latencyMs: 240,
  tokensUsed: 280,
};

export const VALIDATION_PASS_RESULT = {
  content: { scoring: { overallScore: 78 } },
  latencyMs: 180,
  tokensUsed: 200,
};

export const VALIDATION_FAIL_RESULT = {
  content: { scoring: { overallScore: 45 } },
  latencyMs: 160,
  tokensUsed: 190,
};
