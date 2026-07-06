import type { WeatherForecast } from '../../../services/logistics-agent/src/services/WeatherService';
import type { TimingValidationResult } from '../../../services/logistics-agent/src/validators/TimingValidator';
import { withProposalContract } from './proposal-contract';

export const TRIP_ID = '550e8400-e29b-41d4-a716-446655440004';

export const TRIP_CONTEXT =
  'Trip: Sintra + Cascais, Portugal. Duration: 2 days. Day 1: Sintra. Day 2: Cascais. Participants: Alice (Culture & History), Bob (Relaxation & Wine), Carlos (Adventure & Outdoors), Diana (Gastronomy & Fine Dining). Budget: €600 total (4 people). Weather: 80% rain all day — both days.';

// Both days: heavy rain, 80%+ precipitation probability
export const RAINY_FORECASTS: WeatherForecast[] = [
  {
    region: 'Sintra',
    date: '2026-06-10',
    temperature: { min: 14, max: 18, unit: 'celsius' },
    conditions: 'Rain',
    humidity: 95,
    windSpeed: 25,
    description: 'heavy rain all day',
  },
  {
    region: 'Cascais',
    date: '2026-06-11',
    temperature: { min: 13, max: 17, unit: 'celsius' },
    conditions: 'Rain',
    humidity: 92,
    windSpeed: 28,
    description: 'heavy rain all day',
  },
];

export const MOCK_TIMING: TimingValidationResult = {
  valid: true,
  conflicts: [],
  warnings: [],
};

// Agent proposals — outdoor-heavy, will be flagged by WeatherAnalyzer

export const ALICE_PROPOSAL = {
  agent: 'alice',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:00', activity: 'Pena Palace exterior gardens tour', cost: 15, currency: 'EUR' },
        { time: '11:30', activity: 'Sintra National Palace heritage walk', cost: 10, currency: 'EUR' },
        { time: '14:00', activity: 'Moorish Castle ruins panoramic walk', cost: 8, currency: 'EUR' },
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
  notes: 'Focus on palaces, heritage architecture, and cultural walks.',
};

export const BOB_PROPOSAL = {
  agent: 'bob',
  round: 1,
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        { time: '09:30', activity: 'Quinta da Regaleira gardens walk', cost: 10, currency: 'EUR' },
        { time: '12:00', activity: 'Wine tasting lunch at Colares winery', cost: 35, currency: 'EUR' },
        { time: '15:00', activity: 'Monserrate Palace scenic garden stroll', cost: 8, currency: 'EUR' },
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
  notes: 'Relaxed pace, Colares wine, coastal scenery, and leisure.',
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

// WeatherAnalyzer output — heavy rain flags all exposed outdoor activities
export const WEATHER_ANALYSIS_RESPONSE = JSON.stringify({
  overallRisk: 'high',
  dayAssessments: [
    {
      day: 1,
      location: 'Sintra',
      weatherRisk: 'high',
      affectedActivities: [
        {
          activity: 'Sintra Natural Park trail — Pena to Moorish Castle',
          risk: 'high',
          reason: 'Heavy rain makes unsurfaced forest trails hazardous and impassable.',
        },
        {
          activity: 'Cabo da Roca cliff hike (westernmost point)',
          risk: 'high',
          reason: 'Exposed Atlantic cliff path is dangerous in rain and 25 km/h winds.',
        },
        {
          activity: 'Mountain bike tour through Sintra hills',
          risk: 'high',
          reason: 'Muddy terrain and slippery descents make cycling unsafe.',
        },
        {
          activity: 'Quinta da Regaleira gardens walk',
          risk: 'high',
          reason: 'Open gardens and grotto stairs become slippery and unpleasant in heavy rain.',
        },
        {
          activity: 'Monserrate Palace scenic garden stroll',
          risk: 'high',
          reason: 'Extensive open gardens with no shelter — unviable in all-day rain.',
        },
        {
          activity: 'Pena Palace exterior gardens tour',
          risk: 'high',
          reason: 'Exterior terraces and hillside paths exposed to rain and wind.',
        },
        {
          activity: 'Moorish Castle ruins panoramic walk',
          risk: 'high',
          reason: 'Open battlements and exposed ridgeline — dangerous in wet conditions.',
        },
      ],
      indoorAlternatives: [
        {
          replaces: 'Sintra Natural Park trail — Pena to Moorish Castle',
          alternative: 'Pena Palace interior tour (state rooms, chapel, royal apartments)',
          cost: 15,
          currency: 'EUR',
        },
        {
          replaces: 'Cabo da Roca cliff hike (westernmost point)',
          alternative: 'Sintra Museum of Natural History and Science',
          cost: 5,
          currency: 'EUR',
        },
        {
          replaces: 'Mountain bike tour through Sintra hills',
          alternative: 'Sintra ceramic arts and craft workshops',
          cost: 18,
          currency: 'EUR',
        },
        {
          replaces: 'Quinta da Regaleira gardens walk',
          alternative: 'Quinta da Regaleira mansion interior tour (esoteric décor, chapel)',
          cost: 10,
          currency: 'EUR',
        },
        {
          replaces: 'Monserrate Palace scenic garden stroll',
          alternative: 'Monserrate Palace interior tour (Neo-Moorish architecture)',
          cost: 8,
          currency: 'EUR',
        },
        {
          replaces: 'Pena Palace exterior gardens tour',
          alternative: 'Pena Palace interior tour (included with castle access)',
          cost: 0,
          currency: 'EUR',
        },
        {
          replaces: 'Moorish Castle ruins panoramic walk',
          alternative: 'Sintra National Palace interior (Sala dos Cisnes, azulejo panels)',
          cost: 10,
          currency: 'EUR',
        },
      ],
    },
    {
      day: 2,
      location: 'Cascais',
      weatherRisk: 'high',
      affectedActivities: [
        {
          activity: 'Guincho beach surfing lesson',
          risk: 'high',
          reason: 'Dangerous surf conditions and poor visibility in heavy rain — all water sports suspended.',
        },
        {
          activity: 'Cascais coastal cycling tour',
          risk: 'high',
          reason: 'Wet roads, poor visibility, and 28 km/h coastal winds make cycling unsafe.',
        },
        {
          activity: 'Sea kayaking at sunset',
          risk: 'high',
          reason: 'Heavy rain and elevated swell make sea kayaking unsafe.',
        },
        {
          activity: 'Cascais beach morning (relax)',
          risk: 'high',
          reason: 'Exposed beach unusable in all-day rain.',
        },
        {
          activity: 'Estoril coastal promenade walk',
          risk: 'high',
          reason: 'Exposed seafront promenade — unpleasant and cold in heavy rain.',
        },
      ],
      indoorAlternatives: [
        {
          replaces: 'Guincho beach surfing lesson',
          alternative: 'Cascais Municipal Museum (maritime history, local art)',
          cost: 4,
          currency: 'EUR',
        },
        {
          replaces: 'Cascais coastal cycling tour',
          alternative: 'Cascais Cultural Centre — rotating contemporary exhibition',
          cost: 3,
          currency: 'EUR',
        },
        {
          replaces: 'Sea kayaking at sunset',
          alternative: 'Traditional Portuguese cooking class — Cascais',
          cost: 35,
          currency: 'EUR',
        },
        {
          replaces: 'Cascais beach morning (relax)',
          alternative: 'Cascais wine bar and local tasting session',
          cost: 20,
          currency: 'EUR',
        },
        {
          replaces: 'Estoril coastal promenade walk',
          alternative: 'Estoril Casino (architecture tour + café)',
          cost: 0,
          currency: 'EUR',
        },
      ],
    },
  ],
  recommendations: [
    'Replace all outdoor and exposed activities with indoor cultural alternatives.',
    'Palace and museum interiors remain fully accessible and provide weather shelter.',
    'Covered food markets and indoor cooking classes satisfy culinary preferences.',
    'Wine tasting sessions move indoors at local cellars and wine bars.',
  ],
  summary:
    'Heavy rain throughout both days makes all outdoor and exposed activities high-risk. Every outdoor activity must be replaced with an indoor alternative. Indoor museums, palace interiors, cooking classes, and covered markets provide full-day coverage for all four participant profiles.',
});

// ConflictAnalyzer — round 1, weather forces outdoor_activity conflict
export const WEATHER_CONFLICT_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [
    {
      agents: ['carlos', 'alice', 'bob', 'diana'],
      topic: 'weather_constraint',
      description:
        'Heavy rain forecast (80% all day) renders all outdoor activities unsafe. Carlos\'s entire plan is outdoor-only and cannot proceed. All agents must pivot to indoor alternatives.',
      severity: 5,
    },
    {
      agents: ['carlos', 'alice'],
      topic: 'outdoor_activity',
      description:
        'Carlos proposes cliff hike, trail, surfing, kayaking — all unsafe in rain. Alice\'s palace exterior walks and castle ruins also become high-risk. Both must shift to indoor palace and museum interiors.',
      severity: 4,
    },
    {
      agents: ['bob', 'carlos'],
      topic: 'activity_type',
      description:
        'Bob\'s coastal beach and promenade leisure is incompatible with Carlos\'s adventure sports, and both are eliminated by weather. Bob can pivot to indoor wine tastings; Carlos has fewer suitable indoor alternatives.',
      severity: 3,
    },
  ],
  consensusAreas: [
    {
      topic: 'destination',
      description: 'All four agents accept Sintra and Cascais as destinations.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'indoor_pivot',
      description: 'All agents acknowledge weather forces an indoor-only programme.',
      agents: ['alice', 'bob', 'diana'],
    },
  ],
  overallConflictScore: 3.2,
  roundSummary:
    'Round 1 reveals that 80% rain eliminates all outdoor activities. Carlos\'s preference for high-intensity outdoor adventure is entirely blocked. Orchestrator must replace all outdoor slots with indoor palace interiors, museums, workshops, and covered culinary experiences. Carlos assigned adventure-adjacent indoor activities (climbing walls, workshop challenges) where possible.',
});

// ConflictAnalyzer — round 2, agents accept indoor programme
export const WEATHER_CONVERGENCE_ANALYSIS_RESPONSE = JSON.stringify({
  conflicts: [],
  consensusAreas: [
    {
      topic: 'destination',
      description: 'All four agents agree on Sintra + Cascais.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'indoor_programme',
      description: 'All agents accept weather-enforced indoor alternatives.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'palace_and_museum',
      description: 'All accept palace interiors and museums as the outdoor activity replacements.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
    {
      topic: 'culinary_experience',
      description: 'All agents accept cooking class and indoor market tasting on day 2.',
      agents: ['alice', 'bob', 'carlos', 'diana'],
    },
  ],
  overallConflictScore: 0.5,
  roundSummary:
    'Round 2 achieves convergence. All agents accept the indoor-only programme. Palace interiors, cultural workshops, cooking class, and indoor wine tasting satisfy all four profiles within the weather constraint.',
});

// CompromiseGenerator — indoor-only final itinerary
// Per-person: day1 (15+10+8+20) + day2 (4+22+35+30) = 53 + 91 = €144 per person
// 4 × €144 = €576 ≤ €600 ✓
// satisfactionEstimates all ≥ 0.60 ✓
// No outdoor keywords: trail, hike, surf, cycling, kayak, beach, cliff, outdoor ✓
export const INDOOR_COMPROMISE_RESPONSE = JSON.stringify(withProposalContract({
  itinerary: [
    {
      day: 1,
      destination: 'Sintra',
      activities: [
        {
          time: '09:30',
          activity: 'Pena Palace interior — royal apartments, chapel, and azulejo rooms',
          cost: 15,
          currency: 'EUR',
          satisfies: ['alice', 'carlos'],
          description:
            'Richly decorated palace interiors satisfy Alice\'s cultural interest; elevated castle structure gives Carlos the physical palace exploration he values.',
        },
        {
          time: '11:30',
          activity: 'Sintra National Palace interior — Sala dos Cisnes and Moorish tiles',
          cost: 10,
          currency: 'EUR',
          satisfies: ['alice', 'bob'],
          description:
            'Historic royal palace with extraordinary azulejo panels (Alice) in a relaxed indoor setting (Bob).',
        },
        {
          time: '13:30',
          activity: 'Sintra artisan food market — covered hall, local charcuterie and pastries',
          cost: 8,
          currency: 'EUR',
          satisfies: ['diana', 'bob', 'alice'],
          description:
            'Covered indoor market with artisan produce satisfies Diana\'s food focus, Bob\'s local flavour appreciation, and Alice\'s cultural curiosity.',
        },
        {
          time: '19:00',
          activity: 'Group dinner at Sintra local tavern — bacalhau à brás and house wine',
          cost: 20,
          currency: 'EUR',
          satisfies: ['alice', 'bob', 'diana'],
          description:
            'Traditional Portuguese speciality (Alice), local wine (Bob), authentic food culture (Diana).',
        },
      ],
    },
    {
      day: 2,
      destination: 'Cascais',
      activities: [
        {
          time: '09:30',
          activity: 'Cascais Municipal Museum — maritime history and local fine arts',
          cost: 4,
          currency: 'EUR',
          satisfies: ['alice', 'carlos'],
          description:
            'Cultural heritage site (Alice); exhibits on seafaring and Atlantic exploration give Carlos a sense of adventure context.',
        },
        {
          time: '11:30',
          activity: 'Cascais Cultural Centre — contemporary Portuguese art exhibition',
          cost: 3,
          currency: 'EUR',
          satisfies: ['alice', 'diana'],
          description:
            'Contemporary art (Alice) with curated exhibition exploring Portuguese gastronomy and culture (Diana).',
        },
        {
          time: '14:00',
          activity: 'Traditional Portuguese cooking class — cataplana and pastéis de nata',
          cost: 35,
          currency: 'EUR',
          satisfies: ['diana', 'alice', 'carlos'],
          description:
            'Hands-on culinary craft satisfies Diana\'s gastronomy focus and gives Carlos the physical engagement of a skill-based challenge.',
        },
        {
          time: '18:30',
          activity: 'Group dinner at Cascais wine bar — petiscos and Colares wine',
          cost: 30,
          currency: 'EUR',
          satisfies: ['bob', 'diana', 'alice'],
          description:
            'Portuguese small plates and wine tasting (Bob), quality local produce (Diana), relaxed cultural dining (Alice).',
        },
      ],
    },
  ],
  compromiseRationale:
    'Heavy rain eliminates all outdoor activities on both days. Palace and museum interiors fully replace the outdoor cultural programme for Alice. Bob\'s wine and leisure preferences shift to indoor wine tastings and relaxed tavern dinners. Carlos is given physically engaging indoor alternatives — palace exploration and a cooking class that requires active participation. Diana\'s gastronomy focus is preserved through a covered artisan market, hands-on cooking class, and quality local dinner. All four preferences represented across both days within the €600 group budget.',
  satisfactionEstimates: { alice: 0.71, bob: 0.65, carlos: 0.61, diana: 0.74 },
  unresolvedConflicts: [],
}));

export const NON_JSON_RESPONSE = 'Sorry, I cannot process this request at the moment.';
