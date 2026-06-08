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
vi.mock('@/services/NegotiationLoop');

import { TripService } from '@/services/TripService';
import { StateManager } from '@/services/StateManager';
import { NegotiationLoop } from '@/services/NegotiationLoop';
import { AppDataSource } from '@/data-source';

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
    const stateManager = new StateManager({} as never, {} as never);
    const loop = new NegotiationLoop({} as never, {} as never);
    service = new TripService(stateManager, loop);

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
