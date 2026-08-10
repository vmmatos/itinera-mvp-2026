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
  byCategory: { accommodation: 0, activities: 100, meals: 50, transport: 30 },
  perPersonTotal: 180,
  grandTotal: 180,
  groupSize: 1,
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

  it('passes the configured tolerance to the validator', async () => {
    const app = express();
    app.use(express.json());
    app.use(createFinanceRouter(mockCalculator, mockValidator, mockFinder, mockStorage, { budgetTolerancePct: 10 }));
    await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(mockValidator.validate).toHaveBeenCalledWith(expect.anything(), 500, 'EUR', 10);
  });

  it('defaults to strict validation (tolerance 0) when no option is given', async () => {
    const app = buildApp();
    await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });
    expect(mockValidator.validate).toHaveBeenCalledWith(expect.anything(), 500, 'EUR', 0);
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

  it('200 attaches an itemised budgetBreakdown (issue #73)', async () => {
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
      groupSize: 2,
    });

    expect(res.status).toBe(200);
    const bd = res.body.review.content.budgetBreakdown;
    expect(bd).toBeDefined();
    expect(bd.groupSize).toBe(1); // groupSize comes from the (mocked) calculator's breakdown, not the request
    expect(bd.categories).toHaveProperty('accommodation');
    expect(bd.categories).toHaveProperty('restaurants');
    expect(bd.categories).toHaveProperty('activities');
    expect(bd.categories).toHaveProperty('transport');
    expect(bd.categories).toHaveProperty('buffer');
    expect(bd.categories.buffer.amountTotal).toBe(Math.round((0 + 100 + 50 + 30) * 0.1));
    expect(bd.suggestedCuts).toEqual([]);
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
      null,
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
      VALID_UUID, 1, expect.any(Object), expect.any(Object), expect.any(Object), '', null,
    );
  });

  // The route handler previously had no try/catch around this async body —
  // findAlternatives calls the LLM (AlternativeFinder), and this repo runs
  // Express 4 with no express-async-errors shim, so a rejection here used to
  // become an unhandled promise rejection in the process instead of a clean
  // error response the orchestrator's executeFinanceValidate can catch.
  it('returns a clean error response instead of an unhandled rejection when findAlternatives throws', async () => {
    vi.mocked(mockFinder.findAlternatives).mockRejectedValue(new Error('Anthropic API rate limit exceeded'));
    const app = buildApp();
    const res = await request(app).post('/review').send({
      tripId: VALID_UUID,
      round: 1,
      proposal: { itinerary: VALID_ITINERARY },
      budgetTotal: 500,
      budgetCurrency: 'EUR',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Anthropic API rate limit exceeded');
  });
});

describe('POST /estimate', () => {
  const ESTIMATE_BASE = {
    tripId: VALID_UUID,
    budgetTotal: 2000,
    budgetCurrency: 'EUR',
    groupSize: 2,
    routeGraph: {
      orderedLegs: [{ totalCostEurPerPerson: 100 }],
      cityStays: [
        { city: 'Lisbon', nights: 2, budgetPerPersonPerNight: 100 },
      ],
      totalTransportCostEurPerPerson: 100,
      totalDurationDays: 2,
    },
  };

  it('subtracts the meals reserve from the experiences envelope', async () => {
    const app = buildApp();
    const res = await request(app).post('/estimate').send({
      ...ESTIMATE_BASE,
      routeGraph: { ...ESTIMATE_BASE.routeGraph, mealsReserveEurPerPerson: 150 },
    });

    expect(res.status).toBe(200);
    // budgetPerPerson 1000 − transport 100 − meals 150 − accommodation 200 = 550 experiences.
    expect(res.body.budgetPlan.perBlock[0].experiencesBudgetEurPerPerson).toBe(550);
    // Total per person includes the meals reserve.
    expect(res.body.budgetPlan.totalEurPerPerson).toBe(1000);
    expect(res.body.budgetPlan.feasible).toBe(true);
  });

  it('is backwards compatible when no meals reserve is sent', async () => {
    const app = buildApp();
    const res = await request(app).post('/estimate').send(ESTIMATE_BASE);

    expect(res.status).toBe(200);
    expect(res.body.budgetPlan.perBlock[0].experiencesBudgetEurPerPerson).toBe(700);
  });

  it('marks the plan infeasible when fixed costs plus meals exceed the budget', async () => {
    const app = buildApp();
    const res = await request(app).post('/estimate').send({
      ...ESTIMATE_BASE,
      budgetTotal: 800,
      routeGraph: { ...ESTIMATE_BASE.routeGraph, mealsReserveEurPerPerson: 150 },
    });

    expect(res.status).toBe(200);
    // budgetPerPerson 400 − 100 − 150 − 200 = −50 → clamped to 0 experiences, infeasible.
    expect(res.body.budgetPlan.feasible).toBe(false);
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

  it('returns a clean error response instead of an unhandled rejection when storage throws', async () => {
    vi.mocked(mockStorage.findLatestByTripId).mockRejectedValue(new Error('DB connection lost'));
    const app = buildApp();
    const res = await request(app).get(`/breakdown?tripId=${VALID_UUID}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('DB connection lost');
  });
});
