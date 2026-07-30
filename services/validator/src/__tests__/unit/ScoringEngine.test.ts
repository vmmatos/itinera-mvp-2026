import { describe, it, expect } from 'vitest';
import { ScoringEngine } from '@/validators/ScoringEngine';
import type { TravellerPreference } from '@/validators/ScoringEngine';

const engine = new ScoringEngine();

const makeProposal = (categories: string[]): Record<string, unknown> => ({
  itinerary: [
    {
      day: 1,
      activities: categories.map((category) => ({ name: `Activity`, category, cost: 0, currency: 'EUR' })),
      meals: [],
      transport: [],
    },
  ],
});

const makeTraveller = (id: string, categories: string[], avoids: string[] = []): TravellerPreference => ({
  travellerId: id,
  label: id.toUpperCase(),
  preferences: { categories, avoids },
});

describe('ScoringEngine — categories', () => {
  it('echoes travellerId and label on every score row', () => {
    const result = engine.score(makeProposal(['culture']), [makeTraveller('t1', ['culture'])]);
    expect(result.scores[0]).toMatchObject({ travellerId: 't1', label: 'T1' });
  });

  it('score 100 when all traveller categories present in activities', () => {
    const result = engine.score(makeProposal(['culture', 'food']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBe(100);
  });

  it('score 0 when no categories match', () => {
    const result = engine.score(makeProposal(['adventure']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBe(0);
  });

  it('partial match returns score between 0 and 100', () => {
    const result = engine.score(makeProposal(['culture']), [
      makeTraveller('u1', ['culture', 'food']),
    ]);
    expect(result.scores[0]?.score).toBeGreaterThan(0);
    expect(result.scores[0]?.score).toBeLessThan(100);
  });

  it('empty travellers returns empty scores and overallScore 100', () => {
    const result = engine.score(makeProposal(['culture']), []);
    expect(result.scores).toHaveLength(0);
    expect(result.overallScore).toBe(100);
  });

  it('overallScore is mean of traveller scores', () => {
    const result = engine.score(makeProposal(['culture']), [
      makeTraveller('u1', ['culture']),
      makeTraveller('u2', ['food']),
    ]);
    const expected = Math.round((result.scores[0]!.score + result.scores[1]!.score) / 2);
    expect(result.overallScore).toBe(expected);
  });

  it('score 100 when traveller has no preferences or avoids', () => {
    const result = engine.score(makeProposal(['culture']), [{ travellerId: 'u1', label: 'U1', preferences: {} }]);
    expect(result.scores[0]?.score).toBe(100);
  });

  it('scores are clamped between 0 and 100', () => {
    const result = engine.score(makeProposal(['culture', 'food']), [
      makeTraveller('u1', ['culture', 'food', 'nightlife']),
    ]);
    expect(result.scores[0]?.score).toBeGreaterThanOrEqual(0);
    expect(result.scores[0]?.score).toBeLessThanOrEqual(100);
  });
});

describe('ScoringEngine — must-haves are weighted double', () => {
  const proposalWithMuseum: Record<string, unknown> = {
    itinerary: [
      {
        day: 1,
        activities: [
          { activity: 'Visit the Museu Nacional Soares dos Reis', venue: 'Museu Nacional Soares dos Reis', category: 'museum' },
          { activity: 'Sunset walk', venue: 'Jardim do Morro', category: 'leisure' },
        ],
      },
    ],
  };

  it('happy path: a satisfied must-have scores higher than a satisfied plain category', () => {
    const mustHaveOnly = engine.score(proposalWithMuseum, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'], categories: ['nightlife'] } },
    ]);
    const categoryOnly = engine.score(proposalWithMuseum, [
      { travellerId: 'u2', label: 'U2', preferences: { mustHaves: ['nightlife'], categories: ['museus'] } },
    ]);

    // must-have hit = 2/3 of the weight; category hit = 1/3.
    expect(mustHaveOnly.scores[0]!.score).toBe(67);
    expect(categoryOnly.scores[0]!.score).toBe(33);
    expect(mustHaveOnly.scores[0]!.score).toBeGreaterThan(categoryOnly.scores[0]!.score);
  });

  it('happy path: matches Portuguese free text against English category enums', () => {
    const result = engine.score(proposalWithMuseum, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'] } },
    ]);
    expect(result.scores[0]!.score).toBe(100);
  });

  it('happy path: travellers with different must-haves get different scores', () => {
    const result = engine.score(proposalWithMuseum, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'] } },
      { travellerId: 'u2', label: 'U2', preferences: { mustHaves: ['praias'] } },
    ]);
    expect(result.scores[0]!.score).toBe(100);
    expect(result.scores[1]!.score).toBe(0);
    expect(result.overallScore).toBe(50);
  });

  it('matches a must-have that only appears in the activity description', () => {
    const proposal = {
      itinerary: [
        {
          day: 1,
          activities: [{ activity: 'Coastal stroll', venue: 'Foz', description: 'Ends at the praias of Matosinhos' }],
        },
      ],
    };
    const result = engine.score(proposal, [{ travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['praias'] } }]);
    expect(result.scores[0]!.score).toBe(100);
  });
});

describe('ScoringEngine — avoids veto', () => {
  const proposalWithClub: Record<string, unknown> = {
    itinerary: [
      {
        day: 1,
        activities: [
          { activity: 'Museum morning', venue: 'Museu Nacional', category: 'museum' },
          { activity: 'Night out', venue: 'Discotecas do Porto', category: 'nightlife' },
        ],
      },
    ],
  };

  it('an avoided term found in the itinerary zeroes the traveller and reports vetoedBy', () => {
    const result = engine.score(proposalWithClub, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'], avoids: ['discotecas'] } },
    ]);
    expect(result.scores[0]!.score).toBe(0);
    expect(result.scores[0]!.vetoedBy).toEqual(['discotecas']);
  });

  it('the veto is per traveller — a traveller without that avoid keeps their score', () => {
    const result = engine.score(proposalWithClub, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'], avoids: ['discotecas'] } },
      { travellerId: 'u2', label: 'U2', preferences: { mustHaves: ['museus'] } },
    ]);
    expect(result.scores[0]!.score).toBe(0);
    expect(result.scores[1]!.score).toBe(100);
    expect(result.scores[1]!.vetoedBy).toBeUndefined();
  });

  it('a mention only in the description does NOT veto — prose must not sink a whole trip', () => {
    const proposal = {
      itinerary: [
        {
          day: 1,
          activities: [
            {
              activity: 'Riverside walk',
              venue: 'Cais da Ribeira',
              category: 'leisure',
              description: 'Quiet route that stays well away from the discotecas.',
            },
          ],
        },
      ],
    };
    const result = engine.score(proposal, [
      { travellerId: 'u1', label: 'U1', preferences: { avoids: ['discotecas'], categories: ['leisure'] } },
    ]);
    expect(result.scores[0]!.score).toBe(100);
    expect(result.scores[0]!.vetoedBy).toBeUndefined();
  });

  it('a short avoid term does not veto on a coincidental prefix', () => {
    const proposal = {
      itinerary: [{ day: 1, activities: [{ activity: 'Old town walk', venue: 'Barcelos', category: 'culture' }] }],
    };
    const result = engine.score(proposal, [{ travellerId: 'u1', label: 'U1', preferences: { avoids: ['bar'] } }]);
    expect(result.scores[0]!.score).toBe(100);
  });
});

describe('ScoringEngine — persona-derived categories differentiate travellers', () => {
  // Shaped like a real merged itinerary: `category` comes from the source slot
  // proposal, which WorkflowEngine now stamps onto merged activities.
  const mixedItinerary: Record<string, unknown> = {
    itinerary: [
      {
        day: 1,
        activities: [
          { activity: 'Museu Nacional Soares dos Reis', venue: 'Museu Nacional', category: 'museum' },
          { activity: 'Walking tour of the historic centre', venue: 'Ribeira', category: 'history' },
          { activity: 'Dinner at a tasca', venue: 'Tasca do Bairro', category: 'gastronomy' },
        ],
      },
    ],
  };

  const culture: TravellerPreference = {
    travellerId: 't1',
    label: 'Ana',
    preferences: { categories: ['culture', 'museum', 'history'] },
  };
  const action: TravellerPreference = {
    travellerId: 't2',
    label: 'Bruno',
    preferences: { categories: ['hiking', 'adventure', 'outdoor'] },
  };

  it('happy path: two personas score differently on the same itinerary', () => {
    const result = engine.score(mixedItinerary, [culture, action]);

    expect(result.scores[0]!.score).toBe(100);
    expect(result.scores[1]!.score).toBe(0);
    expect(result.scores[0]!.score).not.toBe(result.scores[1]!.score);
  });

  it('category credit saturates at the target instead of shrinking with vocabulary size', () => {
    // Five interests, two of them satisfied: full credit, not 2/5.
    const wideVocabulary: TravellerPreference = {
      travellerId: 't3',
      label: 'Carla',
      preferences: { categories: ['culture', 'museum', 'history', 'architecture', 'art'] },
    };
    expect(engine.score(mixedItinerary, [wideVocabulary]).scores[0]!.score).toBe(100);
  });

  it('a single satisfied interest out of a persona vocabulary is still half credit', () => {
    const onlyGastronomy: TravellerPreference = {
      travellerId: 't4',
      label: 'Duarte',
      preferences: { categories: ['gastronomy', 'fine-dining', 'market'] },
    };
    expect(engine.score(mixedItinerary, [onlyGastronomy]).scores[0]!.score).toBe(50);
  });

  it('calibration: a plausible mixed group stays above the 60 cancel threshold', () => {
    // WorkflowStateMachine sends a trip to ASK_REFINEMENT (→ cancelled) below 60,
    // so a realistic four-persona itinerary must not fall through that floor.
    const fourPersonas: Record<string, unknown> = {
      itinerary: [
        {
          day: 1,
          activities: [
            { activity: 'Museum morning', venue: 'Museu Nacional', category: 'museum' },
            { activity: 'Historic centre walk', venue: 'Ribeira', category: 'history' },
            { activity: 'Beach afternoon', venue: 'Praia de Matosinhos', category: 'beach' },
            { activity: 'Wine cellar visit', venue: 'Cave do Douro', category: 'wine' },
            { activity: 'Coastal hike', venue: 'Parque da Cidade', category: 'hiking' },
            { activity: 'Outdoor kayaking', venue: 'Rio Douro', category: 'outdoor' },
            { activity: 'Food market lunch', venue: 'Mercado do Bolhao', category: 'market' },
            { activity: 'Tasting menu dinner', venue: 'Restaurante Fine', category: 'gastronomy' },
          ],
        },
      ],
    };
    const group: TravellerPreference[] = [
      { travellerId: 't1', label: 'Ana', preferences: { categories: ['culture', 'museum', 'history'] } },
      { travellerId: 't2', label: 'Bruno', preferences: { categories: ['beach', 'relaxation', 'wine'] } },
      { travellerId: 't3', label: 'Carla', preferences: { categories: ['hiking', 'adventure', 'outdoor'] } },
      { travellerId: 't4', label: 'Duarte', preferences: { categories: ['gastronomy', 'fine-dining', 'market'] } },
    ];

    const result = engine.score(fourPersonas, group);

    expect(result.overallScore).toBeGreaterThanOrEqual(60);
    for (const score of result.scores) {
      expect(score.score).toBeGreaterThan(0);
    }
  });

  it('an avoid still zeroes a traveller whose categories are otherwise satisfied', () => {
    const withAvoid: TravellerPreference = {
      travellerId: 't5',
      label: 'Eva',
      preferences: { categories: ['culture', 'museum'], avoids: ['museu'] },
    };
    const result = engine.score(mixedItinerary, [withAvoid]);
    expect(result.scores[0]!.score).toBe(0);
    expect(result.scores[0]!.vetoedBy).toEqual(['museu']);
  });

  it('two travellers sharing a persona both appear as separate rows', () => {
    const result = engine.score(mixedItinerary, [
      { travellerId: 't6', label: 'Ana', preferences: { categories: ['culture'] } },
      { travellerId: 't7', label: 'Ana', preferences: { categories: ['culture'] } },
    ]);
    expect(result.scores.map((s) => s.travellerId)).toEqual(['t6', 't7']);
  });
});

describe('ScoringEngine — malformed input', () => {
  it('a non-array itinerary yields no matches instead of throwing', () => {
    const result = engine.score({ itinerary: 'not an itinerary' }, [
      { travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'] } },
    ]);
    expect(result.scores[0]!.score).toBe(0);
  });

  it('a missing itinerary key yields no matches instead of throwing', () => {
    const result = engine.score({}, [{ travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'] } }]);
    expect(result.scores[0]!.score).toBe(0);
  });

  it('null days and non-array activities are skipped', () => {
    const proposal = {
      itinerary: [null, { day: 1, activities: 'nope' }, { day: 2, activities: [null, 'nope'] }],
    };
    const result = engine.score(proposal, [{ travellerId: 'u1', label: 'U1', preferences: { mustHaves: ['museus'] } }]);
    expect(result.scores[0]!.score).toBe(0);
  });

  it('non-string activity fields are ignored', () => {
    const proposal = { itinerary: [{ day: 1, activities: [{ activity: 42, venue: null, category: {} }] }] };
    const result = engine.score(proposal, [{ travellerId: 'u1', label: 'U1', preferences: { avoids: ['discotecas'] } }]);
    expect(result.scores[0]!.score).toBe(100);
  });
});
