import { BaseService, PREFERENCE_AGENT_NAMES } from '@itinera/shared';
import type {
  AgentName,
  TransportMode,
  TransportOption,
  FinanceVerdict,
  LogisticsVerdict,
  NegotiationFeedback,
  RoundCompleteEvent,
  NegotiationCompleteEvent,
  AgentEvent,
} from '@itinera/shared';
import type { Trip } from '@/entities/Trip';
import { config } from '@/config';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import type { AgentTripContext } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import type { TripService } from '@/services/TripService';

const NOTIFICATIONS_EXCHANGE = 'notifications';
const ROUTING_KEY_ITINERARY_READY = 'notification.email.itinerary-ready';

const PREFERENCE_AGENTS: AgentName[] = PREFERENCE_AGENT_NAMES;

// Setup rounds run once before the iterative negotiation begins.
//
// Issue #79's round language ("Orchestrator proposes v1 (round 2)", "converges
// in <=3 rounds") was written before this 3-step preamble existed — it assumed
// propose was round 2 and negotiation started at round 3. ROUND_ANALYZE was
// added afterwards (conflict analysis needed its own persisted Proposal before
// propose), pushing FIRST_NEGOTIATION_ROUND to 4. So: absolute round in this
// file = negotiation-relative round (as used by issue #79) + 3. A trip that
// converges on the very first negotiation evaluation is round 4 here, which is
// the "<=3 rounds" case in the issue's counting, not a violation of it.
const ROUND_PREFERENCES = 1;
const ROUND_ANALYZE = 2;
const ROUND_PROPOSE = 3;
const FIRST_NEGOTIATION_ROUND = 4;

interface AgentStep {
  content: Record<string, unknown>;
  tokensUsed: number;
}

interface ReviewStep extends AgentStep {
  reasoning?: string;
}

export class NegotiationLoop extends BaseService {
  private tripService?: TripService;

  constructor(
    private readonly stateManager: StateManager,
    private readonly agentCaller: AgentCaller,
    private readonly eventPublisher: EventPublisher,
  ) {
    super('negotiation-loop');
  }

  setTripService(tripService: TripService): void {
    this.tripService = tripService;
  }

  async run(tripId: string): Promise<void> {
    this.logger.info('Negotiation loop started', { tripId });
    const loopStart = Date.now();

    try {
      // Atomic claim: UPDATE SET status='negotiating' WHERE status='draft'
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
        dateInput: trip?.dateInput ?? null,
        transportPreference: (trip?.transportPreference as TransportMode) ?? 'best',
        groupSize: trip?.travellers?.length ?? 1,
      };

      // Pre-resolve real transport legs before proposal so the LLM can't invent routes.
      const confirmedLegs = await this.preResolveTransportLegs(trip, tripContext);
      const agentContext = this.buildAgentContext(trip, confirmedLegs);
      const destinations = trip?.destinations ?? [];

      // --- Phase A: setup (run once) ---
      const prefs = await this.runPreferencesRound(tripId, ROUND_PREFERENCES, agentContext);
      const analysis = await this.runAnalyzeRound(tripId, ROUND_ANALYZE, [prefs.content]);
      const proposeStep = await this.runProposeRound(tripId, ROUND_PROPOSE, analysis.content, agentContext);

      let proposal: Record<string, unknown> = proposeStep.content;
      let totalTokensUsed = prefs.tokensUsed + analysis.tokensUsed + proposeStep.tokensUsed;

      // --- Phase B: iterative negotiation (Finance + Logistics in parallel) ---
      let financeBlockCount = 0;
      let logisticsBlockCount = 0;
      let financeVerdict: FinanceVerdict | null = null;
      let converged = false;
      let forcedConvergence = false;
      let flexibleResolved = false;
      let round = FIRST_NEGOTIATION_ROUND;

      for (; round <= config.MAX_ROUNDS; round++) {
        let finance: Awaited<ReturnType<typeof this.reviewFinance>>;
        let logistics: Awaited<ReturnType<typeof this.validateLogistics>>;
        if (round === FIRST_NEGOTIATION_ROUND) {
          // First round: resolve transport first and fold it into the proposal so Finance
          // prices the real legs into the budget (and can block if it overshoots).
          logistics = await this.validateLogistics(tripId, round, proposal, tripContext);
          proposal = this.enforceCanonicalDestinations(
            this.mergeTransportIntoProposal(proposal, logistics.content, confirmedLegs, destinations),
            destinations,
          );
          finance = await this.reviewFinance(tripId, round, proposal, tripContext);
        } else {
          // Both agents evaluate the SAME proposal at the same time.
          [finance, logistics] = await Promise.all([
            this.reviewFinance(tripId, round, proposal, tripContext),
            this.validateLogistics(tripId, round, proposal, tripContext),
          ]);
        }
        totalTokensUsed += finance.tokensUsed + logistics.tokensUsed;
        financeVerdict = finance.verdict;

        if (!finance.verdict.approved) financeBlockCount++;
        if (!logistics.verdict.approved) logisticsBlockCount++;

        // Resolve flexible dates once, from the first logistics assessment.
        if (!flexibleResolved && tripContext.dateInput?.mode === 'flexible') {
          flexibleResolved = await this.maybeResolveFlexibleDates(tripId, logistics.content);
        }

        const roundConverged = finance.verdict.approved && logistics.verdict.approved;
        const isLastRound = round === config.MAX_ROUNDS;

        await this.publishRoundComplete(tripId, round, {
          financeApproved: finance.verdict.approved,
          logisticsApproved: logistics.verdict.approved,
          issues: [...finance.verdict.issues, ...logistics.verdict.warnings],
          converged: roundConverged,
        });

        await this.stateManager.saveMetric({
          tripId,
          round,
          metadata: {
            roundName: 'negotiation',
            financeApproved: finance.verdict.approved,
            logisticsApproved: logistics.verdict.approved,
            proposal,
          },
        });

        if (roundConverged) {
          converged = true;
          break;
        }
        if (isLastRound) {
          forcedConvergence = true;
          break;
        }

        // Fold the chosen transport legs into the proposal so the next Finance
        // round counts their cost (folded #72: transport in budget).
        proposal = this.enforceCanonicalDestinations(
          this.mergeTransportIntoProposal(proposal, logistics.content, confirmedLegs, destinations),
          destinations,
        );

        // Orchestrator refines, driven by the combined feedback.
        const feedback: NegotiationFeedback = {
          financeIssues: finance.verdict.issues,
          logisticsWarnings: logistics.verdict.warnings,
          round,
          remainingRounds: config.MAX_ROUNDS - round,
        };
        const refined = await this.runRefineRound(tripId, round, proposal, feedback, agentContext);
        totalTokensUsed += refined.tokensUsed;
        proposal = refined.content;
      }

      const convergenceRounds = Math.min(round, config.MAX_ROUNDS);

      // --- Phase C: finalize ---
      const validation = await this.runValidationRound(tripId, convergenceRounds, proposal);
      totalTokensUsed += validation.tokensUsed;
      const consensusScore = this.extractConsensusScore(validation.content);
      proposal = { ...proposal, validation: validation.content };

      // Orchestrator's human-like final decision: ship best-effort, unless the
      // budget is impossible even after maximum savings — then reject.
      const budgetImpossible = financeVerdict !== null && financeVerdict.budgetFeasible === false;

      await this.stateManager.saveFinalMetric({
        tripId,
        round: convergenceRounds,
        consensusScore,
        convergenceRounds,
        forcedConvergence,
        financeBlockCount,
        logisticsBlockCount,
        totalTokensUsed,
        totalTimeMs: Date.now() - loopStart,
      });

      if (budgetImpossible) {
        const reason = financeVerdict?.issues.join(' ')
          || 'Budget is unrealistic for this trip. Please increase the budget or reduce the scope.';
        await this.stateManager.rejectTrip(tripId, reason);
        await this.publishNegotiationComplete(tripId, convergenceRounds, {
          rounds: convergenceRounds,
          forcedConvergence,
          consensusScore,
          rejected: true,
        });
        this.logger.info('Negotiation loop completed — trip rejected', { tripId, convergenceRounds });
        return;
      }

      await this.stateManager.transitionStatus(tripId, 'confirmed');
      await this.publishNegotiationComplete(tripId, convergenceRounds, {
        rounds: convergenceRounds,
        forcedConvergence,
        consensusScore,
        rejected: false,
      });

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

      this.logger.info('Negotiation loop completed', { tripId, converged, forcedConvergence, convergenceRounds });
    } catch (err) {
      this.logger.error('Negotiation loop failed', { tripId, error: String(err) });
      await this.stateManager.transitionStatus(tripId, 'cancelled').catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Phase A — setup rounds
  // -------------------------------------------------------------------------

  private async runPreferencesRound(
    tripId: string,
    round: number,
    agentContext: string,
  ): Promise<AgentStep> {
    let tokensUsed = 0;
    const results = await Promise.all(
      PREFERENCE_AGENTS.map(async (agentName) => {
        const start = Date.now();
        const result = await this.agentCaller.callPreferenceAgent(tripId, agentName, round, agentContext);
        tokensUsed += result.tokensUsed;
        await this.stateManager.saveProposal({
          tripId, agent: agentName, round, content: result.content, action: 'propose', reasoning: result.reasoning,
        });
        await this.stateManager.logAgentCall({
          tripId, agent: agentName, round, action: 'propose',
          latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: result.reasoning,
        });
        return result.content;
      }),
    );
    return { content: { preferences: results }, tokensUsed };
  }

  private async runAnalyzeRound(
    tripId: string,
    round: number,
    proposals: Record<string, unknown>[],
  ): Promise<AgentStep> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorAgent(tripId, round, proposals);
    await this.stateManager.saveProposal({
      tripId, agent: 'orchestrator', round, content: result.content, action: 'propose', reasoning: result.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'orchestrator', round, action: 'propose',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: result.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed };
  }

  private async runProposeRound(
    tripId: string,
    round: number,
    conflicts: Record<string, unknown>,
    agentContext: string,
  ): Promise<AgentStep> {
    const start = Date.now();
    const result = await this.agentCaller.callOrchestratorPropose(tripId, round, conflicts, agentContext);
    await this.stateManager.saveProposal({
      tripId, agent: 'orchestrator', round, content: result.content, action: 'propose', reasoning: result.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'orchestrator', round, action: 'propose',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: result.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed };
  }

  // -------------------------------------------------------------------------
  // Phase B — negotiation (parallel finance + logistics, then refine)
  // -------------------------------------------------------------------------

  private async reviewFinance(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext: AgentTripContext,
  ): Promise<ReviewStep & { verdict: FinanceVerdict }> {
    const start = Date.now();
    const result = await this.agentCaller.callFinanceAgent(tripId, round, proposal, tripContext);
    const verdict = this.extractFinanceVerdict(result.content);
    await this.stateManager.saveProposal({
      tripId, agent: 'finance', round, content: result.content,
      action: verdict.approved ? 'accept' : 'reject', reasoning: verdict.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'finance', round, action: 'score',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: verdict.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed, verdict };
  }

  private async validateLogistics(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    tripContext: AgentTripContext,
  ): Promise<ReviewStep & { verdict: LogisticsVerdict }> {
    const start = Date.now();
    const result = await this.agentCaller.callLogisticsAgent(tripId, round, proposal, tripContext);
    const verdict = this.extractLogisticsVerdict(result.content);
    await this.stateManager.saveProposal({
      tripId, agent: 'logistics', round, content: result.content,
      action: verdict.approved ? 'accept' : 'reject', reasoning: verdict.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'logistics', round, action: 'score',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: verdict.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed, verdict };
  }

  private async runRefineRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
    feedback: NegotiationFeedback,
    agentContext: string,
  ): Promise<AgentStep> {
    const start = Date.now();
    const feedbackText = this.formatFeedback(feedback);
    const result = await this.agentCaller.callOrchestratorRefine(tripId, round, proposal, feedbackText, agentContext);
    await this.stateManager.saveProposal({
      tripId, agent: 'orchestrator', round, content: result.content, action: 'refine', reasoning: result.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'orchestrator', round, action: 'refine',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: result.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed };
  }

  // -------------------------------------------------------------------------
  // Phase C — validation
  // -------------------------------------------------------------------------

  private async runValidationRound(
    tripId: string,
    round: number,
    proposal: Record<string, unknown>,
  ): Promise<AgentStep> {
    const start = Date.now();
    const result = await this.agentCaller.callValidatorAgent(tripId, round, proposal);
    await this.stateManager.saveProposal({
      tripId, agent: 'validator', round, content: result.content, action: 'propose', reasoning: result.reasoning,
    });
    await this.stateManager.logAgentCall({
      tripId, agent: 'validator', round, action: 'score',
      latencyMs: Date.now() - start, tokensUsed: result.tokensUsed, reasoning: result.reasoning,
    });
    return { content: result.content, tokensUsed: result.tokensUsed };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Issue #79 names the loop-continuation fields `withinBudget`/`feasible`;
  // this codebase computes a single composite `approved` boolean per agent
  // instead (FinanceVerdict.approved is false whenever issues is non-empty;
  // LogisticsVerdict.approved also folds in a `highRisk` check that isn't
  // reducible to `warnings.length > 0` alone). `!approved` is the actual
  // loop-continuation condition — a superset of the issue's four OR'd
  // conditions, not a different behavior.
  private extractFinanceVerdict(content: Record<string, unknown>): FinanceVerdict {
    const v = content['verdict'] as Partial<FinanceVerdict> | undefined;
    if (v && typeof v.approved === 'boolean' && typeof v.budgetFeasible === 'boolean') {
      return { approved: v.approved, budgetFeasible: v.budgetFeasible, issues: v.issues ?? [], reasoning: v.reasoning ?? '' };
    }
    // Defensive fallback if a verdict is missing — treat as unresolved, not fatal.
    return { approved: false, budgetFeasible: true, issues: ['Finance verdict missing'], reasoning: 'No finance verdict returned' };
  }

  private extractLogisticsVerdict(content: Record<string, unknown>): LogisticsVerdict {
    const v = content['verdict'] as Partial<LogisticsVerdict> | undefined;
    if (v && typeof v.approved === 'boolean') {
      return { approved: v.approved, warnings: v.warnings ?? [], reasoning: v.reasoning ?? '' };
    }
    return { approved: false, warnings: ['Logistics verdict missing'], reasoning: 'No logistics verdict returned' };
  }

  private extractConsensusScore(content: Record<string, unknown>): number {
    const scoring = content['scoring'] as { overallScore?: number } | undefined;
    return typeof scoring?.overallScore === 'number' ? scoring.overallScore : 0;
  }

  private formatFeedback(feedback: NegotiationFeedback): string {
    const lines = [
      `Round ${feedback.round} — ${feedback.remainingRounds} round(s) remaining before forced convergence.`,
    ];
    lines.push('', 'FINANCE ISSUES:');
    lines.push(feedback.financeIssues.length ? feedback.financeIssues.map((i) => `- ${i}`).join('\n') : '- none');
    lines.push('', 'LOGISTICS WARNINGS:');
    lines.push(feedback.logisticsWarnings.length ? feedback.logisticsWarnings.map((w) => `- ${w}`).join('\n') : '- none');
    return lines.join('\n');
  }

  // Inject the chosen (cheapest/best) transport leg into each day's transport so
  // the next Finance round includes its cost in the budget (folded #72).
  // confirmedLegs (pre-resolved from trip.destinations before negotiations start)
  // are preferred over logistics-derived options because they use the canonical city
  // names from DestinationParser, avoiding LLM-generated name variants like
  // 'Mértola, Portugal' that break getHubs lookups.
  private mergeTransportIntoProposal(
    proposal: Record<string, unknown>,
    logisticsContent: Record<string, unknown>,
    confirmedLegs: Record<string, TransportOption[]> = {},
    destinations: Array<{ country: string; city?: string; nights: number }> = [],
  ): Record<string, unknown> {
    const logisticsOptions = logisticsContent['transportOptions'] as
      Record<string, TransportOption[]> | undefined;

    const itinerary = Array.isArray(proposal['itinerary'])
      ? (proposal['itinerary'] as Array<Record<string, unknown>>)
      : [];

    // Multi-destination trips: inject transport DETERMINISTICALLY from the
    // canonical destination schedule, not from the LLM's cityTransition. The
    // LLM names transitions with arbitrary towns ("Cogne, Valle d'Aosta") that
    // never match the canonical confirmed-leg keys ("Vale De Aosta"), leaving
    // every leg unmatched. Driving off destinations guarantees the pre-resolved
    // legs (real flights/trains, or the feasibility-guard flight estimate) land
    // on the correct travel day.
    if (destinations.length >= 2) {
      const byDay = new Map<number, Record<string, unknown>>();
      for (const day of itinerary) {
        const n = typeof day['day'] === 'number' ? day['day'] : null;
        if (n !== null) byDay.set(n, day);
      }
      // First day-number of each destination (transition lands on dest[i]'s start).
      const startDay: number[] = [];
      let cursor = 1;
      for (const d of destinations) {
        startDay.push(cursor);
        cursor += d.nights;
      }
      const transitionDays = new Set<number>();

      for (let i = 1; i < destinations.length; i++) {
        const fromCity = destinations[i - 1]!.city ?? destinations[i - 1]!.country;
        const toCity = destinations[i]!.city ?? destinations[i]!.country;
        const tDayNum = startDay[i]!;
        const tDay = byDay.get(tDayNum);
        if (!tDay) continue;

        const options =
          this.findInConfirmedLegs(fromCity, toCity, confirmedLegs) ??
          logisticsOptions?.[String(tDayNum)];
        const best = options?.[0];
        if (!best || best.durationMinutes === 0) continue;

        transitionDays.add(tDayNum);
        tDay['transport'] = [this.buildTransportLeg(fromCity, toCity, best, options!)];
        tDay['cityTransition'] = { to: toCity, travelTime: this.travelTimeLabel(best) };
        this.snapTravelSlot(tDay, best.departureTime);
      }

      // Drop stray LLM cityTransitions on non-travel days (e.g. a buried
      // "Cogne" hop) so the timeline only shows real inter-destination moves.
      for (const day of itinerary) {
        const n = typeof day['day'] === 'number' ? day['day'] : null;
        if (n !== null && !transitionDays.has(n) && day['cityTransition']) {
          delete day['cityTransition'];
        }
      }
      return { ...proposal, itinerary };
    }

    // Single-destination / no schedule: fall back to per-day cityTransition.
    for (const day of itinerary) {
      const dayNum = typeof day['day'] === 'number' ? day['day'] : null;
      if (dayNum === null) continue;
      const to = String((day['cityTransition'] as Record<string, unknown> | undefined)?.['to'] ?? '');
      if (!to) continue;
      const fromCity = typeof day['city'] === 'string' ? day['city'] : '';

      const options =
        this.findInConfirmedLegs(fromCity, to, confirmedLegs) ??
        logisticsOptions?.[String(dayNum)];
      const best = options?.[0];
      if (!best || best.durationMinutes === 0) continue;

      day['transport'] = [this.buildTransportLeg(fromCity, to, best, options!)];
      day['cityTransition'] = { to, travelTime: this.travelTimeLabel(best) };
      this.snapTravelSlot(day, best.departureTime);
    }
    return { ...proposal, itinerary };
  }

  private buildTransportLeg(
    from: string,
    to: string,
    best: TransportOption,
    options: TransportOption[],
  ): Record<string, unknown> {
    return {
      from,
      to,
      mode: best.mode,
      provider: best.provider,
      flightNumber: best.flightNumber,
      trainLine: best.trainLine,
      departureTime: best.departureTime,
      arrivalTime: best.arrivalTime,
      durationMinutes: best.durationMinutes,
      priceEur: best.priceEur,
      cost: best.priceEur,
      currency: 'EUR',
      warnings: best.warnings,
      segments: best.segments,
      displaySummary: best.displaySummary,
      alternatives: options.slice(1),
    };
  }

  // Snap a travel day's activity time slot to match the actual transport
  // departure time so the timeline doesn't say "morning" for a 19h train.
  private snapTravelSlot(day: Record<string, unknown>, departureTime?: string): void {
    if (!departureTime) return;
    const hour = parseInt(departureTime.slice(0, 2), 10);
    if (Number.isNaN(hour)) return;
    const slot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const activities = Array.isArray(day['activities'])
      ? (day['activities'] as Array<Record<string, unknown>>)
      : [];
    const travelAct = activities.find((a) => {
      const name = typeof a['activity'] === 'string' ? a['activity'].toLowerCase() : '';
      return name.includes('travel') || name.includes('fly') || name.includes('drive') ||
             name.includes('depart') || name.includes('journey') || name.includes('transfer');
    });
    if (travelAct) travelAct['time'] = slot;
  }

  private travelTimeLabel(best: TransportOption): string {
    if (best.displaySummary) return best.displaySummary;
    const h = Math.floor(best.durationMinutes / 60);
    const m = best.durationMinutes % 60;
    const timeStr = m > 0 ? `${h}h${m}m` : `${h}h`;
    return `${timeStr} by ${best.mode}`;
  }

  // Hardening: the LLM sometimes buries a city transition in a day's `city`
  // field (e.g. "En route: Zagreb → Montpellier (overnight stop)") or invents
  // intermediate stopover cities not in the trip's destinations. Snap every
  // itinerary day's city/country back to the canonical destination that owns
  // that day-number (from the nights schedule), and drop accommodation for any
  // city outside the canonical set (e.g. a phantom Montpellier overnight stay).
  private enforceCanonicalDestinations(
    proposal: Record<string, unknown>,
    destinations: Array<{ country: string; city?: string; nights: number }>,
  ): Record<string, unknown> {
    if (!destinations || destinations.length === 0) return proposal;

    // day-number → canonical {city, country} from the nights schedule.
    const dayMap = new Map<number, { city: string; country: string }>();
    let day = 1;
    for (const d of destinations) {
      const city = d.city ?? d.country;
      for (let i = 0; i < d.nights; i++) {
        dayMap.set(day, { city, country: d.country });
        day++;
      }
    }
    const last = dayMap.get(day - 1);
    const canonical = destinations.map((d) => this.normCity(d.city ?? d.country));
    const inCanonical = (city: string): boolean => {
      const n = this.normCity(city);
      return canonical.some((c) => n.includes(c) || c.includes(n));
    };

    const itinerary = Array.isArray(proposal['itinerary'])
      ? (proposal['itinerary'] as Array<Record<string, unknown>>)
      : [];

    let daysRepaired = 0;
    for (const d of itinerary) {
      const dayNum = typeof d['day'] === 'number' ? d['day'] : null;
      if (dayNum === null) continue;
      const canon = dayMap.get(dayNum) ?? last; // clamp extra days to last leg
      if (!canon) continue;
      const cur = typeof d['city'] === 'string' ? d['city'] : '';
      if (this.normCity(cur) !== this.normCity(canon.city)) {
        d['city'] = canon.city;
        d['country'] = canon.country;
        daysRepaired++;
      } else if (typeof d['country'] !== 'string' || !d['country']) {
        d['country'] = canon.country;
      }
    }

    // Drop accommodation in non-canonical (invented stopover) cities.
    let accommodationDropped = 0;
    let next = proposal;
    if (Array.isArray(proposal['accommodation'])) {
      const kept = (proposal['accommodation'] as Array<Record<string, unknown>>).filter((a) => {
        const city = typeof a['city'] === 'string' ? a['city'] : '';
        const ok = city === '' || inCanonical(city);
        if (!ok) accommodationDropped++;
        return ok;
      });
      next = { ...proposal, accommodation: kept };
    }

    if (daysRepaired > 0 || accommodationDropped > 0) {
      this.logger.info('Enforced canonical destinations on proposal', {
        daysRepaired,
        accommodationDropped,
      });
    }

    return { ...next, itinerary };
  }

  // Normalise a city string for matching: strip accents, lowercase, drop country suffix.
  // e.g. 'Mértola, Portugal' → 'mertola', 'Barcelona' → 'barcelona'
  private normCity(city: string): string {
    return city.toLowerCase()
      .split(',')[0]!
      .replace(/[àáâãä]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[ñ]/g, 'n')
      .trim();
  }

  // Find transport options in confirmedLegs by normalised city-pair match.
  // Keys in confirmedLegs are 'From->To' (from /transport-legs endpoint).
  private findInConfirmedLegs(
    from: string,
    to: string,
    confirmedLegs: Record<string, TransportOption[]>,
  ): TransportOption[] | undefined {
    if (!from || !to) return undefined;
    const nFrom = this.normCity(from);
    const nTo = this.normCity(to);
    for (const [key, options] of Object.entries(confirmedLegs)) {
      const sep = key.indexOf('->');
      if (sep === -1) continue;
      if (this.normCity(key.slice(0, sep)) === nFrom && this.normCity(key.slice(sep + 2)) === nTo) {
        return options;
      }
    }
    return undefined;
  }

  private async maybeResolveFlexibleDates(
    tripId: string,
    logisticsContent: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const suggested = logisticsContent['suggestedDates'] as
        { startDate?: string; endDate?: string } | undefined;
      if (suggested?.startDate && suggested?.endDate) {
        await this.tripService?.resolveFlexibleDates(tripId, suggested.startDate, suggested.endDate);
        return true;
      }
    } catch (err) {
      this.logger.warn('Failed to resolve flexible dates from logistics output', { tripId, error: String(err) });
    }
    return false;
  }

  private async publishRoundComplete(
    tripId: string,
    round: number,
    data: Omit<RoundCompleteEvent, 'type' | 'round'>,
  ): Promise<void> {
    const payload: RoundCompleteEvent = { type: 'round_complete', round, ...data };
    await this.publishOrchestratorEvent(tripId, round, 'score', payload);
  }

  private async publishNegotiationComplete(
    tripId: string,
    round: number,
    data: Omit<NegotiationCompleteEvent, 'type'>,
  ): Promise<void> {
    const payload: NegotiationCompleteEvent = { type: 'negotiation_complete', ...data };
    await this.publishOrchestratorEvent(tripId, round, data.rejected ? 'reject' : 'accept', payload);
  }

  private async publishOrchestratorEvent(
    tripId: string,
    round: number,
    action: 'score' | 'accept' | 'reject',
    payload: RoundCompleteEvent | NegotiationCompleteEvent,
  ): Promise<void> {
    const event: AgentEvent = {
      tripId,
      type: payload.type,
      agent: 'orchestrator',
      round,
      timestamp: new Date().toISOString(),
      content: payload,
    };
    try {
      await this.eventPublisher.publish('orchestrator', action, event);
    } catch (err) {
      this.logger.warn('Failed to publish negotiation event', { tripId, type: payload.type, error: String(err) });
    }
  }

  private async preResolveTransportLegs(
    trip: Trip | null,
    tripContext: AgentTripContext,
  ): Promise<Record<string, TransportOption[]>> {
    const destinations = trip?.destinations ?? [];
    if (destinations.length < 2) return {};
    try {
      const legs = await this.agentCaller.callTransportLegs(
        destinations.map((d) => ({ city: d.city ?? d.country, country: d.country })),
        tripContext.transportPreference ?? 'best',
      );
      this.logger.info('Pre-resolved transport legs for propose context', {
        tripId: trip?.id,
        pairs: Object.keys(legs).length,
      });
      return legs;
    } catch (err) {
      this.logger.warn('Transport pre-resolution failed — LLM will estimate routes', { error: String(err) });
      return {};
    }
  }

  private buildAgentContext(trip: Trip | null, confirmedLegs: Record<string, TransportOption[]> = {}): string {
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

    if (trip.dateInput?.mode === 'flexible') {
      const monthPart = trip.dateInput.preferredMonth ? ` in ${trip.dateInput.preferredMonth}` : '';
      lines.push(`\nDATES: Flexible — ${trip.dateInput.days} days${monthPart} (window: ${trip.dateInput.window})`);
    } else {
      lines.push(`\nDATES: ${trip.startDate ? String(trip.startDate).slice(0, 10) : 'TBD'} → ${trip.endDate ? String(trip.endDate).slice(0, 10) : 'TBD'}`);
    }
    lines.push(`BUDGET: ${trip.budgetTotal ?? '?'} ${trip.budgetCurrency}${budgetPerNight ? ` (≈ ${trip.budgetCurrency} ${budgetPerNight}/night)` : ''}`);
    const rawPace = (trip.travellers?.[0]?.preferences as Record<string, unknown>)?.['pace'];
    const paceLabel = rawPace === 'low' ? 'slow' : rawPace === 'high' ? 'packed' : 'moderate';
    lines.push(`PACE: ${paceLabel} (${rawPace === 'low' ? 'relaxed schedule, few activities/day' : rawPace === 'high' ? 'full schedule, many activities/day' : '2–3 activities/day'})`);
    lines.push(`GROUP SIZE: ${trip.travellers?.length ?? 1} traveller(s)`);

    if (destinations.length > 1) {
      lines.push(`\nLOGISTICS NOTE: Plan transit between destinations. Each country segment has a fixed duration — do not extend or skip any leg.`);
    }

    // Inject confirmed transport legs so the LLM uses real routes instead of inventing them.
    const legKeys = Object.keys(confirmedLegs);
    if (legKeys.length > 0) {
      lines.push('\nCONFIRMED TRANSPORT LEGS (real routes resolved from APIs — use these, do not invent alternatives):');
      for (const key of legKeys) {
        const options = confirmedLegs[key];
        if (!options || options.length === 0) continue;
        const best = options[0];
        if (!best) continue;
        const bestDesc = this.formatTransportOption(best);
        lines.push(`  ${key}: ${bestDesc}`);
        const alts = options.slice(1, 3);
        if (alts.length > 0) {
          lines.push(`    Alternatives: ${alts.map((a) => this.formatTransportOption(a)).join(' | ')}`);
        }
      }
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

  private formatTransportOption(opt: TransportOption): string {
    if (opt.displaySummary) return opt.displaySummary;
    const h = Math.floor(opt.durationMinutes / 60);
    const m = opt.durationMinutes % 60;
    const time = m > 0 ? `${h}h${m}m` : `${h}h`;
    const cost = opt.priceEur !== undefined ? `, ~€${opt.priceEur}/person` : '';
    const dep = opt.departureTime ? `, depart ${opt.departureTime}` : '';
    const provider = opt.provider ? ` via ${opt.provider}` : '';
    return `${opt.mode}${provider}, ${time}${cost}${dep}`;
  }
}
