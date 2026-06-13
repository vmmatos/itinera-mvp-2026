/**
 * SQL injection safety — ProposalStorageService (#30)
 *
 * Verifies that `createQueryBuilder` uses named-parameter placeholders
 * (`:tripId`, `:round`) and never interpolates user input into the query
 * string itself. This pattern is shared across validator, finance-agent,
 * and logistics-agent ProposalStorageService implementations.
 *
 * The assertion strategy:
 *   - Capture the arguments passed to `where()` and `andWhere()`
 *   - Assert the query STRING contains the `:paramName` placeholder (not the value)
 *   - Assert the parameter OBJECT contains the user input as a bound value
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
    POSTGRES_PASSWORD: 'pass',
    RABBITMQ_DEFAULT_USER: 'itinera',
    RABBITMQ_DEFAULT_PASS: 'pass',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_PORT: 5672,
    RABBITMQ_EXCHANGE: 'agent.events',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/data-source', () => ({
  AppDataSource: { getRepository: vi.fn() },
}));

import { ProposalStorageService } from '@/services/ProposalStorageService';
import { AppDataSource } from '@/data-source';

// Canonical SQL injection probe
const INJECT = "'; DROP TABLE proposals; --";
const INJECT_ROUND = "1; DROP TABLE proposals; --" as unknown as number;

describe('ProposalStorageService — SQL injection safety (security audit #30)', () => {
  let service: ProposalStorageService;
  let mockWhere: ReturnType<typeof vi.fn>;
  let mockAndWhere: ReturnType<typeof vi.fn>;
  let mockGetOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetOne = vi.fn().mockResolvedValue(null);
    mockAndWhere = vi.fn().mockReturnThis();
    mockWhere = vi.fn().mockReturnValue({
      andWhere: mockAndWhere,
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getOne: mockGetOne,
    });

    vi.mocked(AppDataSource.getRepository).mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue({
        where: mockWhere,
        andWhere: mockAndWhere,
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getOne: mockGetOne,
      }),
      create: vi.fn(),
      save: vi.fn(),
    } as never);

    service = new ProposalStorageService();
  });

  describe('findLatestByTripId', () => {
    it('where() query string uses :tripId placeholder, not user value', async () => {
      await service.findLatestByTripId(INJECT);

      const [queryString] = mockWhere.mock.calls[0] as [string, unknown];
      expect(queryString).toContain(':tripId');
      expect(queryString).not.toContain(INJECT);
    });

    it('where() parameter object binds injection string as value (not interpolated)', async () => {
      await service.findLatestByTripId(INJECT);

      const [, params] = mockWhere.mock.calls[0] as [string, { tripId: string }];
      expect(params.tripId).toBe(INJECT);
    });

    it('andWhere() for round uses :round placeholder, not user value', async () => {
      await service.findLatestByTripId(INJECT, INJECT_ROUND);

      // findLatestByTripId calls andWhere twice: once for agent, once for round
      const roundCall = (mockAndWhere.mock.calls as Array<[string, unknown]>).find(
        ([qs]) => qs.includes(':round'),
      );
      expect(roundCall).toBeDefined();
      const [queryString, params] = roundCall as [string, { round: unknown }];
      expect(queryString).toContain(':round');
      expect(queryString).not.toContain(String(INJECT_ROUND));
      expect(params.round).toBe(INJECT_ROUND);
    });

    it('no injection string appears anywhere in the query template strings', async () => {
      await service.findLatestByTripId(INJECT);

      const allQueryStrings = [
        ...(mockWhere.mock.calls as Array<[string, unknown]>).map(([qs]) => qs),
        ...(mockAndWhere.mock.calls as Array<[string, unknown]>).map(([qs]) => qs),
      ];

      for (const qs of allQueryStrings) {
        expect(qs).not.toContain(INJECT);
      }
    });
  });
});
