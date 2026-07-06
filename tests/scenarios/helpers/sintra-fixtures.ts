import { withProposalContract } from './proposal-contract';
export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440001';

export const TRIP_CONTEXT =
  'Trip: Sintra, Portugal. Duration: 2 days. Participants: Alice (Culture & History), Bob (Relaxation & Wine). Budget: €300 total.';

export const ALICE_PROPOSAL = {
  agent: 'alice',
  round: 1,
  itinerary: [
    {
      day: 1,
      activities: [
        { time: '09:00', activity: 'Pena Palace', cost: 15, currency: 'EUR' },
        { time: '12:30', activity: 'Lunch at historic café', cost: 20, currency: 'EUR' },
        { time: '14:30', activity: 'Sintra walking heritage tour', cost: 8, currency: 'EUR' },
        { time: '19:00', activity: 'Traditional Portuguese dinner', cost: 30, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      activities: [
        { time: '09:30', activity: 'Sintra National Palace', cost: 10, currency: 'EUR' },
        { time: '12:00', activity: 'Lunch near palace', cost: 18, currency: 'EUR' },
        { time: '14:00', activity: 'Monserrate Palace gardens', cost: 8, currency: 'EUR' },
        { time: '18:00', activity: 'Cabo da Roca sunset viewpoint', cost: 0, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Focus on UNESCO World Heritage palaces and historic architecture.',
};

export const BOB_PROPOSAL = {
  agent: 'bob',
  round: 1,
  itinerary: [
    {
      day: 1,
      activities: [
        { time: '09:30', activity: 'Quinta da Regaleira gardens', cost: 10, currency: 'EUR' },
        { time: '12:00', activity: 'Wine tasting lunch at Colares winery', cost: 35, currency: 'EUR' },
        { time: '15:00', activity: 'Monserrate Palace scenic walk', cost: 8, currency: 'EUR' },
        { time: '19:30', activity: 'Wine pairing dinner at local quinta', cost: 40, currency: 'EUR' },
      ],
    },
    {
      day: 2,
      activities: [
        { time: '10:00', activity: 'Pena Palace (relaxed pace)', cost: 15, currency: 'EUR' },
        { time: '13:00', activity: 'Leisurely lunch with Colares wine', cost: 28, currency: 'EUR' },
        { time: '15:30', activity: 'Sintra hills scenic drive', cost: 0, currency: 'EUR' },
        { time: '18:00', activity: 'Sunset at Cabo da Roca', cost: 0, currency: 'EUR' },
      ],
    },
  ],
  notes: 'Prioritise relaxed pace, local wines, and scenic natural settings.',
};

// Anthropic mock response: low-conflict analysis (compatible preferences)
export const CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  consensusAreas: [
    { topic: 'location', agents: ['alice', 'bob'] },
    { topic: 'cultural_heritage', agents: ['alice', 'bob'] },
    { topic: 'natural_scenery', agents: ['alice', 'bob'] },
    { topic: 'budget', agents: ['alice', 'bob'] },
  ],
  overallConflictScore: 0.5,
  roundSummary:
    'Alice and Bob share strong compatibility in Sintra. Both appreciate cultural heritage sites and natural scenery. Alice emphasises history while Bob prefers a relaxed wine-focused pace — both desires are achievable simultaneously in Sintra.',
});

// Anthropic mock response: balanced compromise itinerary
export const COMPROMISE_RESPONSE = JSON.stringify(withProposalContract({
  itinerary: [
    {
      day: 1,
      activities: [
        {
          time: '09:00',
          activity: 'Pena Palace',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Iconic Romanticist palace — cultural highlight and scenic views.',
        },
        {
          time: '12:30',
          activity: 'Lunch at Seteais with local Colares wine',
          cost: 25,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Historic venue combining culture (Alice) and wine experience (Bob).',
        },
        {
          time: '14:30',
          activity: 'Quinta da Regaleira',
          cost: 10,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Mystical estate with esoteric architecture and beautiful gardens.',
        },
        {
          time: '19:00',
          activity: 'Wine tasting dinner at local quinta',
          cost: 35,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Traditional Portuguese cuisine with Colares wine pairing.',
        },
      ],
    },
    {
      day: 2,
      activities: [
        {
          time: '09:30',
          activity: 'Sintra National Palace',
          cost: 10,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Medieval royal palace in the historic town centre.',
        },
        {
          time: '12:00',
          activity: 'Traditional lunch near palace',
          cost: 20,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Local cuisine in heritage setting.',
        },
        {
          time: '14:00',
          activity: 'Monserrate Palace and gardens',
          cost: 8,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Romantic 19th-century palace with exotic gardens for a relaxed afternoon.',
        },
        {
          time: '18:00',
          activity: 'Cabo da Roca sunset',
          cost: 0,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Westernmost point of continental Europe — scenic and free.',
        },
      ],
    },
  ],
  compromiseRationale:
    'Both agents thrive in Sintra. Alice\'s cultural priorities (palaces, heritage) and Bob\'s preferences (wine, relaxed pace, scenic nature) are both well served. All sites are within walking distance or short drive.',
  satisfactionEstimates: { alice: 0.87, bob: 0.83 },
  unresolvedConflicts: [],
}));

// Used for error-path tests
export const NON_JSON_RESPONSE = 'Sorry, I cannot process this request at the moment.';

// High-conflict analysis response (for convergence loop test)
export const HIGH_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['alice', 'bob'],
      topic: 'pace',
      description: 'Alice wants fast-paced museum hopping; Bob wants slow wine tours.',
      severity: 4,
    },
  ],
  consensusAreas: [],
  overallConflictScore: 4.0,
  roundSummary: 'Significant pace conflict detected.',
});
