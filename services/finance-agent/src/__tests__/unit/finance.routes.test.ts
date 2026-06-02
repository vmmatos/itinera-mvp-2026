import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    errorHandler: (
      err: Error & { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode ?? 400).json({ success: false, error: { message: err.message } });
    },
  };
});

import { createFinanceRouter } from '@/routes/finance';
import type { CostCalculator } from '@/agents/CostCalculator';
import type { BudgetValidator } from '@/agents/BudgetValidator';
import type { AlternativeFinder } from '@/agents/AlternativeFinder';
import type { ProposalStorageService } from '@/services/ProposalStorageService';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_BREAKDOWN = {
  byCategory: { activities: 100, meals: 50, transport: 30 },
  grandTotal: 180,
  currency: 'EUR',
  items: [],
};

const MOCK_VALIDATION = {
  status: 'within_budget' as const,
  percentageUsed: 90,
  remaining: 20,
  budgetTotal: 200,
  currency: 'EUR',
};

const MOCK_EVENT = {
  tripId: VALID_UUID,
  type: 'agent.propose',
  agent: 'finance',
  round: 1,
  timestamp: new Date().toISOString(),
  content: { costBreakdown: MOCK_BREAKDOWN, budgetValidation: MOCK_VALIDATION },
};

const mockCalculator = { calculate: vi.fn() } as unknown as CostCalculator;
const mockValidator = { validate: vi.fn() } as unknown as BudgetValidator;
const mockFinder = { findAlternatives: vi.fn() } as unknown as AlternativeFinder;
const mockStorage = { findLatestByTripId: vi.fn() } as unknown as ProposalStorageService;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createFinanceRouter(mockCalculator, mockValidator, mockFinder, mockStorage));
  app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const VALID_ITINERARY = [
  {
    day: 1,
    activities: [{ name: 'Museum', cost: 20, currency: 'EUR' }],
    meals: [{ name: 'Lunch', cost: 15, currency: 'EUR' }],
    transport: [{ from: 'Hotel', to: 'Museum', cost: 10, currency: 'EUR' }],
  },
];

describe('POST /review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCalculator.calculate).mockReturnValue(MOCK_BREAKDOWN);
    vi.mocked(mockValidator.validate).mockReturnValue(MOCK_VALIDATION);
    vi.mocked(mockFinder.findAlternatives).mockResolvedValue(MOCK_EVENT);
  });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: 'not-a-uuid',
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(400);
  });

  it('400 when round is less than 1', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 0,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(400);
  });

  it('200 with empty itinerary (calculates zero cost)', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: [] },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('review');
  });

  it('400 when budgetTotal is zero', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 0,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(400);
  });

  it('400 when budgetTotal is negative', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: -100,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(400);
  });

  it('400 when budgetCurrency is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
    });
    expect(res.status).toBe(400);
  });

  it('200 returns review AgentEvent', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(res.status).toBe(200);
    expect(res.body.review).toBeDefined();
    expect(res.body.review.agent).toBe('finance');
  });

  it('passes tripId, round, proposal, breakdown, and validation to finder', async () => {
    const app = buildApp();
    await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 2,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
      context: 'Paris trip',
    });

    expect(mockFinder.findAlternatives).toHaveBeenCalledWith(
      VALID_UUID,
      2,
      { itinerary: VALID_ITINERARY },
      MOCK_BREAKDOWN,
      MOCK_VALIDATION,
      'Paris trip',
    );
  });

  it('context defaults to empty string when omitted', async () => {
    const app = buildApp();
    await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });

    expect(mockFinder.findAlternatives).toHaveBeenCalledWith(
      VALID_UUID, 1, expect.any(Object), expect.any(Object), expect.any(Object), '',
    );
  });
});

describe('GET /breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/breakdown');
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a valid UUID', async () => {
    const app = buildApp();
    const res = await request(app).get('/breakdown?tripId=not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('404 when no finance proposal found', async () => {
    vi.mocked(mockStorage.findLatestByTripId).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get(`/breakdown?tripId=${VALID_UUID}`);
    expect(res.status).toBe(404);
  });

  it('200 returns stored breakdown content', async () => {
    const storedContent = { costBreakdown: MOCK_BREAKDOWN };
    vi.mocked(mockStorage.findLatestByTripId).mockResolvedValue({
      id: 'abc',
      tripId: VALID_UUID,
      agent: 'finance',
      round: 1,
      content: storedContent,
      score: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = buildApp();
    const res = await request(app).get(`/breakdown?tripId=${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.breakdown).toBeDefined();
  });

  it('passes round to storage when provided', async () => {
    vi.mocked(mockStorage.findLatestByTripId).mockResolvedValue(null);
    const app = buildApp();
    await request(app).get(`/breakdown?tripId=${VALID_UUID}&round=3`);
    expect(mockStorage.findLatestByTripId).toHaveBeenCalledWith(VALID_UUID, 3);
  });

  it('passes undefined round to storage when not provided', async () => {
    vi.mocked(mockStorage.findLatestByTripId).mockResolvedValue(null);
    const app = buildApp();
    await request(app).get(`/breakdown?tripId=${VALID_UUID}`);
    expect(mockStorage.findLatestByTripId).toHaveBeenCalledWith(VALID_UUID, undefined);
  });
});
