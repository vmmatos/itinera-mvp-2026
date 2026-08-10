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
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ success: false, error: { message: err.message } });
    },
  };
});

import { createOrchestratorRouter } from '@/routes/orchestrator';
import type { ConflictAnalyzer } from '@/agents/ConflictAnalyzer';
import type { CompromiseGenerator } from '@/agents/CompromiseGenerator';
import type { ProposalRefiner } from '@/agents/ProposalRefiner';
import type { ItineraryMerger } from '@/agents/ItineraryMerger';
import type { ItineraryRepairer } from '@/agents/ItineraryRepairer';

const mockAnalyzer = { analyze: vi.fn() } as unknown as ConflictAnalyzer;
const mockGenerator = { generateCompromise: vi.fn() } as unknown as CompromiseGenerator;
const mockRefiner = { refine: vi.fn() } as unknown as ProposalRefiner;
const mockMerger = { merge: vi.fn() } as unknown as ItineraryMerger;
const mockRepairer = { repair: vi.fn() } as unknown as ItineraryRepairer;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createOrchestratorRouter(mockAnalyzer, mockGenerator, mockRefiner));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

function buildAppWithMerger(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createOrchestratorRouter(mockAnalyzer, mockGenerator, mockRefiner, mockMerger, mockRepairer));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_EVENT = {
  tripId: VALID_UUID,
  type: 'agent.score',
  agent: 'orchestrator',
  round: 1,
  timestamp: new Date().toISOString(),
  content: {},
};

describe('POST /analyze', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/analyze').send({ round: 1, proposals: [{}] });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/analyze').send({ tripId: 'not-a-uuid', round: 1, proposals: [{}] });
    expect(res.status).toBe(400);
  });

  it('400 when round is less than 1', async () => {
    const app = buildApp();
    const res = await request(app).post('/analyze').send({ tripId: VALID_UUID, round: 0, proposals: [{}] });
    expect(res.status).toBe(400);
  });

  it('400 when proposals array is empty', async () => {
    const app = buildApp();
    const res = await request(app).post('/analyze').send({ tripId: VALID_UUID, round: 1, proposals: [] });
    expect(res.status).toBe(400);
  });

  it('400 when proposals is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/analyze').send({ tripId: VALID_UUID, round: 1 });
    expect(res.status).toBe(400);
  });

  it('200 returns analysis AgentEvent', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue(MOCK_EVENT);

    const app = buildApp();
    const res = await request(app)
      .post('/analyze')
      .send({ tripId: VALID_UUID, round: 1, proposals: [{ agent: 'alice', content: {} }] });

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
    expect(res.body.analysis.agent).toBe('orchestrator');
    expect(res.body.analysis.type).toBe('agent.score');
  });

  it('200 passes tripId, round, and proposals to analyzer', async () => {
    vi.mocked(mockAnalyzer.analyze).mockResolvedValue(MOCK_EVENT);
    const proposals = [{ agent: 'alice' }, { agent: 'bob' }];

    const app = buildApp();
    await request(app).post('/analyze').send({ tripId: VALID_UUID, round: 2, proposals });

    expect(mockAnalyzer.analyze).toHaveBeenCalledWith(VALID_UUID, 2, proposals);
  });
});

describe('POST /propose', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ round: 1, conflicts: {} });
    expect(res.status).toBe(400);
  });

  it('400 when round is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ tripId: VALID_UUID, conflicts: {} });
    expect(res.status).toBe(400);
  });

  it('400 when conflicts is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ tripId: VALID_UUID, round: 1 });
    expect(res.status).toBe(400);
  });

  it('200 returns compromise AgentEvent', async () => {
    const mockCompromise = { ...MOCK_EVENT, type: 'agent.propose' };
    vi.mocked(mockGenerator.generateCompromise).mockResolvedValue(mockCompromise);

    const app = buildApp();
    const res = await request(app)
      .post('/propose')
      .send({ tripId: VALID_UUID, round: 1, conflicts: { conflicts: [] } });

    expect(res.status).toBe(200);
    expect(res.body.compromise).toBeDefined();
    expect(res.body.compromise.type).toBe('agent.propose');
  });

  it('200 passes context with default empty string when omitted', async () => {
    const mockCompromise = { ...MOCK_EVENT, type: 'agent.propose' };
    vi.mocked(mockGenerator.generateCompromise).mockResolvedValue(mockCompromise);

    const app = buildApp();
    await request(app)
      .post('/propose')
      .send({ tripId: VALID_UUID, round: 1, conflicts: {} });

    expect(mockGenerator.generateCompromise).toHaveBeenCalledWith(
      VALID_UUID, 1, {}, '',
    );
  });
});

describe('POST /refine', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/refine')
      .send({ round: 1, proposal: {}, feedback: 'more outdoor activities' });
    expect(res.status).toBe(400);
  });

  it('400 when proposal is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/refine')
      .send({ tripId: VALID_UUID, round: 1, feedback: 'more outdoor activities' });
    expect(res.status).toBe(400);
  });

  it('400 when feedback is empty string', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/refine')
      .send({ tripId: VALID_UUID, round: 1, proposal: {}, feedback: '' });
    expect(res.status).toBe(400);
  });

  it('400 when feedback is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/refine')
      .send({ tripId: VALID_UUID, round: 1, proposal: {} });
    expect(res.status).toBe(400);
  });

  it('200 returns refined AgentEvent', async () => {
    const mockRefined = { ...MOCK_EVENT, type: 'agent.refine' };
    vi.mocked(mockRefiner.refine).mockResolvedValue(mockRefined);

    const app = buildApp();
    const res = await request(app)
      .post('/refine')
      .send({ tripId: VALID_UUID, round: 1, proposal: { itinerary: [] }, feedback: 'add more culture' });

    expect(res.status).toBe(200);
    expect(res.body.refined).toBeDefined();
    expect(res.body.refined.type).toBe('agent.refine');
  });

  it('200 passes all fields including context to refiner', async () => {
    const mockRefined = { ...MOCK_EVENT, type: 'agent.refine' };
    vi.mocked(mockRefiner.refine).mockResolvedValue(mockRefined);
    const proposal = { itinerary: [{ day: 1 }] };

    const app = buildApp();
    await request(app)
      .post('/refine')
      .send({ tripId: VALID_UUID, round: 2, proposal, feedback: 'add culture', context: 'Paris trip' });

    expect(mockRefiner.refine).toHaveBeenCalledWith(
      VALID_UUID, 2, proposal, 'add culture', 'Paris trip',
    );
  });
});

describe('POST /merge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const MERGE_BODY = {
    tripId: VALID_UUID,
    round: 1,
    routeGraph: { orderedLegs: [], cityStays: [] },
    touristOutputs: { alice: {} },
    budgetPlan: { perBlock: [], totalEurPerPerson: 0, grandTotal: 0, feasible: true, bufferPct: 10, currency: 'EUR' },
    targetCity: 'Barcelona',
  };

  it('501-equivalent (400 via ValidationError) when merger is not configured', async () => {
    const app = buildApp(); // built without a merger
    const res = await request(app).post('/merge').send(MERGE_BODY);
    expect(res.status).toBe(400);
  });

  it('400 when tripId is missing', async () => {
    const app = buildAppWithMerger();
    const res = await request(app).post('/merge').send({ ...MERGE_BODY, tripId: undefined });
    expect(res.status).toBe(400);
  });

  it('200 returns merged AgentEvent', async () => {
    const mockMerged = { ...MOCK_EVENT, type: 'agent.propose' };
    vi.mocked(mockMerger.merge).mockResolvedValue(mockMerged);

    const app = buildAppWithMerger();
    const res = await request(app).post('/merge').send(MERGE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.merged).toBeDefined();
    expect(res.body.merged.type).toBe('agent.propose');
  });

  it('propagates a merge failure as an error response instead of hanging the request', async () => {
    vi.mocked(mockMerger.merge).mockRejectedValue(
      new Error('orchestrator agent failed to produce a valid itinerary after retry (truncated=true)'),
    );

    const app = buildAppWithMerger();
    const res = await request(app).post('/merge').send(MERGE_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('failed to produce a valid itinerary');
  });
});

describe('POST /repair', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const REPAIR_BODY = {
    tripId: VALID_UUID,
    round: 2,
    itinerary: [{ day: 1, activities: [] }],
    accommodation: [],
    financeFeedback: {
      overAmountTotal: 200,
      overAmountPerPerson: 100,
      issues: ['Over budget by 200 EUR'],
      suggestedCuts: [],
    },
    budgetTotal: 2200,
    budgetCurrency: 'EUR',
    groupSize: 2,
    targetTotal: 2420,
  };

  it('400 via ValidationError when repairer is not configured', async () => {
    const app = buildApp(); // built without a repairer
    const res = await request(app).post('/repair').send(REPAIR_BODY);
    expect(res.status).toBe(400);
  });

  it('400 when the itinerary is empty', async () => {
    const app = buildAppWithMerger();
    const res = await request(app).post('/repair').send({ ...REPAIR_BODY, itinerary: [] });
    expect(res.status).toBe(400);
  });

  it('400 when financeFeedback is missing', async () => {
    const app = buildAppWithMerger();
    const res = await request(app).post('/repair').send({ ...REPAIR_BODY, financeFeedback: undefined });
    expect(res.status).toBe(400);
  });

  it('200 returns the repair AgentEvent with the edit list', async () => {
    const mockRepair = { ...MOCK_EVENT, type: 'agent.repair', content: { edits: [{ type: 'remove', day: 1, target: 'activity', name: 'X' }] } };
    vi.mocked(mockRepairer.repair).mockResolvedValue(mockRepair as never);

    const app = buildAppWithMerger();
    const res = await request(app).post('/repair').send(REPAIR_BODY);

    expect(res.status).toBe(200);
    expect(res.body.repair.content.edits).toHaveLength(1);
    expect(mockRepairer.repair).toHaveBeenCalledWith(
      VALID_UUID, 2, expect.any(Array), expect.any(Array),
      expect.objectContaining({ overAmountTotal: 200 }),
      2200, 'EUR', 2, 2420,
    );
  });

  it('propagates a repair failure as an error response instead of hanging the request', async () => {
    vi.mocked(mockRepairer.repair).mockRejectedValue(
      new Error('orchestrator agent failed to produce a valid repair edit list after retry'),
    );

    const app = buildAppWithMerger();
    const res = await request(app).post('/repair').send(REPAIR_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('repair edit list');
  });
});
