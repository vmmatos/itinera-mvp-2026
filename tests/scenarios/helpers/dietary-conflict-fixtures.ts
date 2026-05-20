export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440006';

export const TRIP_CONTEXT =
  'Trip: Sintra + Cascais, Portugal. Duration: 2 days. Day 1: Sintra. Day 2: Cascais. ' +
  'Participants: Alice (Culture & History — dietary: vegan, flexibility: none), ' +
  'Diana (Gastronomy & Fine Dining — non-vegan). ' +
  'Budget: €400 total (2 people). ' +
  'Dietary constraint: Alice is vegan — all meals must offer a fully plant-based option. ' +
  'Logistics confirmed: vegan-friendly restaurants available in both Sintra and Cascais regions.';

export const ALICE_PROPOSAL = {
  agent: 'alice',
  round: 1,
  dietary: { restriction: 'vegan', flexibility: 'none' },
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:00', activity: 'Pena Palace interior tour', cost: 15, currency: 'EUR' },
        {
          time: '12:30',
          activity: 'Vegan lunch at A Piriquita — pastéis de nata veganos + seasonal salad',
          cost: 18,
          currency: 'EUR',
        },
        { time: '14:30', activity: 'Sintra National Palace heritage walking tour', cost: 10, currency: 'EUR' },
        {
          time: '19:00',
          activity: 'Dinner at Tascantiga — vegan-friendly traditional Portuguese cuisine',
          cost: 25,
          currency: 'EUR',
        },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        { time: '09:30', activity: 'Museum of the Sea & Condes de Castro Guimarães Palace', cost: 5, currency: 'EUR' },
        {
          time: '12:00',
          activity: 'Vegan lunch at Cascais Natura Café',
          cost: 18,
          currency: 'EUR',
        },
        { time: '14:00', activity: 'Cascais old town heritage walk', cost: 0, currency: 'EUR' },
        {
          time: '19:00',
          activity: 'Dinner at O Cantinho do Mar — vegan dishes confirmed available',
          cost: 22,
          currency: 'EUR',
        },
      ],
    },
  ],
  notes: 'All meals must be fully vegan. Cultural heritage activities preferred throughout.',
};

export const DIANA_PROPOSAL = {
  agent: 'diana',
  round: 1,
  dietary: { restriction: 'none', flexibility: 'high' },
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '10:00', activity: 'Sintra artisan food market tour — local charcuterie & cheese', cost: 15, currency: 'EUR' },
        {
          time: '13:00',
          activity: "Fine dining lunch at Lawrence's Hotel — 5-course tasting menu (non-vegan)",
          cost: 55,
          currency: 'EUR',
        },
        { time: '15:30', activity: 'Portuguese pastry & cheese tasting at Piriquita', cost: 20, currency: 'EUR' },
        {
          time: '20:00',
          activity: 'Gourmet dinner — duck cataplana with Colares wine pairing',
          cost: 70,
          currency: 'EUR',
        },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        {
          time: '10:30',
          activity: 'Cascais fresh fish market — private tasting tour',
          cost: 30,
          currency: 'EUR',
        },
        {
          time: '13:30',
          activity: 'Premium seafood lunch — grilled sea bass at harbour restaurant',
          cost: 45,
          currency: 'EUR',
        },
        { time: '16:30', activity: 'Cascais wine cave tasting session', cost: 25, currency: 'EUR' },
        {
          time: '20:00',
          activity: 'Fine dining dinner — Cascais seafront tasting menu with lobster bisque',
          cost: 75,
          currency: 'EUR',
        },
      ],
    },
  ],
  notes: 'Every meal exceptional — Michelin-adjacent quality, local fine produce. No dietary restrictions.',
};

// Round 1 — Alice's vegan constraint surfaces as hard constraint, high conflict with Diana
export const DIETARY_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['alice', 'diana'],
      topic: 'meal_incompatibility',
      description:
        "Alice requires all meals to be fully vegan (flexibility=none). Diana's proposals include non-vegan tasting menus, duck cataplana, lobster bisque, and cheese — none of which are vegan. Shared dining requires venues offering both upscale non-vegan and fully vegan menus.",
      severity: 4,
    },
    {
      agents: ['alice', 'diana'],
      topic: 'budget_allocation',
      description:
        "Diana's proposals (€160/person day 1, €175/person day 2) exceed the €200/person implied by the €400 total budget for 2 people.",
      severity: 3,
    },
    {
      agents: ['alice', 'diana'],
      topic: 'activity_type',
      description:
        'Alice prefers cultural heritage sites and walking tours; Diana prefers food markets, private tastings, and culinary experiences. Moderate conflict on activity focus.',
      severity: 2,
    },
  ],
  hardConstraints: [
    {
      agent: 'alice',
      topic: 'dietary_vegan',
      flexibility: 'none',
      description:
        'Alice is vegan — all meals must offer at least one fully plant-based option. Non-negotiable. Logistics has confirmed vegan-friendly restaurants exist in both Sintra and Cascais.',
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      agents: ['alice', 'diana'],
    },
  ],
  overallConflictScore: 2.8,
  roundSummary:
    "Round 1: Alice's vegan constraint (flexibility=none) is a hard constraint requiring vegan options at every meal slot. Diana's budget expectations exceed the group cap. Activity type conflict is moderate. Logistics data confirms vegan-friendly venues exist in both regions — orchestrator must select shared dining venues that serve both upscale non-vegan and fully plant-based dishes.",
});

// Round 2 — budget resolved, meal_incompatibility reduced, vegan constraint acknowledged
export const ADAPTING_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['alice', 'diana'],
      topic: 'meal_incompatibility',
      description:
        "Shared restaurant selection in progress — venues that satisfy Diana's fine dining standard and Alice's vegan requirement. Logistics confirms suitable venues available.",
      severity: 2,
    },
  ],
  hardConstraints: [
    {
      agent: 'alice',
      topic: 'dietary_vegan',
      flexibility: 'none',
      description:
        "Alice's vegan constraint acknowledged and preserved. Budget-adjusted proposals maintain vegan meal options at each slot.",
    },
  ],
  consensusAreas: [
    { topic: 'destination', agents: ['alice', 'diana'] },
    { topic: 'cultural_morning', agents: ['alice', 'diana'] },
    { topic: 'budget_compliance', agents: ['alice', 'diana'] },
  ],
  overallConflictScore: 1.2,
  roundSummary:
    "Round 2: Budget conflict resolved. Alice's vegan constraint preserved. Remaining conflict is restaurant selection — logistics confirms shared venues offering fine dining and vegan menus are achievable in both regions.",
});

// Round 3 — full convergence, meals validated
export const CONVERGENCE_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  hardConstraints: [
    {
      agent: 'alice',
      topic: 'dietary_vegan',
      flexibility: 'none',
      description:
        "Alice's vegan constraint fully satisfied — all meal slots at logistics-confirmed vegan-friendly venues.",
    },
  ],
  consensusAreas: [
    { topic: 'destination', agents: ['alice', 'diana'] },
    { topic: 'shared_dining_venues', agents: ['alice', 'diana'] },
    { topic: 'cultural_heritage', agents: ['alice', 'diana'] },
    { topic: 'culinary_experience', agents: ['alice', 'diana'] },
    { topic: 'budget_compliance', agents: ['alice', 'diana'] },
  ],
  overallConflictScore: 0.5,
  roundSummary:
    'Full convergence. Logistics validated: vegan-friendly fine dining venues confirmed in Sintra (Tascantiga, A Piriquita) and Cascais (O Cantinho do Mar, Caseiro). Alice\'s vegan constraint met at every meal. Diana\'s fine dining standard preserved via shared venues offering both vegan and non-vegan dishes. Budget ≤ €400 total.',
});

// Final compromise — mealsValidated: true, alice ≥ 0.80, diana ≥ 0.75
// Per-person costs: day1 = 15+22+0+28 = 65, day2 = 5+25+15+30 = 75 → total = 140
// 2 people × 140 = 280 ≤ 400 ✓
export const DIETARY_COMPROMISE_RESPONSE = JSON.stringify({
  itinerary: [
    {
      day: 1,
      activities: [
        {
          time: '09:00',
          activity: 'Pena Palace interior tour (cultural — shared)',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
        },
        {
          time: '12:30',
          activity: 'Shared lunch at Tascantiga — vegan-friendly traditional Portuguese (vegan option confirmed by logistics)',
          cost: 22,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
          dietaryNote: 'vegan_option_available',
        },
        {
          time: '14:30',
          activity: 'Sintra artisan food market tour (gastronomy meets cultural heritage)',
          cost: 0,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
        },
        {
          time: '19:00',
          activity: 'Dinner at Loja das Conservas Sintra — quality Portuguese, vegan dishes available (logistics validated)',
          cost: 28,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
          dietaryNote: 'vegan_option_available',
        },
      ],
    },
    {
      day: 2,
      activities: [
        {
          time: '09:30',
          activity: 'Museum of the Sea + Condes de Castro Guimarães Palace (cultural — shared)',
          cost: 5,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
        },
        {
          time: '12:30',
          activity: 'Shared lunch at O Cantinho do Mar — seafood for Diana, vegan dishes for Alice (logistics confirmed)',
          cost: 25,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
          dietaryNote: 'vegan_option_available',
        },
        {
          time: '15:00',
          activity: 'Cascais harbour walk + Cascais wine cave tasting (wine is vegan)',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
        },
        {
          time: '19:30',
          activity: 'Dinner at Caseiro Cascais — local fine dining, vegan menu available (logistics validated)',
          cost: 30,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
          dietaryNote: 'vegan_option_available',
        },
      ],
    },
  ],
  satisfactionEstimates: {
    alice: 0.82,
    diana: 0.78,
  },
  unresolvedConflicts: [],
  mealsValidated: true,
  compromiseRationale:
    "Alice's vegan constraint (flexibility=none) fully respected — all four meal slots at logistics-confirmed vegan-friendly venues. Diana's fine dining quality preserved: shared venues serve both upscale non-vegan dishes (seafood, quality Portuguese) and fully vegan alternatives. Budget: 2 × €140 = €280 ≤ €400. Day 1 in Sintra: Pena Palace (cultural), shared vegan-friendly lunch, artisan market (gastronomy+culture), quality shared dinner. Day 2 in Cascais: coastal museum heritage, shared seafood/vegan lunch, harbour+wine tasting, shared fine dining dinner.",
});

export const NON_JSON_RESPONSE = 'I cannot process this request in JSON format';
