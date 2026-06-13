/**
 * SQL injection safety — TripService (#30)
 *
 * Verifies that user-controlled input is always passed as a bound parameter
 * to TypeORM repository methods (.find / .findOne), never interpolated into
 * the query string itself.
 *
 * Pattern: TypeORM's find-options (`{ where: { column: value } }`) hands the
 * value to the driver as a prepared-statement parameter. These tests assert
 * that injection strings reach the repository call unchanged (bound), not that
 * TypeORM executes them (that would require a real DB).
 */

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
    JWT_SECRET: 'test-secret',
    RABBITMQ_EXCHANGE: 'agent.events',
    RABBITMQ_DEFAULT_USER: 'itinera',
    RABBITMQ_DEFAULT_PASS: 'pass',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: 5672,
    PORT: 3001,
    POSTGRES_PASSWORD: 'pass',
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/data-source', () => ({
  AppDataSource: { getRepository: vi.fn(), transaction: vi.fn() },
}));

vi.mock('@/services/StateManager');
vi.mock('@/services/NegotiationLoop');

import { TripService } from '@/services/TripService';
import { StateManager } from '@/services/StateManager';
import { NegotiationLoop } from '@/services/NegotiationLoop';
import { AppDataSource } from '@/data-source';

// Canonical SQL injection probe — chosen because it would break a naive interpolated query
const INJECT = "'; DROP TABLE trips; --";
const INJECT_ID = "00000000-0000-0000-0000-' OR '1'='1";

describe('TripService — SQL injection safety (security audit #30)', () => {
  let service: TripService;
  let mockFind: ReturnType<typeof vi.fn>;
  let mockFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    const stateManager = new StateManager({} as never, {} as never);
    const loop = new NegotiationLoop({} as never, {} as never);
    service = new TripService(stateManager, loop);

    mockFind = vi.fn().mockResolvedValue([]);
    mockFindOne = vi.fn().mockResolvedValue(null);

    vi.mocked(AppDataSource.getRepository).mockReturnValue({
      find: mockFind,
      findOne: mockFindOne,
    } as never);
  });

  describe('listTrips', () => {
    it('passes injection string as bound where-value, not query string', async () => {
      await service.listTrips(INJECT);

      const [[findArg]] = mockFind.mock.calls as [[{ where: { ownerId: string } }]];
      // The repo receives the injection string as a parameter object value
      expect(findArg.where.ownerId).toBe(INJECT);
    });

    it('no string interpolation: find() receives where-object, not a raw SQL string', async () => {
      await service.listTrips(INJECT);

      const [[findArg]] = mockFind.mock.calls;
      // If interpolation happened, the first arg would be a string like "... WHERE ownerId = '...'"
      expect(typeof findArg).toBe('object');
      expect(typeof (findArg as { where?: unknown }).where).toBe('object');
    });
  });

  describe('getTrip', () => {
    it('passes injection string as bound id-value', async () => {
      await service.getTrip(INJECT_ID, false).catch(() => {});

      const [[findOneArg]] = mockFindOne.mock.calls as [[{ where: { id: string } }]];
      expect(findOneArg.where.id).toBe(INJECT_ID);
    });
  });

  describe('getTripProposals', () => {
    it('passes injection string as bound tripId-value', async () => {
      await service.getTripProposals(INJECT_ID);

      const [[findArg]] = mockFind.mock.calls as [[{ where: { tripId: string } }]];
      expect(findArg.where.tripId).toBe(INJECT_ID);
    });
  });

  describe('updateTripStatus', () => {
    it('passes both injection strings as separate bound parameters', async () => {
      await service.updateTripStatus(INJECT_ID, INJECT, 'cancelled').catch(() => {});

      const [[findOneArg]] = mockFindOne.mock.calls as [[{ where: { id: string; ownerId: string } }]];
      // Both user-supplied values arrive as bound parameters in the where object
      expect(findOneArg.where.id).toBe(INJECT_ID);
      expect(findOneArg.where.ownerId).toBe(INJECT);
    });
  });
});
