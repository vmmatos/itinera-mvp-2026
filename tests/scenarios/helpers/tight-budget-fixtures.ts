import type { ItineraryDay } from '../../../services/finance-agent/src/agents/CostCalculator';

export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440003';

export const TRIP_CONTEXT =
  'Trip: Sintra + Cascais, Portugal. Duration: 2 days. Day 1: Sintra. Day 2: Cascais. Participants: Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining). Budget: €300 total (4 people) — 50% of normal.';

// ItineraryDay[] format consumed by CostCalculator
// grandTotal = 100+80+20 + 90+70+20 = 380 > 300
export const OVER_BUDGET_ITINERARY: ItineraryDay[] = [
  {
    day: 1,
    activities: [
      { name: 'Pena Palace + Quinta da Regaleira', cost: 60, currency: 'EUR' },
      { name: 'Mountain bike tour through Sintra hills', cost: 25, currency: 'EUR' },
      { name: 'Lawrence\'s Hotel fine dining lunch', cost: 15, currency: 'EUR' },
    ],
    meals: [
      { name: 'Gourmet dinner — tasting menu at local quinta', cost: 80, currency: 'EUR' },
    ],
    transport: [
      { from: 'Lisbon', to: 'Sintra', cost: 20, currency: 'EUR' },
    ],
  },
  {
    day: 2,
    activities: [
      { name: 'Guincho beach surfing lesson', cost: 45, currency: 'EUR' },
      { name: 'Traditional Portuguese cooking class', cost: 30, currency: 'EUR' },
      { name: 'Cascais Museum & Palace', cost: 15, currency: 'EUR' },
    ],
    meals: [
      { name: 'Premium seafood dinner — Cascais harbour', cost: 70, currency: 'EUR' },
    ],
    transport: [
      { from: 'Sintra', to: 'Cascais', cost: 20, currency: 'EUR' },
    ],
  },
];

// grandTotal = 50+60+15 + 40+50+15 = 230 ≤ 300
export const WITHIN_BUDGET_ITINERARY: ItineraryDay[] = [
  {
    day: 1,
    activities: [
      { name: 'Moorish Castle ruins (self-guided)', cost: 8, currency: 'EUR' },
      { name: 'Sintra Natural Park trail', cost: 0, currency: 'EUR' },
      { name: 'Sintra town heritage walking tour', cost: 12, currency: 'EUR' },
      { name: 'Colares wine tasting (small producer)', cost: 10, currency: 'EUR' },
      { name: 'Artisan food market stroll', cost: 20, currency: 'EUR' },
    ],
    meals: [
      { name: 'Picnic lunch in Sintra palace gardens', cost: 15, currency: 'EUR' },
      { name: 'Group dinner at local tavern', cost: 45, currency: 'EUR' },
    ],
    transport: [
      { from: 'Lisbon', to: 'Sintra', cost: 15, currency: 'EUR' },
    ],
  },
  {
    day: 2,
    activities: [
      { name: 'Guincho beach coastal walk', cost: 0, currency: 'EUR' },
      { name: 'Cascais Museum', cost: 5, currency: 'EUR' },
      { name: 'Cascais seafront promenade', cost: 0, currency: 'EUR' },
      { name: 'Fresh fish market tasting', cost: 15, currency: 'EUR' },
      { name: 'Cascais historic centre walk', cost: 20, currency: 'EUR' },
    ],
    meals: [
      { name: 'Lunch at Cascais fish market', cost: 14, currency: 'EUR' },
      { name: 'Group dinner at harbour tavern', cost: 36, currency: 'EUR' },
    ],
    transport: [
      { from: 'Sintra', to: 'Cascais', cost: 15, currency: 'EUR' },
    ],
  },
];

// Scenario-level proposals (same flat format as 001/002 fixtures)
export const ALICE_PROPOSAL = {
  agent: 'alice',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:00', activity: 'Pena Palace', cost: 15, currency: 'EUR' },
        { time: '12:30', activity: 'Lunch at historic café near palace', cost: 20, currency: 'EUR' },
        { time: '14:30', activity: 'Sintra National Palace & heritage walking tour', cost: 10, currency: 'EUR' },
        { time: '19:00', activity: 'Traditional Portuguese dinner in Sintra town', cost: 28, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '09:30', activity: 'Cascais Museum', cost: 5, currency: 'EUR' },
        { time: '12:00', activity: 'Lunch near waterfront', cost: 18, currency: 'EUR' },
        { time: '14:00', activity: 'Condes de Castro Guimarães Palace', cost: 5, currency: 'EUR' },
        { time: '18:30', activity: 'Traditional dinner in Cascais old town', cost: 25, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Focus on UNESCO palaces, heritage architecture, and cultural walking tours.',
};

export const BOB_PROPOSAL = {
  agent: 'bob',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:30', activity: 'Quinta da Regaleira gardens (relaxed pace)', cost: 10, currency: 'EUR' },
        { time: '12:00', activity: 'Wine tasting lunch at Colares winery', cost: 35, currency: 'EUR' },
        { time: '15:00', activity: 'Monserrate Palace scenic garden walk', cost: 8, currency: 'EUR' },
        { time: '19:30', activity: 'Wine pairing dinner at local quinta', cost: 40, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '10:00', activity: 'Cascais beach morning (relax)', cost: 0, currency: 'EUR' },
        { time: '13:00', activity: 'Seafood lunch by the harbour', cost: 32, currency: 'EUR' },
        { time: '15:30', activity: 'Estoril coastal promenade walk', cost: 0, currency: 'EUR' },
        { time: '19:00', activity: 'Wine dinner at Cascais restaurant', cost: 42, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Prioritise relaxed pace, Colares wine, coastal scenery, and leisure.',
};

export const CARLOS_PROPOSAL = {
  agent: 'carlos',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '07:30', activity: 'Sintra Natural Park trail — Pena to Moorish Castle', cost: 0, currency: 'EUR' },
        { time: '11:00', activity: 'Trail snack at outdoor picnic area', cost: 12, currency: 'EUR' },
        { time: '13:00', activity: 'Cabo da Roca cliff hike (westernmost point)', cost: 0, currency: 'EUR' },
        { time: '17:00', activity: 'Mountain bike tour through Sintra hills', cost: 25, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '08:00', activity: 'Guincho beach surfing lesson', cost: 45, currency: 'EUR' },
        { time: '12:00', activity: 'Beachside post-surf lunch', cost: 18, currency: 'EUR' },
        { time: '14:00', activity: 'Cascais coastal cycling tour', cost: 20, currency: 'EUR' },
        { time: '17:00', activity: 'Sea kayaking at sunset', cost: 30, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Maximum outdoor activity and physical challenge. No museums, no fine dining.',
};

export const DIANA_PROPOSAL = {
  agent: 'diana',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '10:00', activity: 'Sintra artisan food market tour', cost: 15, currency: 'EUR' },
        { time: '13:00', activity: "Fine dining lunch at Lawrence's Hotel (historic)", cost: 60, currency: 'EUR' },
        { time: '15:30', activity: 'Portuguese pastry and wine tasting session', cost: 22, currency: 'EUR' },
        { time: '20:00', activity: 'Gourmet dinner — tasting menu with wine pairing', cost: 85, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '10:30', activity: 'Traditional Portuguese cooking class', cost: 55, currency: 'EUR' },
        { time: '13:30', activity: 'Gourmet lunch at cooking class restaurant', cost: 45, currency: 'EUR' },
        { time: '16:00', activity: 'Cascais fresh seafood market tasting', cost: 30, currency: 'EUR' },
        { time: '20:00', activity: 'Premium seafood dinner — Cascais harbour', cost: 80, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Every meal must be exceptional. Michelin quality or local artisan producers only.',
};

// Budget conflict analysis — round 1, budget_allocation is primary conflict
export const BUDGET_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['diana', 'carlos'],
      topic: 'budget_allocation',
      description:
        'Diana allocates €182/person/day on dining alone; Carlos adds €70/day in paid activities. Combined spend per person (€276/day) is 3.7× the €75/day tight budget cap.',
      severity: 5,
    },
    {
      agents: ['bob', 'diana'],
      topic: 'activity_type',
      description:
        'Bob wants relaxed wine leisure; Diana wants premium gastronomy. Both are high-cost preferences incompatible with €300 group cap.',
      severity: 4,
    },
    {
      agents: ['alice', 'carlos'],
      topic: 'activity_pace',
      description:
        'Alice prefers slow cultural immersion; Carlos demands high-intensity outdoor schedule from early morning.',
      severity: 3,
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      description: 'All four agents accept Sintra and Cascais as destinations.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
  ],
  overallConflictScore: 2.8,
  roundSummary:
    'Round 1 reveals extreme budget pressure. Diana and Carlos proposals alone exceed the €300 group cap. Orchestrator must enforce substitutions: replace premium dining with quality local alternatives, reduce paid activities to free/low-cost options.',
});

// Budget convergence — round 3, agents accept budget constraints
export const BUDGET_CONVERGENCE_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  consensusAreas: [
    {
      topic: 'destination',
      description: 'All four agents agree on Sintra + Cascais.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'budget_constraint',
      description: 'All agents accept €75/person total cap after orchestrator enforces substitutions.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'outdoor_activity',
      description: 'All accept free/low-cost outdoor slots (trails, beach walks).',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'shared_meals',
      description: 'All agents accept quality local dining within budget.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
  ],
  overallConflictScore: 0.6,
  roundSummary:
    'Round 3 achieves convergence under tight budget. Free outdoor activities (trails, beach) + quality local dining replaces premium options. All four preferences represented within €300 group cap.',
});

// Budget-constrained compromise
// Per-person: day1 (8+0+12+15) + day2 (0+14+0+20) = 35 + 34 = €69
// 4 × €69 = €276 ≤ €300 ✓
// satisfactionEstimates all ≥ 0.60 ✓
export const BUDGET_CONSTRAINED_COMPROMISE_RESPONSE = JSON.stringify({
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        {
          time: '09:00',
          activity: 'Moorish Castle ruins and panoramic viewpoint',
          cost: 8,
          currency: 'EUR',
          satisfies: ['alice', 'carlos'],
          description: 'Historic castle (Alice) + elevated outdoor terrain (Carlos). Low cost, high cultural value.',
        },
        {
          time: '11:30',
          activity: 'Sintra Natural Park trail to Pena viewpoint',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'bob'],
          description: 'Active forest trail (Carlos) + scenic nature walk (Bob). Free.',
        },
        {
          time: '13:00',
          activity: 'Picnic lunch with local bread, cheese, and Colares wine',
          cost: 12,
          currency: 'EUR',
          satisfies: ['bob', 'diana', 'alice'],
          description: 'Wine experience (Bob), artisan local produce (Diana), relaxed heritage setting (Alice).',
        },
        {
          time: '19:00',
          activity: 'Group dinner at Sintra local tavern — bacalhau and house wine',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'diana'],
          description: 'Traditional Portuguese cuisine (Alice), local wine (Bob), authentic food culture (Diana).',
        },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        {
          time: '09:00',
          activity: 'Guincho beach coastal walk and Atlantic swim',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'bob'],
          description: 'High-energy coastal activity (Carlos) + scenic beach leisure (Bob). Free.',
        },
        {
          time: '12:00',
          activity: 'Cascais fish market lunch — grilled sardines and petiscos',
          cost: 14,
          currency: 'EUR',
          satisfies: ['diana', 'bob'],
          description: 'Fresh Atlantic seafood at market price (Diana) + casual harbour atmosphere (Bob).',
        },
        {
          time: '14:30',
          activity: 'Cascais town heritage walk and seafront promenade',
          cost: 0,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Historic town centre and architecture (Alice) + relaxed seaside stroll (Bob). Free.',
        },
        {
          time: '18:30',
          activity: 'Group dinner at Cascais harbour restaurant — seafood cataplana',
          cost: 20,
          currency: 'EUR',
          satisfies: ['diana', 'alice', 'bob'],
          description: 'Regional speciality dish (Diana), cultural dining setting (Alice), coastal atmosphere (Bob).',
        },
      ],
    },
  ],
  compromiseRationale:
    'Tight budget enforced by replacing premium dining with high-quality local taverns and market meals. Free outdoor activities (Sintra trails, Guincho beach walk) satisfy Carlos while keeping costs zero. Colares wine picnic and cataplana dinner maintain culinary experience for Diana and Bob within budget. Alice satisfied by Moorish Castle and heritage walks. All four preferences present across both days at €69/person total.',
  satisfactionEstimates: { alice: 0.66, bob: 0.63, carlos: 0.68, diana: 0.62 },
  unresolvedConflicts: [],
});

// Claude response for AlternativeFinder when proposals exceed €300
export const BUDGET_ALTERNATIVES_RESPONSE = JSON.stringify({
  substitutions: [
    {
      original: "Lawrence's Hotel fine dining lunch — €60/person",
      alternative: 'Picnic lunch with local produce and Colares wine — €12/person',
      saving: 48,
      rationale: 'Maintains artisan food experience (Diana) and wine element (Bob) at 20% of original cost.',
    },
    {
      original: 'Gourmet tasting menu dinner — €85/person',
      alternative: 'Group dinner at local tavern — bacalhau and house wine — €15/person',
      saving: 70,
      rationale: 'Traditional Portuguese cuisine satisfies cultural interest (Alice) and food authenticity (Diana).',
    },
    {
      original: 'Guincho beach surfing lesson — €45/person',
      alternative: 'Guincho beach coastal walk and swim — €0',
      saving: 45,
      rationale: 'Retains Atlantic coastal energy for Carlos at zero cost.',
    },
    {
      original: 'Premium seafood dinner Cascais harbour — €80/person',
      alternative: 'Seafood cataplana at harbour restaurant — €20/person',
      saving: 60,
      rationale: 'Regional speciality at local price. Same seafood experience, no premium markup.',
    },
  ],
  revisedTotal: 230,
  currency: 'EUR',
  note: 'Substituting premium dining and paid outdoor lessons with quality local alternatives and free coastal activities reduces total spend from €380 to €230, within the €300 group budget.',
});

// Used for error-path tests
export const NON_JSON_RESPONSE = 'Sorry, I cannot process this request at the moment.';
