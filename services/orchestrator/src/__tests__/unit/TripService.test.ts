import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

vi.mock('@/config', () => ({
  config: {
    RABBITMQ_EXCHANGE: 'agent.events',
    RABBITMQ_DEFAULT_USER: 'itinera',
    RABBITMQ_DEFAULT_PASS: 'pass',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: 5672,
    PORT: 3001,
    POSTGRES_PASSWORD: 'pass',
    JWT_SECRET: 'test-secret',
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/data-source', () => ({
  AppDataSource: {
    getRepository: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/services/StateManager');

import { TripService } from '@/services/TripService';
import { StateManager } from '@/services/StateManager';
import type { IOrchestrationEngine } from '@/services/WorkflowEngine';
import { AppDataSource } from '@/data-source';
import { Trip } from '@/entities/Trip';
import { Proposal } from '@/entities/Proposal';
import { AgentLog } from '@/entities/AgentLog';
import { TripMetric } from '@/entities/TripMetric';

const OWNER_ID = 'user-001';
const ADMIN_ID = 'admin-001';

const TRIP_A = {
  id: 'trip-aaa',
  name: 'Paris',
  status: 'draft',
  region: 'europe',
  destinations: [],
  ownerId: OWNER_ID,
  startDate: null,
  endDate: null,
  budgetTotal: null,
  budgetCurrency: 'EUR',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const TRIP_B = {
  id: 'trip-bbb',
  name: 'Tokyo',
  status: 'negotiating',
  region: 'asia',
  destinations: [],
  ownerId: 'other-user',
  startDate: null,
  endDate: null,
  budgetTotal: null,
  budgetCurrency: 'EUR',
  createdAt: new Date('2026-01-02'),
  updatedAt: new Date('2026-01-02'),
};

describe('TripService.listTrips', () => {
  let service: TripService;
  let mockFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const stateManager = new StateManager();
    const engine: IOrchestrationEngine = { run: vi.fn(), setTripService: vi.fn() };
    service = new TripService(stateManager, engine);

    mockFind = vi.fn();
    vi.mocked(AppDataSource.getRepository).mockReturnValue({ find: mockFind } as never);
  });

  it('filters by ownerId for regular user', async () => {
    mockFind.mockResolvedValue([TRIP_A]);

    const result = await service.listTrips(OWNER_ID);

    expect(mockFind).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID },
      order: { createdAt: 'DESC' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('trip-aaa');
  });

  it('omits ownerId filter when isAdmin=true', async () => {
    mockFind.mockResolvedValue([TRIP_A, TRIP_B]);

    const result = await service.listTrips(ADMIN_ID, true);

    expect(mockFind).toHaveBeenCalledWith({
      relations: { owner: true },
      order: { createdAt: 'DESC' },
    });
    expect(result).toHaveLength(2);
  });

  it('returns all trips across owners for admin', async () => {
    mockFind.mockResolvedValue([TRIP_A, TRIP_B]);

    const result = await service.listTrips(ADMIN_ID, true);

    const ids = result.map((t) => t.id);
    expect(ids).toContain('trip-aaa');
    expect(ids).toContain('trip-bbb');
  });

  it('returns empty array when no trips exist', async () => {
    mockFind.mockResolvedValue([]);

    const result = await service.listTrips(OWNER_ID);

    expect(result).toEqual([]);
  });

  it('isAdmin defaults to false — regular user sees own trips only', async () => {
    mockFind.mockResolvedValue([TRIP_A]);

    await service.listTrips(OWNER_ID);

    const call = mockFind.mock.calls[0][0] as { where: { ownerId: string } };
    expect(call.where).toEqual({ ownerId: OWNER_ID });
  });
});

describe('TripService.startOrchestration', () => {
  it('delegates to engine.run with the tripId (happy path)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const engine: IOrchestrationEngine = { run, setTripService: vi.fn() };
    const service = new TripService(new StateManager(), engine);

    service.startOrchestration('trip-123');
    await Promise.resolve();

    expect(run).toHaveBeenCalledWith('trip-123');
  });

  it('swallows engine.run rejection instead of throwing (error scenario)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('agent unreachable'));
    const engine: IOrchestrationEngine = { run, setTripService: vi.fn() };
    const service = new TripService(new StateManager(), engine);

    expect(() => service.startOrchestration('trip-123')).not.toThrow();
    await new Promise((r) => setImmediate(r));

    expect(run).toHaveBeenCalledWith('trip-123');
  });
});

describe('TripService.getTrip (admin debug view)', () => {
  let service: TripService;
  let mockTripFindOne: ReturnType<typeof vi.fn>;
  let mockProposalFind: ReturnType<typeof vi.fn>;
  let mockAgentLogFind: ReturnType<typeof vi.fn>;
  let mockTripMetricFind: ReturnType<typeof vi.fn>;

  const CONFIRMED_TRIP = { ...TRIP_A, id: 'trip-confirmed', status: 'confirmed' };

  beforeEach(() => {
    vi.clearAllMocks();
    const stateManager = new StateManager();
    const engine: IOrchestrationEngine = { run: vi.fn(), setTripService: vi.fn() };
    service = new TripService(stateManager, engine);

    mockTripFindOne = vi.fn().mockResolvedValue(CONFIRMED_TRIP);
    mockProposalFind = vi.fn().mockResolvedValue([]);
    mockAgentLogFind = vi.fn().mockResolvedValue([]);
    mockTripMetricFind = vi.fn().mockResolvedValue([]);

    vi.mocked(AppDataSource.getRepository).mockImplementation((entity: unknown) => {
      if (entity === Trip) return { findOne: mockTripFindOne } as never;
      if (entity === Proposal) return { find: mockProposalFind } as never;
      if (entity === AgentLog) return { find: mockAgentLogFind } as never;
      if (entity === TripMetric) return { find: mockTripMetricFind } as never;
      throw new Error(`Unexpected entity in getRepository mock: ${String(entity)}`);
    });
  });

  const orchestratorProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
    id: 'prop-orchestrator-1',
    tripId: CONFIRMED_TRIP.id,
    agent: 'orchestrator',
    round: 1,
    content: {
      itinerary: [{ day: 1, city: 'Barcelona', activities: [{ activity: 'Sagrada Familia', agent: 'alice', time: 'morning' }] }],
      decisions: [
        { proposalId: 'sp-alice-1', agent: 'alice', city: 'Barcelona', date: '2026-07-01', slot: 'morning', activity: 'Sagrada Familia', status: 'accepted', reason: 'Included in the final itinerary.' },
        { proposalId: 'sp-bob-1', agent: 'bob', city: 'Barcelona', date: '2026-07-01', slot: 'afternoon', activity: 'Beach day', status: 'rejected', reason: 'Budget, duplicate, or a competing proposal was preferred.' },
      ],
      satisfactionEstimates: { alice: 1, bob: 0 },
    },
    score: null,
    status: 'pending',
    action: 'propose',
    reasoning: 'Structural route plan generated',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  } as Proposal);

  const financeVerdictProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
    id: 'prop-finance-2',
    tripId: CONFIRMED_TRIP.id,
    agent: 'finance',
    round: 2,
    content: { verdict: { approved: true, budgetFeasible: true } },
    score: null,
    status: 'pending',
    action: 'accept',
    reasoning: 'Within budget',
    createdAt: new Date('2026-06-01T10:05:00Z'),
    updatedAt: new Date('2026-06-01T10:05:00Z'),
    ...overrides,
  } as Proposal);

  const agentLog = (overrides: Partial<AgentLog> = {}): AgentLog => ({
    id: 'log-1',
    tripId: CONFIRMED_TRIP.id,
    agent: 'orchestrator',
    round: 1,
    action: 'merge',
    latencyMs: 500,
    tokensUsed: 1200,
    reasoning: null,
    createdAt: new Date('2026-06-01T10:00:30Z'),
    ...overrides,
  } as AgentLog);

  const tripMetric = (overrides: Partial<TripMetric> = {}): TripMetric => ({
    id: 'metric-1',
    tripId: CONFIRMED_TRIP.id,
    round: 2,
    consensusScore: 82,
    conflictCount: 0,
    convergenceRounds: 1,
    forcedConvergence: false,
    financeBlockCount: 1,
    logisticsBlockCount: 0,
    totalTokensUsed: 5000,
    totalTimeMs: 42000,
    metadata: {},
    createdAt: new Date('2026-06-01T10:06:00Z'),
    ...overrides,
  } as TripMetric);

  // ── Happy path ─────────────────────────────────────────────

  it('does not let AgentLog.action clobber the Proposal\'s own action column', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal(), financeVerdictProposal()]);
    mockAgentLogFind.mockResolvedValue([
      agentLog({ agent: 'orchestrator', round: 1, action: 'merge' }),
      agentLog({ id: 'log-2', agent: 'finance', round: 2, action: 'review' }),
    ]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    const orchestratorDto = result.proposals.find((p) => p.agent === 'orchestrator');
    const financeDto = result.proposals.find((p) => p.agent === 'finance');
    expect(orchestratorDto?.action).toBe('propose');
    expect(financeDto?.action).toBe('accept');
  });

  it('derives commits from orchestrator decisions plus the finance verdict', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal(), financeVerdictProposal()]);
    mockAgentLogFind.mockResolvedValue([agentLog(), agentLog({ id: 'log-2', agent: 'finance', round: 2, action: 'review' })]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.commits).toHaveLength(3);
    expect(result.commits.find((c) => c.id === 'sp-alice-1')?.action).toBe('accepted');
    expect(result.commits.find((c) => c.id === 'sp-bob-1')?.action).toBe('rejected');
    expect(result.commits.find((c) => c.agent === 'finance')?.action).toBe('accept');
  });

  it('wires per-agent win-rate scores from satisfactionEstimates', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal()]);
    mockAgentLogFind.mockResolvedValue([agentLog()]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.scores).toEqual(
      expect.arrayContaining([
        { agent: 'alice', winRate: 1 },
        { agent: 'bob', winRate: 0 },
      ]),
    );
  });

  it('surfaces totalTimeMs and block counts from the latest TripMetric row', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal(), financeVerdictProposal()]);
    mockAgentLogFind.mockResolvedValue([agentLog()]);
    mockTripMetricFind.mockResolvedValue([tripMetric({ totalTimeMs: 42000, financeBlockCount: 2, logisticsBlockCount: 1 })]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.metrics[0]).toMatchObject({
      totalTimeMs: 42000,
      financeBlockCount: 2,
      logisticsBlockCount: 1,
    });
  });

  // ── Error / edge scenarios ─────────────────────────────────

  it('returns empty commits and scores when no orchestrator proposal exists (workflow crashed pre-merge)', async () => {
    mockProposalFind.mockResolvedValue([]);
    mockAgentLogFind.mockResolvedValue([]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.commits).toEqual([]);
    expect(result.scores).toEqual([]);
  });

  it('does not throw when content.decisions is missing or malformed', async () => {
    mockProposalFind.mockResolvedValue([
      orchestratorProposal({ content: { itinerary: [], decisions: 'not-an-array' } as unknown as Record<string, unknown> }),
    ]);
    mockAgentLogFind.mockResolvedValue([]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.commits).toEqual([]);
  });

  it('returns empty scores when satisfactionEstimates is missing', async () => {
    mockProposalFind.mockResolvedValue([
      orchestratorProposal({ content: { itinerary: [], decisions: [] } as unknown as Record<string, unknown> }),
    ]);
    mockAgentLogFind.mockResolvedValue([]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.scores).toEqual([]);
  });

  it('returns an empty metrics array (not a crash) when no TripMetric row exists yet', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal()]);
    mockAgentLogFind.mockResolvedValue([agentLog()]);
    mockTripMetricFind.mockResolvedValue([]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, true) as import('@/services/TripService').TripDebugView;

    expect(result.metrics).toEqual([]);
  });

  it('returns a plain TripSummary with no debug fields for non-admin callers', async () => {
    mockProposalFind.mockResolvedValue([orchestratorProposal()]);

    const result = await service.getTrip(CONFIRMED_TRIP.id, false);

    expect(result).not.toHaveProperty('commits');
    expect(result).not.toHaveProperty('scores');
    expect(mockProposalFind).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the trip does not exist', async () => {
    mockTripFindOne.mockResolvedValue(null);

    await expect(service.getTrip('missing-trip', true)).rejects.toThrow();
  });
});

describe('TripService.createTrip', () => {
  let service: TripService;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockSave: (entity: unknown) => Promise<unknown>;

  const BASE_INPUT = {
    name: 'Lisbon',
    destinations: [{ country: 'Portugal', city: 'Lisbon', nights: 3 }],
    budgetCurrency: 'EUR' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const stateManager = new StateManager();
    const engine: IOrchestrationEngine = { run: vi.fn(), setTripService: vi.fn() };
    service = new TripService(stateManager, engine);

    // Every repository shares one `create` spy so both the trip and the
    // traveller rows it is asked to build can be asserted from one place.
    mockCreate = vi.fn((entity: unknown) => entity);
    mockSave = async (entity: unknown): Promise<unknown> =>
      Array.isArray(entity)
        ? entity
        : { id: 'trip-new', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...(entity as object) };
    vi.mocked(AppDataSource.getRepository).mockReturnValue({ create: mockCreate } as never);
    vi.mocked(AppDataSource.transaction).mockImplementation(
      async (cb: unknown) => (cb as (m: { save: typeof mockSave }) => Promise<unknown>)({ save: mockSave }),
    );
  });

  const createdTrip = (): Record<string, unknown> =>
    mockCreate.mock.calls.map((c) => c[0] as Record<string, unknown>).find((e) => 'ownerId' in e)!;
  const createdTravellers = (): Array<Record<string, unknown>> =>
    mockCreate.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((e) => 'tripId' in e);

  it('persists the trip-level brief once, not per traveller', async () => {
    await service.createTrip(OWNER_ID, {
      ...BASE_INPUT,
      preferences: { pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] },
      travellers: [
        { name: 'Ana', preferences: { persona: 'culture' } },
        { name: 'Bruno', preferences: { persona: 'gastronomy' } },
      ],
    } as never);

    expect(createdTrip().preferences).toEqual({ pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] });
    for (const traveller of createdTravellers()) {
      expect(traveller.preferences).not.toHaveProperty('pace');
      expect(traveller.preferences).not.toHaveProperty('mustHaves');
    }
  });

  it('persists each traveller name so per-traveller output can be labelled', async () => {
    await service.createTrip(OWNER_ID, {
      ...BASE_INPUT,
      travellers: [{ name: 'Ana', preferences: {} }, { preferences: {} }],
    } as never);

    expect(createdTravellers().map((t) => t.name)).toEqual(['Ana', null]);
  });

  it('error: defaults an absent brief to an empty blob rather than failing', async () => {
    await service.createTrip(OWNER_ID, { ...BASE_INPUT, travellers: [{ preferences: {} }] } as never);

    expect(createdTrip().preferences).toEqual({});
  });

  it('error: a trip with no travellers still persists', async () => {
    await service.createTrip(OWNER_ID, { ...BASE_INPUT, preferences: { pace: 'high' } } as never);

    expect(createdTravellers()).toHaveLength(0);
    expect(createdTrip().preferences).toEqual({ pace: 'high' });
  });
});
