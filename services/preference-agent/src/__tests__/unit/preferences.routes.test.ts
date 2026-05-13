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

import { createPreferencesRouter } from '@/routes/preferences';
import type { BaseAgent } from '@/agents/BaseAgent';

const mockAgent = {
  propose: vi.fn(),
  react: vi.fn(),
} as unknown as BaseAgent;

const agents = {
  alice: mockAgent,
  bob: mockAgent,
  carlos: mockAgent,
  diana: mockAgent,
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createPreferencesRouter(agents));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('POST /propose', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('400 when tripId is missing', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ round: 1 });
    expect(res.status).toBe(400);
  });

  it('400 when round is less than 1', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ tripId: VALID_UUID, round: 0 });
    expect(res.status).toBe(400);
  });

  it('400 when tripId is not a UUID', async () => {
    const app = buildApp();
    const res = await request(app).post('/propose').send({ tripId: 'not-a-uuid', round: 1 });
    expect(res.status).toBe(400);
  });

  it('200 returns proposals array', async () => {
    const mockEvent = {
      tripId: VALID_UUID,
      type: 'agent.propose',
      agent: 'alice',
      round: 1,
      timestamp: new Date().toISOString(),
      content: {},
    };
    vi.mocked(mockAgent.propose).mockResolvedValue(mockEvent);

    const app = buildApp();
    const res = await request(app)
      .post('/propose')
      .send({ tripId: VALID_UUID, round: 1, agents: ['alice'] });

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].agent).toBe('alice');
  });

  it('200 runs all agents by default', async () => {
    vi.mocked(mockAgent.propose).mockResolvedValue({
      tripId: VALID_UUID,
      type: 'agent.propose',
      agent: 'alice',
      round: 1,
      timestamp: new Date().toISOString(),
      content: {},
    });

    const app = buildApp();
    const res = await request(app).post('/propose').send({ tripId: VALID_UUID, round: 1 });

    expect(res.status).toBe(200);
    expect(mockAgent.propose).toHaveBeenCalledTimes(4);
  });
});

describe('POST /react', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('400 when proposals array is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/react')
      .send({ tripId: VALID_UUID, round: 1, proposals: [] });
    expect(res.status).toBe(400);
  });

  it('200 returns reactions array', async () => {
    const mockEvent = {
      tripId: VALID_UUID,
      type: 'agent.refine',
      agent: 'alice',
      round: 1,
      timestamp: new Date().toISOString(),
      content: {},
    };
    vi.mocked(mockAgent.react).mockResolvedValue(mockEvent);

    const app = buildApp();
    const res = await request(app)
      .post('/react')
      .send({ tripId: VALID_UUID, round: 1, proposals: [{ foo: 'bar' }], agents: ['alice'] });

    expect(res.status).toBe(200);
    expect(res.body.reactions).toHaveLength(1);
    expect(res.body.reactions[0].type).toBe('agent.refine');
  });
});

describe('GET /profiles', () => {
  it('200 returns 4 agent profiles', async () => {
    const app = buildApp();
    const res = await request(app).get('/profiles');

    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(4);
    const names = res.body.agents.map((a: { name: string }) => a.name);
    expect(names).toContain('alice');
    expect(names).toContain('bob');
    expect(names).toContain('carlos');
    expect(names).toContain('diana');
  });

  it('each profile has name, persona, and preferences', async () => {
    const app = buildApp();
    const res = await request(app).get('/profiles');

    for (const agent of res.body.agents) {
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('persona');
      expect(agent).toHaveProperty('preferences');
      expect(Array.isArray(agent.preferences)).toBe(true);
    }
  });
});
