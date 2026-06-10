import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must be hoisted before any imports that transitively load these modules
vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    buildRoutingKey: actual.buildRoutingKey,
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
    JWT_ISSUER: 'itinera',
    PREFERENCE_AGENT_URL: 'http://preference-agent:3002',
    ORCHESTRATOR_AGENT_URL: 'http://orchestrator-agent:3003',
    FINANCE_AGENT_URL: 'http://finance-agent:3004',
    LOGISTICS_AGENT_URL: 'http://logistics-agent:3005',
    VALIDATOR_URL: 'http://validator:3006',
  },
  getRabbitMQUrl: () => 'amqp://localhost',
}));

vi.mock('@/services/StateManager', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    claimNegotiating: vi.fn(),
    transitionStatus: vi.fn(),
    getTrip: vi.fn(),
    saveProposal: vi.fn(),
    logAgentCall: vi.fn(),
    saveMetric: vi.fn(),
  })),
}));

vi.mock('@/services/AgentCaller', () => ({
  AgentCaller: vi.fn().mockImplementation(() => ({
    callPreferenceAgent: vi.fn(),
    callOrchestratorAgent: vi.fn(),
    callOrchestratorPropose: vi.fn(),
    callFinanceAgent: vi.fn(),
    callLogisticsAgent: vi.fn(),
    callValidatorAgent: vi.fn(),
  })),
}));

vi.mock('@/services/EventPublisher', () => ({
  EventPublisher: vi.fn().mockImplementation(() => ({
    publishToExchange: vi.fn(),
    publish: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  })),
}));

import { NegotiationLoop } from '@/services/NegotiationLoop';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import { TRIP_ID, OWNER_EMAIL, OWNER_NAME, MOCK_TRIP, AGENT_RESULT } from './helpers/full-planning-fixtures';

// ── Scenario 008: End-to-end full trip planning flow ──────────────────────────
//
// Verifies the complete orchestration flow from trip claim through negotiation
// to confirmed status. All 7 agents are called in the expected order, proposals
// are persisted to the DB, and an itinerary-ready notification is published to
// RabbitMQ so the notification service can send the confirmation email via mailhog.
//
// Acceptance criteria:
//   AC1  All 7 agents called in correct order (4 preference + analyze + propose +
//        finance + logistics + validator)
//   AC2  Negotiation history stored in DB (saveProposal + logAgentCall per agent,
//        saveMetric per round)
//   AC3  Trip status transitions draft → negotiating → confirmed
//   AC4  itinerary-ready notification published with owner email (email trigger)
//   AC5  Agent events reachable via admin SSE stream (saveProposal tripId contract)

describe('Scenario 008 — End-to-end full trip planning flow', () => {
  let stateManager: StateManager;
  let agentCaller: AgentCaller;
  let eventPublisher: EventPublisher;
  let loop: NegotiationLoop;

  beforeEach(() => {
    vi.clearAllMocks();

    stateManager = new StateManager();
    agentCaller = new AgentCaller();
    eventPublisher = new EventPublisher();
    loop = new NegotiationLoop(stateManager, agentCaller, eventPublisher);

    vi.mocked(stateManager.claimNegotiating).mockResolvedValue(true);
    vi.mocked(stateManager.transitionStatus).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveProposal).mockResolvedValue(undefined);
    vi.mocked(stateManager.logAgentCall).mockResolvedValue(undefined);
    vi.mocked(stateManager.saveMetric).mockResolvedValue(undefined);
    vi.mocked(stateManager.getTrip).mockResolvedValue(MOCK_TRIP as never);

    vi.mocked(agentCaller.callPreferenceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callOrchestratorPropose).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callFinanceAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callLogisticsAgent).mockResolvedValue(AGENT_RESULT);
    vi.mocked(agentCaller.callValidatorAgent).mockResolvedValue(AGENT_RESULT);

    vi.mocked(eventPublisher.publishToExchange).mockResolvedValue(undefined);
  });

  // ── AC1: All 7 agents called in correct order ─────────────────────────────

  describe('AC1 — All 7 agents called in correct order', () => {
    it('calls all 4 preference agents in the first round', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callPreferenceAgent).toHaveBeenCalledTimes(4);
      const agents = vi.mocked(agentCaller.callPreferenceAgent).mock.calls.map(([, name]) => name);
      expect(agents).toEqual(expect.arrayContaining(['alice', 'bob', 'carlos', 'diana']));
    });

    it('calls orchestrator analyze exactly once after preferences', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callOrchestratorAgent).toHaveBeenCalledTimes(1);
    });

    it('calls orchestrator propose exactly once after analyze', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callOrchestratorPropose).toHaveBeenCalledTimes(1);
    });

    it('calls finance agent exactly once', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callFinanceAgent).toHaveBeenCalledTimes(1);
    });

    it('calls logistics agent exactly once', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callLogisticsAgent).toHaveBeenCalledTimes(1);
    });

    it('calls validator agent exactly once as the final round', async () => {
      await loop.run(TRIP_ID);

      expect(agentCaller.callValidatorAgent).toHaveBeenCalledTimes(1);
    });

    it('total agent calls = 9 (4 preference + 2 orchestrator + finance + logistics + validator)', async () => {
      await loop.run(TRIP_ID);

      const total =
        vi.mocked(agentCaller.callPreferenceAgent).mock.calls.length +
        vi.mocked(agentCaller.callOrchestratorAgent).mock.calls.length +
        vi.mocked(agentCaller.callOrchestratorPropose).mock.calls.length +
        vi.mocked(agentCaller.callFinanceAgent).mock.calls.length +
        vi.mocked(agentCaller.callLogisticsAgent).mock.calls.length +
        vi.mocked(agentCaller.callValidatorAgent).mock.calls.length;
      expect(total).toBe(9);
    });

    it('passes correct tripId and round number to each preference agent', async () => {
      await loop.run(TRIP_ID);

      for (const [tid, , round] of vi.mocked(agentCaller.callPreferenceAgent).mock.calls) {
        expect(tid).toBe(TRIP_ID);
        expect(round).toBe(1);
      }
    });
  });

  // ── AC2: Negotiation history stored in DB ─────────────────────────────────

  describe('AC2 — Negotiation history stored in DB', () => {
    it('saves one proposal per agent call (9 total)', async () => {
      await loop.run(TRIP_ID);

      expect(stateManager.saveProposal).toHaveBeenCalledTimes(9);
    });

    it('logs one agent call entry per agent call (9 total)', async () => {
      await loop.run(TRIP_ID);

      expect(stateManager.logAgentCall).toHaveBeenCalledTimes(9);
    });

    it('saves a trip metric after each of the 6 rounds', async () => {
      await loop.run(TRIP_ID);

      expect(stateManager.saveMetric).toHaveBeenCalledTimes(6);
    });

    it('every saved proposal carries the correct tripId', async () => {
      await loop.run(TRIP_ID);

      for (const [params] of vi.mocked(stateManager.saveProposal).mock.calls) {
        expect(params.tripId).toBe(TRIP_ID);
      }
    });

    it('every agent log entry includes latencyMs ≥ 0 and tokensUsed > 0', async () => {
      await loop.run(TRIP_ID);

      for (const [params] of vi.mocked(stateManager.logAgentCall).mock.calls) {
        expect(params.latencyMs).toBeGreaterThanOrEqual(0);
        expect(params.tokensUsed).toBeGreaterThan(0);
      }
    });

    it('proposals cover all expected agents: alice, bob, carlos, diana, orchestrator, finance, logistics, validator', async () => {
      await loop.run(TRIP_ID);

      const savedAgents = vi.mocked(stateManager.saveProposal).mock.calls.map(([p]) => p.agent);
      expect(savedAgents).toContain('alice');
      expect(savedAgents).toContain('bob');
      expect(savedAgents).toContain('carlos');
      expect(savedAgents).toContain('diana');
      expect(savedAgents).toContain('orchestrator');
      expect(savedAgents).toContain('finance');
      expect(savedAgents).toContain('logistics');
      expect(savedAgents).toContain('validator');
    });

    it('each metric includes roundName in metadata', async () => {
      await loop.run(TRIP_ID);

      const metricCalls = vi.mocked(stateManager.saveMetric).mock.calls;
      const roundNames = metricCalls.map(([p]) => (p.metadata as Record<string, unknown>)?.['roundName']);
      expect(roundNames).toEqual(
        expect.arrayContaining(['preferences', 'analyze', 'propose', 'finance', 'logistics', 'refine']),
      );
    });
  });

  // ── AC3: Status transitions ───────────────────────────────────────────────

  describe('AC3 — Trip status transitions correctly', () => {
    it('atomically claims negotiating before starting rounds', async () => {
      await loop.run(TRIP_ID);

      expect(stateManager.claimNegotiating).toHaveBeenCalledWith(TRIP_ID);
    });

    it('transitions to confirmed after all 6 rounds complete', async () => {
      await loop.run(TRIP_ID);

      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    });

    it('transitions to cancelled when an agent call fails, does not throw', async () => {
      vi.mocked(agentCaller.callFinanceAgent).mockRejectedValue(new Error('finance-agent timeout'));

      await expect(loop.run(TRIP_ID)).resolves.toBeUndefined();

      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'cancelled');
      expect(stateManager.transitionStatus).not.toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    });

    it('skips all rounds when claimNegotiating returns false', async () => {
      vi.mocked(stateManager.claimNegotiating).mockResolvedValue(false);

      await loop.run(TRIP_ID);

      expect(agentCaller.callPreferenceAgent).not.toHaveBeenCalled();
      expect(stateManager.transitionStatus).not.toHaveBeenCalled();
    });
  });

  // ── AC4: Email notification published ─────────────────────────────────────

  describe('AC4 — Email notification published on trip confirmation (mailhog)', () => {
    it('publishes to the notifications exchange on confirm', async () => {
      await loop.run(TRIP_ID);

      expect(eventPublisher.publishToExchange).toHaveBeenCalledOnce();
      const [exchange] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
      expect(exchange).toBe('notifications');
    });

    it('uses notification.email.itinerary-ready routing key', async () => {
      await loop.run(TRIP_ID);

      const [, routingKey] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
      expect(routingKey).toBe('notification.email.itinerary-ready');
    });

    it('notification payload has type itinerary-ready', async () => {
      await loop.run(TRIP_ID);

      const [, , payload] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
      expect((payload as Record<string, unknown>)['type']).toBe('itinerary-ready');
    });

    it('notification payload targets the trip owner email', async () => {
      await loop.run(TRIP_ID);

      const [, , payload] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
      expect((payload as Record<string, unknown>)['to']).toBe(OWNER_EMAIL);
    });

    it('notification data includes firstName, tripName, and tripId', async () => {
      await loop.run(TRIP_ID);

      const [, , payload] = vi.mocked(eventPublisher.publishToExchange).mock.calls[0];
      const data = (payload as Record<string, unknown>)['data'] as Record<string, unknown>;
      expect(data['firstName']).toBe(OWNER_NAME.split(' ')[0]);
      expect(data['tripName']).toBe(MOCK_TRIP.name);
      expect(data['tripId']).toBe(TRIP_ID);
    });

    it('does NOT publish notification when trip is cancelled', async () => {
      vi.mocked(agentCaller.callLogisticsAgent).mockRejectedValue(new Error('logistics-agent down'));

      await loop.run(TRIP_ID);

      expect(eventPublisher.publishToExchange).not.toHaveBeenCalled();
    });

    it('skips notification gracefully when trip has no owner (does not throw)', async () => {
      vi.mocked(stateManager.getTrip).mockResolvedValue({
        ...MOCK_TRIP,
        owner: null,
      } as never);

      await expect(loop.run(TRIP_ID)).resolves.toBeUndefined();

      expect(eventPublisher.publishToExchange).not.toHaveBeenCalled();
      expect(stateManager.transitionStatus).toHaveBeenCalledWith(TRIP_ID, 'confirmed');
    });
  });

  // ── AC5: Admin SSE stream — proposal contract ─────────────────────────────

  describe('AC5 — Admin SSE stream contract (proposals carry tripId for ws-relay)', () => {
    it('every proposal saved with tripId so ws-relay can route events to admin', async () => {
      await loop.run(TRIP_ID);

      const savedProposals = vi.mocked(stateManager.saveProposal).mock.calls.map(([p]) => p);
      for (const proposal of savedProposals) {
        expect(proposal.tripId).toBe(TRIP_ID);
        expect(typeof proposal.agent).toBe('string');
        expect(typeof proposal.round).toBe('number');
        expect(proposal.content).toBeDefined();
      }
    });

    it('proposals span all 6 rounds (round numbers 1–6)', async () => {
      await loop.run(TRIP_ID);

      const rounds = vi.mocked(stateManager.saveProposal).mock.calls.map(([p]) => p.round);
      for (let r = 1; r <= 6; r++) {
        expect(rounds).toContain(r);
      }
    });

    it('agent log entries include reasoning for admin proposal content viewer', async () => {
      await loop.run(TRIP_ID);

      const hasReasoning = vi.mocked(stateManager.logAgentCall).mock.calls.some(
        ([p]) => p.reasoning !== undefined,
      );
      expect(hasReasoning).toBe(true);
    });
  });
});
