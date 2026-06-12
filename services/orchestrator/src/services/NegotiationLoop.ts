import { BaseService, PREFERENCE_AGENT_NAMES } from '@itinera/shared';
import type { AgentName } from '@itinera/shared';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import type { AgentTripContext } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';

const NOTIFICATIONS_EXCHANGE = 'notifications';
const ROUTING_KEY_ITINERARY_READY = 'notification.email.itinerary-ready';

const PREFERENCE_AGENTS: AgentName[] = PREFERENCE_AGENT_NAMES;

type RoundName = 'preferences' | 'analyze' | 'propose' | 'finance' | 'logistics' | 'refine';
const ROUNDS: RoundName[] = ['preferences', 'analyze', 'propose', 'finance', 'logistics', 'refine'];

export class NegotiationLoop extends BaseService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly agentCaller: AgentCaller,
    private readonly eventPublisher: EventPublisher,
  ) {
    super('negotiation-loop');
  }

  async run(tripId: string): Promise<void> {
    this.logger.info('Negotiation loop started', { tripId });

    try {
      // Atomic claim: UPDATE SET status='negotiating' WHERE status='draft'
      // Prevents concurrent runs from both passing a non-atomic read+write guard
      const claimed = await this.stateManager.claimNegotiating(tripId);
      if (!claimed) {
        this.logger.warn('Negotiation already claimed by another process, skipping', { tripId });
        return;
      }

      const trip = await this.stateManager.getTrip(tripId);
      const tripContext: AgentTripContext = {
        budgetTotal: trip?.budgetTotal ?? null,
        budgetCurrency: trip?.budgetCurrency ?? 'EUR',
        region: trip?.region ?? null,
      };

      const agentContext = this.buildAgentContext(trip);

      let latestProposal: Record<string, unknown> = {};

      for (let i = 0; i < ROUNDS.length; i++) {
        const round = i + 1;
        const roundName = ROUNDS[i] as RoundName;
        this.logger.info('Round started', { tripId, round, roundName });

        switch (roundName) {
          case 'preferences':
            latestProposal = await this.runPreferencesRound(tripId, round, agentContext);
            break;
          case 'analyze':
            latestProposal = await this.runAnalyzeRound(tripId, round, [latestProposal]);
            break;
          case 'propose':
            latestProposal = await this.runProposeRound(tripId, round, latestProposal, agentContext);
            break;
          case 'finance':
            latestProposal = await this.runFinanceRound(tripId, round, latestProposal, tripContext);
            break;
          case 'logistics':
            latestProposal = await this.runLogisticsRound(tripId, round, latestProposal, tripContext);
            break;
          case 'refine':
            latestProposal = await this.runRefineRound(tripId, round, latestProposal);
            break;
        }

        await this.stateManager.saveMetric({
          tripId,
          round,
          metadata: { roundName, proposal: latestProposal },
        });
      }

      await this.stateManager.transitionStatus(tripId, 'confirmed');

      if (trip?.owner?.email) {
        await this.eventPublisher.publishToExchange(
          NOTIFICATIONS_EXCHANGE,
          ROUTING_KEY_ITINERARY_READY,
          {
            type: 'itinerary-ready',
            to: trip.owner.email,
            data: {
              firstName: trip.owner.name?.split(' ')[0] ?? 'Traveller',
              tripName: trip.name,
              tripId,
            },
          },
        );
      } else {
        this.logger.warn('Trip owner email missing — skipping itinerary-ready notification', { tripId });
      }

      this.logger.info('Negotiation loop completed', { tripId });
    } catch (err) {
      this.logger.error('Negotiation loop failed', { tripId, error: String(err) });
      await this.stateManager.transitionStatus(tripId, 'cancelled').catch(() => undefined);
    }
  }

  private buildAgentContext(trip: import('@/entities/Trip').Trip | null): string {
    if (!trip) return '';

    const destinations = trip.destinations ?? [];
    const totalNights = destinations.reduce((s, d) => s + d.nights, 0);
    const budgetPerNight = trip.budgetTotal && totalNights > 0
      ? Math.round(trip.budgetTotal / totalNights)
      : null;

    const lines: string[] = [`TRIP: ${trip.name}`];

    if (destinations.length > 1) {
      lines.push(`\nDESTINATIONS (MANDATORY — you MUST plan exclusively within these places, in this order):`);
      let day = 1;
      for (const d of destinations) {
        const label = d.city ? `${d.city}, ${d.country}` : d.country;
        lines.push(`  Days ${day}–${day + d.nights - 1}: ${label} (${d.nights} night${d.nights !== 1 ? 's' : ''})`);
        day += d.nights;
      }
      lines.push(`  Total: ${totalNights} nights across ${new Set(destinations.map((d) => d.country)).size} countr${new Set(destinations.map((d) => d.country)).size === 1 ? 'y' : 'ies'}`);
    } else if (destinations.length === 1) {
      const d = destinations[0];
      const label = d.city ? `${d.city}, ${d.country}` : d.country;
      lines.push(`DESTINATION (MANDATORY — plan exclusively here): ${label} (${d.nights} nights)`);
    } else {
      lines.push(`DESTINATION (MANDATORY): ${trip.region ?? 'unknown'}`);
    }

    lines.push(`\nDATES: ${trip.startDate ? String(trip.startDate).slice(0, 10) : 'TBD'} → ${trip.endDate ? String(trip.endDate).slice(0, 10) : 'TBD'}`);
    lines.push(`BUDGET: ${trip.budgetTotal ?? '?'} ${trip.budgetCurrency}${budgetPerNight ? ` (≈ ${trip.budgetCurrency} ${budgetPerNight}/night)` : ''}`);
    const rawPace = (trip.travellers?.[0]?.preferences as Record<string, unknown>)?.['pace'];
    const paceLabel = rawPace === 'low' ? 'slow' : rawPace === 'high' ? 'packed' : 'moderate';
    lines.push(`PACE: ${paceLabel} (${rawPace === 'low' ? 'relaxed schedule, few activities/day' : rawPace === 'high' ? 'full schedule, many activities/day' : '2–3 activities/day'})`);
    lines.push(`GROUP SIZE: ${trip.travellers?.length ?? 1} traveller(s)`);

    if (destinations.length > 1) {
      lines.push(`\nLOGISTICS NOTE: Plan transit between destinations. Each country segment has a fixed duration — do not extend or skip any leg.`);
    }

    if (trip.travellers?.length) {
      lines.push('\nGROUP PREFERENCES:');
      for (const t of trip.travellers) {
        const p = t.preferences as Record<string, unknown>;
        lines.push(`  - Persona: ${String(p['persona'] ?? 'general')}, Flexibility: ${String(p['flexibility'] ?? 'medium')}`);
        if (Array.isArray(p['mustHaves']) && p['mustHaves'].length) {
          lines.push(`    Must-haves: ${(p['mustHaves'] as string[]).join(', ')}`);
        }
        if (Array.isArray(p['dealBreakers']) && p['dealBreakers'].length) {
          lines.push(`    Deal-breakers: ${(p['dealBreakers'] as string[]).join(', ')}`);
        }
      }
    }

    return lines.join('\n');
  }

  private async runPreferencesRound(
    tripId: string,
    round: number,
    agentContext: string,
  ): Promise<Record<string, unknown>> {
    const results = await Promise.all(
      PREFERENCE_AGENTS.map(async (agentName) => {
        const start = Date.now();
        const result = await this.agentCaller.callPreferenceAgent(tripId, agentName, round, agentContext);
        await this.stateManager.saveProposal({ tripId, agent: agentName, round, content: result.content });
        await this.stateManager.logAgentCall({
          tripId,
          agent: agentName,
          round,
          action: 'propose',
          latencyMs: Date.now() - start,
          tokensUsed: result.tokensUsed,
          reasoning: result.reasoning,
        });
        return result.content;
      }),
    );
    return { preferences: results };
  }

  private async runAnalyzeRound(
    tripId: string,
    round: number,
    proposals: Record<string, unknown>[],
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorAgent(tripId, round, proposals);
    await this.stateManager.saveProposal({ tripId, agent: 'orchestrator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'orchestrator',
      round,
      action: 'propose',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return result.content;
  }

  private async runProposeRound(
    tripId: string,
    round: number,
    conflicts: Record<string, unknown>,
    agentContext: string,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorPropose(tripId, round, conflicts, agentContext);
    await this.stateManager.saveProposal({ tripId, agent: 'orchestrator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'orchestrator',
      round,
      action: 'propose',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return result.content;
  }

  private async runFinanceRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext: AgentTripContext,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callFinanceAgent(tripId, round, proposal, tripContext);
    await this.stateManager.saveProposal({ tripId, agent: 'finance', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'finance',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, finance: result.content };
  }

  private async runLogisticsRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext: AgentTripContext,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callLogisticsAgent(tripId, round, proposal, tripContext);
    await this.stateManager.saveProposal({ tripId, agent: 'logistics', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'logistics',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, logistics: result.content };
  }

  private async runRefineRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    const result = await this.agentCaller.callValidatorAgent(tripId, round, proposal);
    await this.stateManager.saveProposal({ tripId, agent: 'validator', round, content: result.content });
    await this.stateManager.logAgentCall({
      tripId,
      agent: 'validator',
      round,
      action: 'score',
      latencyMs: Date.now() - start,
      tokensUsed: result.tokensUsed,
      reasoning: result.reasoning,
    });
    return { ...proposal, validation: result.content };
  }
}
