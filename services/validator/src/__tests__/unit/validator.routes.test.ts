import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  };
});

const mockFind = vi.fn().mockResolvedValue([]);
const mockIsInitialized = { value: true };

vi.mock('@/data-source', () => ({
  AppDataSource: {
    get isInitialized() { return mockIsInitialized.value; },
    getRepository: () => ({ find: mockFind }),
  },
}));

import { createValidatorRouter } from '@/routes/validator';
import { createHealthRouter } from '@/routes/health';
import { ConstraintChecker } from '@/validators/ConstraintChecker';
import { ScoringEngine } from '@/validators/ScoringEngine';
import { FairnessCalculator } from '@/validators/FairnessCalculator';
import type { ValidationService } from '@/services/ValidationService';
import type { RabbitMQPublisher } from '@/services/RabbitMQPublisher';

const mockValidate = vi.fn();
const mockValidationService = { validate: mockValidate } as unknown as ValidationService;

const mockIsConnected = vi.fn().mockReturnValue(true);
const mockPublisher = { isConnected: mockIsConnected } as unknown as RabbitMQPublisher;

const constraintChecker = new ConstraintChecker();
const scoringEngine = new ScoringEngine();
const fairnessCalculator = new FairnessCalculator();

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createHealthRouter(mockPublisher));
  app.use(
    '/api/v1/validate',
    createValidatorRouter(mockValidationService, scoringEngine, fairnessCalculator, constraintChecker),
  );
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const validationResult = {
  constraints: { passed: true, violations: [] },
  scoring: { scores: [], overallScore: 100 },
  fairness: { stdDev: 0, fairnessScore: 100, minScore: 100, maxScore: 100 },
  metrics: { convergenceRounds: 6, autonomyPct: 100, totalTokens: 0, estimatedCostUsd: 0 },
};

describe('GET /health', () => {
  it('200 with status ok', async () => {
    const res = await request(buildApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('validator');
  });
});

describe('GET /ready', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('200 when db and mq are up', async () => {
    mockIsInitialized.value = true;
    mockIsConnected.mockReturnValue(true);
    const res = await request(buildApp()).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('503 when db is down', async () => {
    mockIsInitialized.value = false;
    mockIsConnected.mockReturnValue(true);
    const res = await request(buildApp()).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    mockIsInitialized.value = true;
  });

  it('503 when mq is down', async () => {
    mockIsInitialized.value = true;
    mockIsConnected.mockReturnValue(false);
    const res = await request(buildApp()).get('/ready');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/v1/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFind.mockResolvedValue([]);
    mockValidate.mockResolvedValue(validationResult);
  });

  it('200 with valid body returns content, latencyMs, tokensUsed', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 6, proposal: {} });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('latencyMs');
    expect(res.body).toHaveProperty('tokensUsed');
    expect(res.body.tokensUsed).toBe(0);
  });

  it('content contains constraints, scoring, fairness, metrics', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 6, proposal: {} });

    expect(res.body.content).toHaveProperty('constraints');
    expect(res.body.content).toHaveProperty('scoring');
    expect(res.body.content).toHaveProperty('fairness');
    expect(res.body.content).toHaveProperty('metrics');
  });

  it('400 when tripId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ round: 6, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('400 when round is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: 'not-a-uuid', round: 6, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('400 when round is less than 1', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 0, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('forwards finance and logistics compliance to the validation service', async () => {
    const compliance = {
      finance: { budgetTotal: 2200, actualTotal: 4400 },
      logistics: { transportDowngrades: 1, restrictionWarnings: 0, weatherRisk: 'medium' },
    };
    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {}, compliance });

    expect(mockValidate).toHaveBeenCalledWith(
      VALID_UUID, 2, {}, {}, [], compliance,
    );
  });

  // Previously hardcoded to `{}` here, which made ConstraintChecker's budget
  // branch dead code no matter what the orchestrator sent.
  it('forwards real constraints instead of an empty object', async () => {
    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {}, constraints: { budgetTotal: 2200, travellerCount: 2 } });

    expect(mockValidate).toHaveBeenCalledWith(
      VALID_UUID, 2, {}, { budgetTotal: 2200, travellerCount: 2 }, [], undefined,
    );
  });

  it('omitting compliance and constraints keeps the previous persona-only behaviour', async () => {
    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(mockValidate).toHaveBeenCalledWith(VALID_UUID, 2, {}, {}, [], undefined);
  });

  it('400 when compliance carries a malformed weather risk', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({
        tripId: VALID_UUID, round: 2, proposal: {},
        compliance: { logistics: { weatherRisk: 'apocalyptic' } },
      });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/validate/itinerary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFind.mockResolvedValue([]);
  });

  it('200 with valid body returns scoring and fairness', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ tripId: VALID_UUID, proposal: { itinerary: [] } });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scoring');
    expect(res.body).toHaveProperty('fairness');
  });

  it('400 when tripId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ proposal: {} });
    expect(res.status).toBe(400);
  });

  it('uses provided travellers without DB query', async () => {
    const travellers = [
      { travellerId: 'trav-1', label: 'Ana', preferences: { categories: ['culture'] } },
    ];
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ tripId: VALID_UUID, proposal: {}, travellers });

    expect(res.status).toBe(200);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('normalises the legacy dealBreakers key from the DB onto avoids', async () => {
    mockFind.mockResolvedValue([
      { id: 'trav-1', userId: VALID_UUID, name: 'Ana', preferences: { mustHaves: ['museus'], dealBreakers: ['discotecas'] } },
    ]);

    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({
        tripId: VALID_UUID,
        proposal: {
          itinerary: [
            { day: 1, activities: [{ activity: 'Night out', venue: 'Discotecas do Porto', category: 'nightlife' }] },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.scoring.scores[0].score).toBe(0);
    expect(res.body.scoring.scores[0].vetoedBy).toEqual(['discotecas']);
  });

  it('scores a DB traveller against their must-haves rather than defaulting to 100', async () => {
    mockFind.mockResolvedValue([
      { id: 'trav-1', userId: VALID_UUID, name: 'Ana', preferences: { mustHaves: ['museus'] } },
    ]);

    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({
        tripId: VALID_UUID,
        proposal: {
          itinerary: [{ day: 1, activities: [{ activity: 'Hike', venue: 'Serra da Estrela', category: 'outdoor' }] }],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.scoring.overallScore).toBe(0);
  });
});

describe('POST /api/v1/validate — traveller mapping', () => {
  const CULTURE = { id: 'trav-1', userId: VALID_UUID, name: 'Ana', preferences: { persona: 'culture' } };
  const ACTION  = { id: 'trav-2', userId: null, name: null, preferences: { persona: 'action' } };

  // `POST /` delegates to a mocked ValidationService, so what matters here is the
  // traveller shape the route hands it. Real scoring is asserted on /itinerary.
  const travellersPassedToValidate = (): Array<{
    travellerId: string;
    label: string;
    preferences: { mustHaves?: string[]; avoids?: string[]; categories?: string[] };
  }> => mockValidate.mock.calls[0]![4];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFind.mockResolvedValue([]);
    mockValidate.mockResolvedValue(validationResult);
  });

  it('happy path: derives each traveller categories from their persona', async () => {
    mockFind.mockResolvedValue([CULTURE, ACTION]);

    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(res.status).toBe(200);
    const travellers = travellersPassedToValidate();
    expect(travellers[0]).toMatchObject({ travellerId: 'trav-1', label: 'Ana' });
    expect(travellers[0]!.preferences.categories).toEqual(['culture', 'museum', 'history']);
    expect(travellers[1]!.preferences.categories).toEqual(['hiking', 'adventure', 'outdoor']);
  });

  it('happy path: applies the trip-level brief to every traveller', async () => {
    mockFind.mockResolvedValue([CULTURE, ACTION]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({
        tripId: VALID_UUID,
        round: 2,
        proposal: {},
        groupPreferences: { mustHaves: ['museus'], avoids: ['discotecas'] },
      });

    for (const traveller of travellersPassedToValidate()) {
      expect(traveller.preferences.mustHaves).toEqual(['museus']);
      expect(traveller.preferences.avoids).toEqual(['discotecas']);
    }
  });

  it('legacy: without groupPreferences it reads each traveller own brief', async () => {
    mockFind.mockResolvedValue([
      { ...CULTURE, preferences: { persona: 'culture', mustHaves: ['praias'], dealBreakers: ['casinos'] } },
    ]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    const traveller = travellersPassedToValidate()[0]!;
    expect(traveller.preferences.mustHaves).toEqual(['praias']);
    expect(traveller.preferences.avoids).toEqual(['casinos']);
  });

  it('labels a traveller with no name by their persona', async () => {
    mockFind.mockResolvedValue([ACTION]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(travellersPassedToValidate()[0]!.label).toBe('Action & Hiking');
  });

  it('falls back to a positional label when there is neither name nor persona', async () => {
    mockFind.mockResolvedValue([{ id: 'trav-9', userId: null, name: '  ', preferences: {} }]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(travellersPassedToValidate()[0]!.label).toBe('Traveller 1');
  });

  it('keys rows by traveller id, so a null user_id is still scored', async () => {
    mockFind.mockResolvedValue([ACTION]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(travellersPassedToValidate()[0]!.travellerId).toBe('trav-2');
  });

  it('reads travellers in creation order so positional labels are stable', async () => {
    mockFind.mockResolvedValue([CULTURE]);

    await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(mockFind).toHaveBeenCalledWith({ where: { tripId: VALID_UUID }, order: { createdAt: 'ASC' } });
  });

  it('error: a malformed preferences blob yields empty categories instead of throwing', async () => {
    mockFind.mockResolvedValue([{ id: 'trav-1', userId: null, name: null, preferences: { categories: 3 } }]);

    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(res.status).toBe(200);
    expect(travellersPassedToValidate()[0]!.preferences.categories).toEqual([]);
  });

  it('error: no travellers on the trip passes an empty list', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {} });

    expect(res.status).toBe(200);
    expect(travellersPassedToValidate()).toEqual([]);
  });

  it('error: 400 when groupPreferences is not an object', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({ tripId: VALID_UUID, round: 2, proposal: {}, groupPreferences: 'nope' });

    expect(res.status).toBe(400);
  });

  it('error: 400 when groupPreferences carries more terms than allowed', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate')
      .send({
        tripId: VALID_UUID,
        round: 2,
        proposal: {},
        groupPreferences: { mustHaves: Array.from({ length: 21 }, (_, i) => `t${i}`) },
      });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/validate/itinerary — per-traveller scores', () => {
  const MIXED_PROPOSAL = {
    itinerary: [
      {
        day: 1,
        activities: [
          { activity: 'Museu Nacional', venue: 'Museu Nacional', category: 'museum' },
          { activity: 'Historic centre walk', venue: 'Ribeira', category: 'history' },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFind.mockResolvedValue([]);
  });

  it('happy path: two personas score differently against the same itinerary', async () => {
    mockFind.mockResolvedValue([
      { id: 'trav-1', userId: null, name: 'Ana', preferences: { persona: 'culture' } },
      { id: 'trav-2', userId: null, name: 'Bruno', preferences: { persona: 'action' } },
    ]);

    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ tripId: VALID_UUID, proposal: MIXED_PROPOSAL });

    const scores = res.body.scoring.scores;
    expect(res.status).toBe(200);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toMatchObject({ travellerId: 'trav-1', label: 'Ana', score: 100 });
    expect(scores[1].score).toBe(0);
    expect(res.body.fairness.stdDev).toBeGreaterThan(0);
  });

  it('accepts a legacy body traveller keyed by userId', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({
        tripId: VALID_UUID,
        proposal: MIXED_PROPOSAL,
        travellers: [{ userId: 'user-7', preferences: { categories: ['culture'] } }],
      });

    expect(res.status).toBe(200);
    expect(res.body.scoring.scores[0].travellerId).toBe('user-7');
    expect(res.body.scoring.scores[0].label).toBe('Traveller');
  });

  it('error: 400 when a body traveller has no id at all', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ tripId: VALID_UUID, proposal: MIXED_PROPOSAL, travellers: [{ preferences: {} }] });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/validate/constraints', () => {
  it('200 with valid body returns constraints result', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/constraints')
      .send({
        tripId: VALID_UUID,
        proposal: { itinerary: [{ day: 1, activities: [], meals: [], transport: [] }] },
        constraints: { durationDays: 7 },
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('constraints');
    expect(res.body.constraints).toHaveProperty('passed');
    expect(res.body.constraints).toHaveProperty('violations');
  });

  it('400 when constraints field is missing', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/constraints')
      .send({ tripId: VALID_UUID, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('constraints.passed is true when itinerary fits durationDays', async () => {
    const res = await request(buildApp())
      .post('/api/v1/validate/constraints')
      .send({
        tripId: VALID_UUID,
        proposal: { itinerary: [{ day: 1 }] },
        constraints: { durationDays: 7 },
      });

    expect(res.body.constraints.passed).toBe(true);
    expect(res.body.constraints.violations).toHaveLength(0);
  });

  it('constraints.passed is false when itinerary exceeds durationDays', async () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ day: i + 1 }));
    const res = await request(buildApp())
      .post('/api/v1/validate/constraints')
      .send({
        tripId: VALID_UUID,
        proposal: { itinerary: days },
        constraints: { durationDays: 7 },
      });

    expect(res.body.constraints.passed).toBe(false);
  });
});
