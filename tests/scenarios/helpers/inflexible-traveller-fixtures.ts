export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440005';

export const TRIP_CONTEXT =
  'Trip: Sintra + Cascais, Portugal. Duration: 2 days. Day 1: Sintra. Day 2: Cascais. ' +
  'Participants: Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), ' +
  'Elena (Beach & Coastal — flexibility: low, single preference: beach activities only). ' +
  'Budget: €600 total (4 people). ' +
  'Hard constraint: Elena has flexibility=low and requires beach/coastal activities on both days.';

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
  notes: 'Maximum outdoor activity and physical challenge.',
};

export const ELENA_PROPOSAL = {
  agent: 'elena',
  round: 1,
  flexibility: 'low',
  preferences: ['beach', 'coastal'],
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:00', activity: 'Praia Grande beach morning', cost: 0, currency: 'EUR' },
        { time: '12:30', activity: 'Beachside lunch at Praia Grande café', cost: 18, currency: 'EUR' },
        { time: '14:30', activity: 'Coastal walk Praia Grande to Praia das Maçãs', cost: 0, currency: 'EUR' },
        { time: '19:00', activity: 'Seafood dinner at coastal restaurant', cost: 35, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '09:00', activity: 'Cascais beach morning', cost: 0, currency: 'EUR' },
        { time: '12:30', activity: 'Seafood lunch at Cascais harbour', cost: 28, currency: 'EUR' },
        { time: '14:30', activity: 'Guincho beach walk', cost: 0, currency: 'EUR' },
        { time: '18:30', activity: 'Sunset beach seafood dinner', cost: 35, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Beach and coastal activities only. Hard constraint. No indoor activities or inland sites.',
};

// Round 1 — Elena's hard constraint identified, high conflict with Alice/Carlos
export const HARD_CONSTRAINT_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['elena', 'alice'],
      topic: 'activity_type',
      description:
        'Elena requires beach/coastal activities exclusively (flexibility=low), conflicting with Alice\'s preference for inland palaces and museums',
      severity: 4,
    },
    {
      agents: ['elena', 'carlos'],
      topic: 'outdoor_type',
      description:
        'Elena\'s hard constraint for beach activities conflicts with Carlos\'s mountain trails and cycling preferences',
      severity: 3,
    },
    {
      agents: ['alice', 'carlos'],
      topic: 'pace',
      description: 'Alice\'s slow cultural pace conflicts with Carlos\'s high-energy outdoor activities',
      severity: 2,
    },
  ],
  hardConstraints: [
    {
      agent: 'elena',
      topic: 'beach_coastal',
      flexibility: 'low',
      description:
        'Elena has flexibility=low — beach and coastal activities are non-negotiable on both days',
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
  ],
  overallConflictScore: 3.2,
  roundSummary:
    'Elena\'s hard constraint (flexibility=low, beach-only) identified. Alice and Carlos proposals incompatible with this constraint. Group must adapt to coastal-centric itinerary.',
});

// Round 2 — others begin adapting, Elena's constraint acknowledged
export const ADAPTING_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['alice', 'carlos'],
      topic: 'activity_type',
      description: 'Remaining conflict: Alice wants more cultural sites, Carlos wants outdoor adventure',
      severity: 2,
    },
  ],
  hardConstraints: [
    {
      agent: 'elena',
      topic: 'beach_coastal',
      flexibility: 'low',
      description: 'Elena\'s beach constraint acknowledged and preserved in revised proposals',
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
    {
      topic: 'coastal_location',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
    {
      topic: 'beach_morning',
      agents: ['bob', 'carlos', 'elena'],
    },
  ],
  overallConflictScore: 1.4,
  roundSummary:
    'Hard constraint acknowledged. Alice and Carlos adapting to coastal focus. Minor activity-type conflict remains between Alice and Carlos.',
});

// Round 3 — full convergence
export const CONVERGENCE_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  hardConstraints: [
    {
      agent: 'elena',
      topic: 'beach_coastal',
      flexibility: 'low',
      description: 'Hard constraint fully satisfied in all adapted proposals',
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
    {
      topic: 'coastal_location',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
    {
      topic: 'beach_activities',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
    {
      topic: 'shared_meals',
      agents: ['alice', 'bob', 'carlos', 'elena'],
    },
  ],
  overallConflictScore: 0.6,
  roundSummary:
    'Full convergence achieved. Elena\'s hard constraint preserved. All agents adapted to coastal-centric itinerary with beach anchor activities each day.',
});

// Final compromise — Elena ≥0.90, others ≥0.65
// Per-person cost: day1=56, day2=83 → total=139 → 4 people=556 (≤600)
export const HARD_CONSTRAINT_COMPROMISE_RESPONSE = JSON.stringify({
  itinerary: [
    {
      day: 1,
      activities: [
        {
          time: '09:00',
          activity: 'Praia Grande beach morning (Elena\'s anchor)',
          cost: 0,
          currency: 'EUR',
          satisfies: ['elena', 'bob', 'carlos'],
        },
        {
          time: '11:30',
          activity: 'Coastal Moorish Castle view walk (culture + coastal)',
          cost: 8,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'elena'],
        },
        {
          time: '13:00',
          activity: 'Seafood lunch at beachside café',
          cost: 20,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
        {
          time: '15:00',
          activity: 'Cabo da Roca coastal cliff walk (adventure + coastal)',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'bob', 'elena'],
        },
        {
          time: '19:00',
          activity: 'Traditional seafood dinner at coastal village',
          cost: 28,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
      ],
    },
    {
      day: 2,
      activities: [
        {
          time: '09:00',
          activity: 'Cascais beach morning (Elena\'s anchor)',
          cost: 0,
          currency: 'EUR',
          satisfies: ['elena', 'bob'],
        },
        {
          time: '11:00',
          activity: 'Cascais Museum visit (coastal heritage)',
          cost: 5,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
        },
        {
          time: '13:00',
          activity: 'Harbour seafood lunch',
          cost: 25,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
        {
          time: '15:00',
          activity: 'Guincho beach coastal cycling',
          cost: 15,
          currency: 'EUR',
          satisfies: ['carlos', 'elena', 'bob'],
        },
        {
          time: '18:30',
          activity: 'Sunset beach seafood dinner at Cascais',
          cost: 38,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
      ],
    },
  ],
  satisfactionEstimates: {
    alice: 0.68,
    bob: 0.72,
    carlos: 0.66,
    elena: 0.92,
  },
  unresolvedConflicts: [],
  compromiseRationale:
    "Elena's hard constraint (flexibility=low, beach-only) preserved throughout. Beach activities anchor each day. Cultural elements (Moorish Castle view, Cascais Museum) added for Alice at coastal locations. Outdoor elements (coastal cliff walk, Guincho cycling) satisfy Carlos within coastal bounds. Bob's relaxed coastal pace respected. All other participants adapted to Elena's non-negotiable constraint.",
});

// ProposalRefiner response — returned after incorporating hard-constraint feedback
// Per-person cost: day1=48, day2=75 → total=123 → 4 people=492 (≤600)
export const REFINED_HARD_CONSTRAINT_RESPONSE = JSON.stringify({
  changesApplied: [
    "Elena's beach morning anchor preserved on both days",
    'Alice cultural elements moved to coastal locations only',
    'Carlos outdoor activities restricted to coastal/beach settings',
    "Evening seafood dinners added to satisfy Elena's coastal dining preference",
  ],
  itinerary: [
    {
      day: 1,
      activities: [
        {
          time: '09:00',
          activity: 'Praia Grande beach morning',
          cost: 0,
          currency: 'EUR',
          satisfies: ['elena', 'bob'],
        },
        {
          time: '13:00',
          activity: 'Coastal seafood lunch',
          cost: 20,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
        {
          time: '15:00',
          activity: 'Cabo da Roca cliff walk',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'elena'],
        },
        {
          time: '19:00',
          activity: 'Seafood dinner at coastal restaurant',
          cost: 28,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
      ],
    },
    {
      day: 2,
      activities: [
        {
          time: '09:00',
          activity: 'Cascais beach morning',
          cost: 0,
          currency: 'EUR',
          satisfies: ['elena', 'bob'],
        },
        {
          time: '13:00',
          activity: 'Harbour seafood lunch',
          cost: 25,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
        {
          time: '15:00',
          activity: 'Guincho coastal cycling',
          cost: 15,
          currency: 'EUR',
          satisfies: ['carlos', 'elena'],
        },
        {
          time: '19:00',
          activity: 'Sunset beach dinner',
          cost: 35,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'carlos', 'elena'],
        },
      ],
    },
  ],
  satisfactionEstimates: {
    alice: 0.65,
    bob: 0.70,
    carlos: 0.65,
    elena: 0.91,
  },
  unresolvedConflicts: [],
  compromiseRationale:
    "Refined per feedback: Elena's beach hard constraint is non-negotiable. All activities grounded in coastal context. Refinement preserves Elena's ≥90% satisfaction while maintaining group adaptation.",
});

export const NON_JSON_RESPONSE = 'I cannot process this request in JSON format';
