import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

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

import { TripController } from '@/controllers/TripController';
import type { TripService } from '@/services/TripService';

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-001';
const ADMIN_ID = 'admin-001';
const OTHER_USER_ID = 'other-user-002';

const makeReq = (
  role: 'admin' | 'user' | 'service',
  userId: string,
  opts: { query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {},
): Request =>
  ({
    user: { sub: userId, role },
    query: opts.query ?? {},
    params: opts.params ?? {},
    body: opts.body ?? {},
    headers: {},
  }) as unknown as Request;

const makeRes = (): Response => {
  const res = { json: vi.fn(), status: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
};

const makeNext = (): NextFunction => vi.fn() as unknown as NextFunction;

describe('TripController — admin role isolation (security audit #30)', () => {
  let controller: TripController;
  let svc: {
    listTrips: ReturnType<typeof vi.fn>;
    createTrip: ReturnType<typeof vi.fn>;
    getTrip: ReturnType<typeof vi.fn>;
    getTripProposals: ReturnType<typeof vi.fn>;
    startOrchestration: ReturnType<typeof vi.fn>;
    updateTripStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = {
      listTrips: vi.fn().mockResolvedValue([]),
      createTrip: vi.fn().mockResolvedValue({ id: TRIP_ID, status: 'draft' }),
      getTrip: vi.fn().mockResolvedValue({ id: TRIP_ID, ownerId: USER_ID }),
      getTripProposals: vi.fn().mockResolvedValue([]),
      startOrchestration: vi.fn(),
      updateTripStatus: vi.fn(),
    };
    controller = new TripController(svc as unknown as TripService);
  });

  // -------------------------------------------------------------------------
  // listTrips — admin view flag
  // -------------------------------------------------------------------------
  describe('listTrips', () => {
    it('happy path: admin + ?view=admin passes isAdmin=true to service', async () => {
      const req = makeReq('admin', ADMIN_ID, { query: { view: 'admin' } });
      await controller.listTrips(req, makeRes(), makeNext());
      expect(svc.listTrips).toHaveBeenCalledWith(ADMIN_ID, true);
    });

    it('happy path: admin without view param passes isAdmin=false', async () => {
      const req = makeReq('admin', ADMIN_ID);
      await controller.listTrips(req, makeRes(), makeNext());
      expect(svc.listTrips).toHaveBeenCalledWith(ADMIN_ID, false);
    });

    it('security: role=user with ?view=admin passes isAdmin=false — admin flag blocked', async () => {
      const req = makeReq('user', USER_ID, { query: { view: 'admin' } });
      await controller.listTrips(req, makeRes(), makeNext());
      expect(svc.listTrips).toHaveBeenCalledWith(USER_ID, false);
    });

    it('security: role=user without view param passes isAdmin=false', async () => {
      const req = makeReq('user', USER_ID);
      await controller.listTrips(req, makeRes(), makeNext());
      expect(svc.listTrips).toHaveBeenCalledWith(USER_ID, false);
    });
  });

  // -------------------------------------------------------------------------
  // getTrip — debug view flag
  // -------------------------------------------------------------------------
  describe('getTrip', () => {
    it('happy path: admin + ?view=debug passes isAdmin=true', async () => {
      const req = makeReq('admin', ADMIN_ID, { params: { id: TRIP_ID }, query: { view: 'debug' } });
      await controller.getTrip(req, makeRes(), makeNext());
      expect(svc.getTrip).toHaveBeenCalledWith(TRIP_ID, true);
    });

    it('happy path: admin without view param passes isAdmin=false', async () => {
      const req = makeReq('admin', ADMIN_ID, { params: { id: TRIP_ID } });
      await controller.getTrip(req, makeRes(), makeNext());
      expect(svc.getTrip).toHaveBeenCalledWith(TRIP_ID, false);
    });

    it('security: role=user with ?view=debug passes isAdmin=false — debug mode blocked', async () => {
      const req = makeReq('user', USER_ID, { params: { id: TRIP_ID }, query: { view: 'debug' } });
      await controller.getTrip(req, makeRes(), makeNext());
      expect(svc.getTrip).toHaveBeenCalledWith(TRIP_ID, false);
    });
  });

  // -------------------------------------------------------------------------
  // getTripProposals — ownership enforcement
  // -------------------------------------------------------------------------
  describe('getTripProposals', () => {
    it('happy path: trip owner gets proposals', async () => {
      svc.getTrip.mockResolvedValue({ id: TRIP_ID, ownerId: USER_ID });
      svc.getTripProposals.mockResolvedValue([{ id: 'prop-1' }]);
      const res = makeRes();

      await controller.getTripProposals(
        makeReq('user', USER_ID, { params: { id: TRIP_ID } }),
        res,
        makeNext(),
      );

      expect(svc.getTripProposals).toHaveBeenCalledWith(TRIP_ID);
    });

    it('happy path: admin can access another user\'s trip proposals', async () => {
      svc.getTrip.mockResolvedValue({ id: TRIP_ID, ownerId: OTHER_USER_ID });
      const next = makeNext();

      await controller.getTripProposals(
        makeReq('admin', ADMIN_ID, { params: { id: TRIP_ID } }),
        makeRes(),
        next,
      );

      expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(svc.getTripProposals).toHaveBeenCalledWith(TRIP_ID);
    });

    it('security: role=user non-owner gets NotFoundError (not a 403 — hides trip existence)', async () => {
      svc.getTrip.mockResolvedValue({ id: TRIP_ID, ownerId: OTHER_USER_ID });
      const next = makeNext();

      await controller.getTripProposals(
        makeReq('user', USER_ID, { params: { id: TRIP_ID } }),
        makeRes(),
        next,
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404, code: 'NOT_FOUND' }),
      );
      expect(svc.getTripProposals).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // createTrip — input validation
  // -------------------------------------------------------------------------
  describe('createTrip', () => {
    it('happy path: valid body creates trip and returns 202', async () => {
      const res = makeRes();

      await controller.createTrip(
        makeReq('user', USER_ID, { body: { name: 'Paris Trip' } }),
        res,
        makeNext(),
      );

      expect(svc.createTrip).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('error: empty body (missing required name) calls next with error', async () => {
      const next = makeNext();

      await controller.createTrip(
        makeReq('user', USER_ID, { body: {} }),
        makeRes(),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(svc.createTrip).not.toHaveBeenCalled();
    });

    it('error: non-string name calls next with error', async () => {
      const next = makeNext();

      await controller.createTrip(
        makeReq('user', USER_ID, { body: { name: 123 } }),
        makeRes(),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
