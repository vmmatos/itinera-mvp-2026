export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440002';

export const TRIP_CONTEXT =
  'Trip: Sintra + Cascais, Portugal. Duration: 2 days. Day 1: Sintra. Day 2: Cascais. Participants: Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining). Budget: €600 total (4 people).';

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
        { time: '13:00', activity: 'Fine dining lunch at Lawrence\'s Hotel (historic)', cost: 60, currency: 'EUR' },
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

// High-conflict analysis — round 1, 4 agents with opposing preferences
export const HIGH_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['carlos', 'diana'],
      topic: 'activity_pace',
      description:
        'Carlos demands high-intensity outdoor activities all day; Diana requires long, leisurely meals and slow-paced experiences.',
      severity: 5,
    },
    {
      agents: ['alice', 'carlos'],
      topic: 'activity_type',
      description:
        'Alice prioritises indoor cultural heritage (palaces, museums); Carlos rejects all indoor and cultural activities in favour of outdoor adventure.',
      severity: 4,
    },
    {
      agents: ['bob', 'carlos'],
      topic: 'energy_level',
      description:
        'Bob wants relaxed coastal leisure and wine tasting; Carlos wants high-energy surfing, hiking, and cycling.',
      severity: 4,
    },
    {
      agents: ['diana', 'alice'],
      topic: 'budget_allocation',
      description:
        'Diana allocates over €200 per person per day on fine dining alone, far exceeding Alice\'s cultural activity budget.',
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
  overallConflictScore: 3.8,
  roundSummary:
    'Round 1 reveals deep divergence across all preference dimensions. Carlos and Diana are especially incompatible on pace. Budget spread is extreme. Significant compromise required.',
});

// Mid-level conflict — round 2, some convergence after first refinement
export const MID_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['carlos', 'diana'],
      topic: 'activity_pace',
      description: 'Pace conflict persists but reduced — Carlos accepted one cultural morning slot.',
      severity: 3,
    },
    {
      agents: ['diana', 'alice'],
      topic: 'budget_allocation',
      description: 'Diana reduced dinner budget but still exceeds group average.',
      severity: 2,
    },
  ],
  consensusAreas: [
    { topic: 'destination', description: 'All agree on Sintra + Cascais.', agents: ['alice', 'bob', 'carlos', 'diana'] },
    { topic: 'cultural_heritage', description: 'Alice, Bob, and Diana accept at least one heritage site.', agents: ['alice', 'bob', 'diana'] },
  ],
  overallConflictScore: 1.8,
  roundSummary:
    'Round 2 shows measurable improvement. Pace and budget conflicts remain but severity reduced. One more round should reach convergence.',
});

// Convergence analysis — round 3, below threshold
export const CONVERGENCE_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  consensusAreas: [
    { topic: 'destination', description: 'All four agents agree on Sintra + Cascais.', agents: ['alice', 'bob', 'carlos', 'diana'] },
    { topic: 'cultural_activity', description: 'All accept one cultural slot per day.', agents: ['alice', 'bob', 'carlos', 'diana'] },
    { topic: 'outdoor_activity', description: 'All accept one outdoor/active slot per day.', agents: ['alice', 'bob', 'carlos', 'diana'] },
    { topic: 'shared_meals', description: 'All agents accept shared group meals as primary dining.', agents: ['alice', 'bob', 'carlos', 'diana'] },
  ],
  overallConflictScore: 0.7,
  roundSummary:
    'Round 3 achieves convergence. Mixed-format days (cultural morning + outdoor afternoon + shared dinner) satisfy all profiles within budget.',
});

// Balanced compromise — addresses all 4 profiles, budget ≤ €600 for 4 people
// Per-person cost: day1 (15+18+0+30) + day2 (0+25+5+40) = 63 + 70 = 133 × 4 = €532 ≤ €600 ✓
export const COMPROMISE_RESPONSE = JSON.stringify({
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        {
          time: '09:00',
          activity: 'Pena Palace',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description: 'Iconic Romanticist palace — cultural highlight with panoramic Sintra views.',
        },
        {
          time: '12:30',
          activity: 'Lunch at Seteais with Colares wine',
          cost: 18,
          currency: 'EUR',
          satisfies: ['bob', 'diana', 'alice'],
          description: 'Historic venue combining wine experience (Bob), quality food (Diana), and heritage setting (Alice).',
        },
        {
          time: '14:30',
          activity: 'Sintra Natural Park trail to Moorish Castle',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'bob'],
          description: 'Accessible outdoor trail through forest — active (Carlos) and scenic (Bob).',
        },
        {
          time: '19:00',
          activity: 'Group dinner at local quinta — Portuguese cuisine with Colares wine',
          cost: 30,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'diana'],
          description: 'Traditional setting (Alice), wine pairing (Bob), quality food artistry (Diana).',
        },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        {
          time: '09:00',
          activity: 'Guincho beach coastal walk and swim',
          cost: 0,
          currency: 'EUR',
          satisfies: ['carlos', 'bob'],
          description: 'Atlantic coastal activity — energising (Carlos) and scenic beach leisure (Bob).',
        },
        {
          time: '12:00',
          activity: 'Cascais harbour seafood lunch',
          cost: 25,
          currency: 'EUR',
          satisfies: ['diana', 'bob'],
          description: 'Fresh Atlantic seafood — quality dining (Diana) and relaxed harbour setting (Bob).',
        },
        {
          time: '14:00',
          activity: 'Cascais Museum and Condes de Castro Guimarães Palace',
          cost: 5,
          currency: 'EUR',
          satisfies: ['alice'],
          description: 'Local heritage and fine arts — cultural afternoon (Alice).',
        },
        {
          time: '18:30',
          activity: 'Sunset dinner at Cascais seafront restaurant',
          cost: 40,
          currency: 'EUR',
          satisfies: ['diana', 'alice', 'bob'],
          description: 'Quality seafood tasting menu (Diana), cultural setting (Alice), relaxed coastal atmosphere (Bob).',
        },
      ],
    },
  ],
  compromiseRationale:
    'Mixed-format days alternate cultural morning (Alice), outdoor afternoon (Carlos), and quality shared meals (Diana, Bob). Sintra delivers heritage + nature; Cascais delivers coast + seafood gastronomy. All four preferences represented across each day.',
  satisfactionEstimates: { alice: 0.72, bob: 0.75, carlos: 0.68, diana: 0.71 },
  unresolvedConflicts: [],
});

// Used for error-path tests
export const NON_JSON_RESPONSE = 'Sorry, I cannot process this request at the moment.';
