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
      { userId: VALID_UUID, preferences: { categories: ['culture'] } },
    ];
    const res = await request(buildApp())
      .post('/api/v1/validate/itinerary')
      .send({ tripId: VALID_UUID, proposal: {}, travellers });

    expect(res.status).toBe(200);
    expect(mockFind).not.toHaveBeenCalled();
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
