import { BaseService, hasGroupPreferences, resolveGroupPreferences, deriveGroupPersonaWeights, evaluateTransportPriority, isPersonaKey, matchesPreferenceTerm, PERSONA_CATEGORIES } from '@itinera/shared';
import type { GroupPreferences, PersonaKey } from '@itinera/shared';
import type { TransportMode, AgentEvent, NegotiationCompleteEvent, TransportOption, TransportLeg, RouteGraph, RestrictionWarning } from '@itinera/shared';
import type { WorkflowContext, WorkflowState, TouristSlotInput, TransportPriorityResult, ProposalDecision, ProposalDecisionStatus, SlotProposal, AgentName, AgentAction, SuggestedCut, ScoreFeedback, ScoreBreakdown, LowScoringTraveller, RepairEdit } from '@itinera/shared';
import { config } from '@/config';
import { WorkflowStateMachine } from '@/services/WorkflowStateMachine';
import { StateManager } from '@/services/StateManager';
import { AgentCaller } from '@/services/AgentCaller';
import type { ValidatorComplianceInput } from '@/services/AgentCaller';
import { EventPublisher } from '@/services/EventPublisher';
import type { TripService } from '@/services/TripService';
import type { Trip } from '@/entities/Trip';

const NOTIFICATIONS_EXCHANGE = 'notifications';
const ROUTING_KEY_ITINERARY_READY = 'notification.email.itinerary-ready';

// Transport downgrade budget ceiling: single-leg cost > 40% of per-person budget
const TRANSPORT_BUDGET_CEILING_RATIO = 0.4;
// Single leg time limit: 8h each way
const TRANSPORT_TIME_LIMIT_MINUTES = 480;

export interface IOrchestrationEngine {
  run(tripId: string): Promise<void>;
  setTripService(tripService: TripService): void;
}

export class WorkflowEngine extends BaseService implements IOrchestrationEngine {
  private tripService?: TripService;

  constructor(
    private readonly stateMachine: WorkflowStateMachine,
    private readonly stateManager: StateManager,
    private readonly agentCaller: AgentCaller,
    private readonly eventPublisher: EventPublisher,
  ) {
    super('workflow-engine');
  }

  setTripService(tripService: TripService): void {
    this.tripService = tripService;
  }

  async run(tripId: string): Promise<void> {
    this.logger.info('WorkflowEngine started', { tripId });
    const engineStart = Date.now();

    try {
      const claimed = await this.stateManager.claimNegotiating(tripId);
      if (!claimed) {
        this.logger.warn('Already claimed by another process', { tripId });
        return;
      }

      const trip = await this.stateManager.getTrip(tripId);
      if (!trip) {
        this.logger.error('Trip not found', { tripId });
        return;
      }

      // Resume from DB checkpoint if process restarted mid-flow
      const existing = await this.stateManager.loadWorkflowContext(tripId);
      let context: WorkflowContext = existing ?? this.buildInitialContext(trip);

      if (context.budgetCurrency !== 'EUR') {
        this.logger.warn('Budget currency is not EUR — transport costs are always in EUR; feasibility comparison may be inaccurate', {
          tripId, budgetCurrency: context.budgetCurrency, budgetTotal: context.budgetTotal,
        });
      }

      await this.stateManager.saveWorkflowContext(tripId, context);

      // Carried into finalize so a terminal non-FINISH always has a concrete,
      // persistable reason ("finance failed after 2 retries") instead of the
      // reasonless cancel this used to produce.
      let lastActionReason: string | undefined;

      while (!this.stateMachine.isTerminal(context.currentState)) {
        const { nextState, action } = this.stateMachine.transition(context);
        this.logger.info('Workflow transition', { tripId, from: context.currentState, to: nextState, action: action.type });
        if (action.reason) lastActionReason = action.reason;

        if (action.type === 'LOCAL_RETRY' && action.retryTarget) {
          context.retryCount[action.retryTarget] = (context.retryCount[action.retryTarget] ?? 0) + 1;
          context.currentState = nextState;
          // Re-execute the action for this state so the agent is actually called again.
          // Without this, the loop just re-evaluates the state machine with the same missing
          // field and burns all retry slots without ever calling the agent.
          context = await this.executeAction(context, nextState, trip);
          await this.stateManager.saveWorkflowContext(tripId, context);
          continue;
        }

        context = await this.executeAction(context, nextState, trip);
        context.currentState = nextState;
        await this.stateManager.saveWorkflowContext(tripId, context);
        await this.publishStateEvent(tripId, context);
      }

      await this.finalize(tripId, context, engineStart, lastActionReason);
    } catch (err: unknown) {
      this.logger.error('WorkflowEngine failed', { tripId, error: String(err) });
      await this.stateManager
        .transitionStatus(tripId, 'cancelled', undefined, `Negotiation failed with an internal error: ${String(err)}`)
        .catch(() => undefined);
    }
  }

  private buildInitialContext(trip: Trip): WorkflowContext {
    const destinations = trip.destinations ?? [];
    const firstCity = destinations[0]?.city ?? destinations[0]?.country ?? 'Unknown';
    // The brief is trip-level. Trips created before `trips.preferences` existed
    // carry it duplicated inside every traveller's blob, so fall back to
    // collapsing those (also tolerates the legacy `dealBreakers` key).
    const preferences = resolveGroupPreferences(trip.preferences, trip.travellers ?? []);
    if (hasGroupPreferences(trip.preferences) && trip.travellers?.some((t) => hasGroupPreferences(t.preferences))) {
      // A mixed-shape client: trip-level wins outright, per-traveller copies are ignored.
      this.logger.debug('Trip and traveller preferences both present — using trip-level', { tripId: trip.id });
    }

    return {
      tripId: trip.id,
      origin: firstCity,
      destinations,
      dates: trip.dateInput ?? { mode: 'flexible', days: 7, window: 'moderate' },
      budgetTotal: Number(trip.budgetTotal ?? 1000),
      budgetCurrency: trip.budgetCurrency ?? 'EUR',
      // TODO M79-currency: transport/accommodation costs are always in EUR (SerpApi, Amadeus).
      // If budgetCurrency !== 'EUR' the feasibility comparison uses mismatched currencies.
      // Proper fix: add a CurrencyConversionService at intake and normalise budgetTotal to EUR.
      preferredTransport: (trip.transportPreference as TransportMode) ?? 'best',
      pace: preferences.pace,
      mustHaves: preferences.mustHaves,
      avoids: preferences.avoids,
      groupSize: trip.travellers?.length ?? 1,
      currentState: 'INTAKE_COMPLETE' as WorkflowState,
      retryCount: {},
      errors: [],
      totalTokensUsed: 0,
      startedAt: new Date().toISOString(),
    };
  }

  private async executeAction(
    context: WorkflowContext,
    nextState: WorkflowState,
    trip: Trip,
  ): Promise<WorkflowContext> {
    const updated = { ...context, currentState: nextState };

    switch (nextState) {
      case 'LOGISTICS_PLANNING':
        return this.executeLogisticsPlan(updated, trip);

      case 'FINANCE_ENVELOPE_CHECK':
        return this.executeFinanceEstimate(updated);

      case 'PARALLEL_TURISTIC_PLANNING':
        return this.executeTouristAgents(updated);

      case 'MERGE_AND_SCORE':
        return this.executeMerge(updated, trip);

      case 'FINANCE_VALIDATE':
        return this.executeFinanceValidate(updated, trip);

      case 'ITINERARY_REPAIR':
        return this.executeRepair(updated);

      case 'FINAL_VALIDATION':
        return this.executeFinalValidation(updated, trip);

      default:
        return updated;
    }
  }

  private async executeLogisticsPlan(context: WorkflowContext, trip: Trip): Promise<WorkflowContext> {
    const start = Date.now();
    try {
      const routeGraph = await this.agentCaller.callLogisticsPlan(
        trip.id,
        context.destinations.map((d) => ({ city: d.city ?? d.country, country: d.country, nights: d.nights })),
        context.dates,
        context.preferredTransport,
        context.budgetTotal,
        context.budgetCurrency,
        context.groupSize,
      );

      // Evaluate transport priority for every leg (code-side, never LLM).
      // A downgraded leg carries its reason in bestOption.warnings so the
      // explanation survives into the merged itinerary and the UI.
      const budgetCeilingPerLeg = context.budgetTotal / context.groupSize * TRANSPORT_BUDGET_CEILING_RATIO;
      let transportPriority = context.transportPriority;
      const transportPriorities: TransportPriorityResult[] = [];
      for (let i = 0; i < routeGraph.orderedLegs.length; i++) {
        const leg = routeGraph.orderedLegs[i];
        if (!leg) continue;
        const allOptions = [leg.bestOption, ...leg.alternatives];
        try {
          const result = evaluateTransportPriority(
            context.preferredTransport,
            allOptions,
            budgetCeilingPerLeg,
            TRANSPORT_TIME_LIMIT_MINUTES,
          );
          transportPriorities.push(result);
          if (i === 0) transportPriority = result;
          if (!result.wasPreferenceHonored && result.downgradeReason) {
            const reason = `${context.preferredTransport} preference not used: ${result.downgradeReason}`;
            if (!leg.bestOption.warnings.includes(reason)) {
              leg.bestOption.warnings = [reason, ...leg.bestOption.warnings];
            }
            this.logger.warn('Transport preference downgraded', {
              tripId: context.tripId,
              leg: `${leg.from}→${leg.to}`,
              preferred: context.preferredTransport,
              selected: result.selectedMode,
              reason: result.downgradeReason,
            });
          }
        } catch {
          // No options to evaluate for this leg — use routeGraph as-is
        }
      }

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'logistics',
        round: 1,
        action: 'plan',
        latencyMs: Date.now() - start,
        tokensUsed: 0,
      });

      await this.stateManager.saveProposal({
        tripId: context.tripId,
        agent: 'logistics',
        round: 1,
        content: routeGraph as unknown as Record<string, unknown>,
        action: 'propose',
        reasoning: 'Structural route plan generated',
      });

      await this.publishAgentEvent(context.tripId, 1, 'logistics', 'plan', routeGraph as unknown as Record<string, unknown>);

      return { ...context, routeGraph, transportPriority, transportPriorities, totalTokensUsed: context.totalTokensUsed };
    } catch (err) {
      this.logger.error('Logistics plan failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`logistics-plan: ${String(err)}`);
      return context;
    }
  }

  private async executeFinanceEstimate(context: WorkflowContext): Promise<WorkflowContext> {
    if (!context.routeGraph) return context;
    const start = Date.now();
    try {
      const budgetPlan = await this.agentCaller.callFinanceEstimate(
        context.tripId,
        context.routeGraph,
        context.budgetTotal,
        context.budgetCurrency,
        context.groupSize,
      );

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'finance',
        round: 1,
        action: 'estimate',
        latencyMs: Date.now() - start,
        tokensUsed: 0,
      });

      await this.publishAgentEvent(context.tripId, 1, 'finance', 'estimate', budgetPlan as unknown as Record<string, unknown>);

      return { ...context, budgetPlan, totalTokensUsed: context.totalTokensUsed };
    } catch (err) {
      this.logger.error('Finance estimate failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`finance-estimate: ${String(err)}`);
      return context;
    }
  }

  private async executeTouristAgents(context: WorkflowContext): Promise<WorkflowContext> {
    if (!context.routeGraph || !context.budgetPlan) return context;
    const start = Date.now();
    try {
      // Build TouristSlotInput per city from route graph
      const slots: TouristSlotInput[] = context.routeGraph.cityStays.map((stay) => {
        const block = context.budgetPlan!.perBlock.find((b) => b.city === stay.city);
        return {
          tripId: context.tripId,
          round: 1,
          city: stay.city,
          country: stay.country,
          dateWindow: { start: stay.arrivalDate, end: stay.departureDate },
          availableTimeSlots: stay.timeWindows,
          budgetPerPersonBlock: block?.experiencesBudgetEurPerPerson ?? 0,
          currency: context.budgetCurrency,
          pace: context.pace,
          mustHaves: context.mustHaves,
          avoids: context.avoids,
          groupSize: context.groupSize,
        };
      });

      const results = await this.agentCaller.callPreferenceAgentSlots(context.tripId, 1, slots);
      const agentNames = ['alice', 'bob', 'carlos', 'diana'];
      const touristAgentOutputs: Record<string, { slotProposals?: SlotProposal[] }> = {};
      let tokensUsed = 0;

      results.forEach((result, i) => {
        const name = agentNames[i] ?? `agent-${i}`;
        touristAgentOutputs[name] = result.content as { slotProposals?: SlotProposal[] };
        tokensUsed += result.tokensUsed;

        void this.stateManager.logAgentCall({
          tripId: context.tripId,
          agent: name,
          round: 1,
          action: 'propose-slot',
          latencyMs: result.latencyMs,
          tokensUsed: result.tokensUsed,
        });

        // Persist the raw slot proposal so its status can later be updated
        // once the merge stage decides accept/merge/reject per agent.
        void this.stateManager.saveProposal({
          tripId: context.tripId,
          agent: name,
          round: 1,
          content: result.content,
          action: 'propose',
        });
      });

      this.logger.info('Tourist agents completed', {
        tripId: context.tripId,
        agents: Object.keys(touristAgentOutputs).length,
        latencyMs: Date.now() - start,
        tokensUsed,
      });

      return {
        ...context,
        touristAgentOutputs,
        totalTokensUsed: context.totalTokensUsed + tokensUsed,
      };
    } catch (err) {
      this.logger.error('Tourist agents failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`tourist-agents: ${String(err)}`);
      return context;
    }
  }

  // Turns finance's rejection (issues + suggestedCuts, from BudgetBreakdownBuilder)
  // into an instruction the merge LLM can actually act on, instead of the retry
  // silently re-submitting the exact same itinerary and getting the exact same
  // rejection. Absent on the first merge attempt (no prior rejection yet).
  private buildCostCuttingInstruction(feedback: WorkflowContext['financeFeedback']): string {
    if (!feedback) return '';
    const cuts = feedback.suggestedCuts
      .map((c) => `${c.category}: ${c.description} (save ~€${c.savingPerPerson}/person)`)
      .join('; ');
    return [
      `COST-CUTTING RETRY: the previous version of this itinerary was rejected by finance —`,
      `over budget by €${feedback.overAmountTotal} total (~€${feedback.overAmountPerPerson}/person).`,
      feedback.issues.join(' '),
      cuts ? `Apply these suggested cuts where they still satisfy the must-haves: ${cuts}.` : '',
      `Prefer cheaper venues/accommodation in the flagged categories over dropping a must-have.`,
    ].filter(Boolean).join(' ');
  }

  // Turns a low validator score (scoreFeedback, set by executeFinalValidation)
  // into an instruction the merge LLM can act on — same idea as
  // buildCostCuttingInstruction, but for persona/category imbalance instead of
  // budget. Absent on the first merge attempt (no prior score yet).
  //
  // Skipped entirely when the score was dragged down by budget or logistics
  // rather than persona fit: telling the merge to give underserved personas
  // *more* activities would push an already-over-budget itinerary further out,
  // and buildCostCuttingInstruction already covers the budget case.
  private buildPersonaRebalanceInstruction(feedback: WorkflowContext['scoreFeedback']): string {
    if (!feedback || feedback.lowScoringTravellers.length === 0) return '';
    if (feedback.primaryCause && feedback.primaryCause !== 'persona') return '';
    const perTraveller = feedback.lowScoringTravellers
      .map((t) => {
        const missing = t.missingCategories.length > 0 ? ` — missing: ${t.missingCategories.join(', ')}` : '';
        return `${t.label}${t.persona ? ` (${t.persona})` : ''} scored ${t.score}/100${missing}`;
      })
      .join('; ');
    return [
      `PERSONA REBALANCE RETRY: the previous version of this itinerary scored ${feedback.overallScore}/100 —`,
      `too little content for real travellers in this group: ${perTraveller}.`,
      `Give more weight to the flagged personas' proposals for their missing categories`,
      `(consult GROUP PREFERENCES personaWeights for who is actually in the group), even displacing`,
      `a zero-weight persona's activity if that's what a contested slot needs.`,
    ].filter(Boolean).join(' ');
  }

  // Covers the gap between the two instructions above: when finance *approved*
  // but the budget axis still dragged the combined score down, there is no
  // financeFeedback to build a cost-cutting instruction from, and the persona
  // instruction is suppressed because the cause is not persona fit — leaving
  // the re-merge with no guidance at all. Build the budget instruction from the
  // score breakdown instead.
  private buildBudgetTighteningInstruction(context: WorkflowContext): string {
    const breakdown = context.scoreBreakdown;
    if (context.financeFeedback) return '';
    if (!breakdown || breakdown.financeScore === null || breakdown.financeScore >= 100) return '';
    if (context.scoreFeedback?.primaryCause !== 'budget') return '';

    const over =
      typeof context.actualCostTotal === 'number'
        ? ` The itinerary costs ${context.actualCostTotal} ${context.budgetCurrency} against a budget of ${context.budgetTotal} ${context.budgetCurrency}.`
        : '';
    return (
      `BUDGET TIGHTENING RETRY: the previous version scored ${breakdown.combinedScore}/100, held back by cost.${over}` +
      ` Choose cheaper venues, accommodation and meals so the total fits the budget.` +
      ` Keep the same personas represented — cut price, not variety.`
    );
  }

  private async executeMerge(context: WorkflowContext, trip: Trip): Promise<WorkflowContext> {
    if (!context.routeGraph || !context.touristAgentOutputs || !context.budgetPlan) return context;
    const start = Date.now();
    try {
      const routeGraph = context.routeGraph;
      const budgetPlan = context.budgetPlan;
      // Bumped on every finance- or validation-triggered re-merge (never on the
      // first attempt) so ItineraryMerger's cache key (keyed by round+city)
      // actually differs — without this, a retry would hit the cached
      // first-attempt response verbatim and get the identical rejection/score
      // no matter what tripContext says.
      const mergeRound = 1 + (context.retryCount['finance'] ?? 0) + (context.retryCount['validation'] ?? 0);
      const tripContext = [
        `Trip: ${trip.name}. Budget: ${context.budgetTotal} ${context.budgetCurrency}. Group size: ${context.groupSize}.`,
        this.buildCostCuttingInstruction(context.financeFeedback),
        this.buildPersonaRebalanceInstruction(context.scoreFeedback),
        this.buildBudgetTighteningInstruction(context),
      ].filter(Boolean).join(' ');
      // Passed as a structured block rather than folded into tripContext, so the
      // merge prompt's must-have/avoid rules have a machine-readable source.
      const groupPreferences: GroupPreferences = {
        pace: context.pace,
        mustHaves: context.mustHaves,
        avoids: context.avoids,
        personaWeights: deriveGroupPersonaWeights(trip.travellers ?? []),
      };
      const touristAgentOutputs = context.touristAgentOutputs as Record<string, { slotProposals?: SlotProposal[] }>;

      // Derive accept/merge/reject per input proposal from which proposalIds
      // actually ended up in the final itinerary's activities — not from the
      // merge LLM's separately-generated `decisions` log, which can silently
      // be empty (schema `.catch([])`) or drift from the input proposals'
      // own city/date/slot text. The `decisions` log is now enrichment-only
      // (reason text), keyed by the same id, never load-bearing for status.
      const inputProposals: Array<{ id: string; agent: string; city: string; date: string; slot: 'morning' | 'afternoon' | 'evening'; activity: string; estimatedCostPerPerson: number }> = [];
      // The slot proposals carry a `category` the merge output drops, and the
      // validator scores traveller interests against exactly that field. Proposal
      // ids are globally unique, so one map serves every per-city call below.
      const categoryByProposalId = new Map<string, string>();
      for (const [agentName, output] of Object.entries(touristAgentOutputs)) {
        for (const p of output.slotProposals ?? []) {
          inputProposals.push({
            id: p.id, agent: agentName, city: p.city, date: p.date, slot: p.slot,
            activity: p.activity, estimatedCostPerPerson: p.estimatedCostPerPerson,
          });
          const category = (p as { category?: unknown }).category;
          if (typeof category === 'string' && category.trim().length > 0) {
            categoryByProposalId.set(p.id, category);
          }
        }
      }

      interface CityMergeResult {
        itinerary: unknown[];
        accommodation: unknown[];
        decisions: ProposalDecision[];
        rawDecisionLog: Array<Record<string, unknown>>;
        reasoning?: string;
        tokensUsed: number;
      }

      // One merge call per city stay, run concurrently. LLM output-token
      // generation (not input size) dominates wall time, so scoping each
      // call's OUTPUT to a single city's days/decisions/accommodation turns
      // one huge blocking completion (up to ITINERARY_MAX_TOKENS) into N
      // smaller ones running in parallel — verified safe because
      // RouteGraph.cityStays[].timeWindows already partitions every calendar
      // date into exactly one city (no gaps/overlaps at transit boundaries),
      // and merge.txt's budget/fairness rules are already per-city-scoped.
      //
      // Each city also enforces/derives/publishes its own agent.decision
      // events the moment ITS OWN merge call resolves, independent of
      // slower sibling cities — this is what lets the frontend fill Draft
      // Itinerary rows city-by-city instead of only after the slowest city
      // finishes. Safe to run the enforcement helpers per-city: they key off
      // `byDay` built from this call's own proposal.itinerary, and the day
      // partition guarantee above means there's no cross-city day overlap
      // between concurrently-running calls. A city-level failure is isolated
      // here too — it must not erase decisions already published for a
      // sibling city or abort the whole merge.
      // Single source of truth for day→city attribution, computed once and
      // shared by every per-city call below — see filterOwnedDays.
      const dayOwnership = this.buildDayOwnership(routeGraph);

      const cityResults: CityMergeResult[] = await Promise.all(
        routeGraph.cityStays.map(async (stay): Promise<CityMergeResult> => {
          const result = await this.agentCaller.callOrchestratorMerge(
            context.tripId,
            mergeRound,
            routeGraph,
            touristAgentOutputs,
            budgetPlan,
            tripContext,
            stay.city,
            groupPreferences,
          );

          void this.stateManager.logAgentCall({
            tripId: context.tripId,
            agent: 'orchestrator',
            round: 1,
            action: 'merge-city',
            latencyMs: result.latencyMs,
            tokensUsed: result.tokensUsed,
            reasoning: `city=${stay.city}`,
          });

          const cityContent: Record<string, unknown> = {
            itinerary: Array.isArray(result.content['itinerary']) ? result.content['itinerary'] : [],
            accommodation: Array.isArray(result.content['accommodation']) ? result.content['accommodation'] : [],
          };
          const rawDecisionLog = Array.isArray(result.content['decisions'])
            ? (result.content['decisions'] as Array<Record<string, unknown>>)
            : [];

          // Enforce canonical destinations, strip LLM activities from blocked
          // transit slots (merge.txt is prompt-level only — this is the hard
          // guarantee), then inject real transport legs from routeGraph —
          // scoped to this city's own days only (see note above).
          const enforced = this.enforceCanonicalDestinations(cityContent, context.destinations, routeGraph);
          const stripped = this.stripBlockedSlotActivities(enforced, routeGraph);
          const withTransport = this.injectRouteGraphTransport(stripped, routeGraph, context.destinations);

          const cityInputProposals = inputProposals.filter((p) => p.city === stay.city);
          const usedIds = new Set<string>();
          const rawItinerary = (withTransport as { itinerary?: Array<{ day?: number; activities?: Array<{ proposalIds?: string[]; category?: string }> }> }).itinerary ?? [];
          // merge.txt only tells the LLM (prompt-level) to stick to its
          // target city — this is the deterministic backstop. Without it, a
          // day hallucinated by the wrong city's call reaches the combined
          // itinerary as a second, duplicate "Day N" card in the UI/PDF.
          const ownedDays = this.filterOwnedDays(rawItinerary, dayOwnership, stay.city);
          // Restore the source slot proposal's category. Done after the day
          // filter so discarded days cost nothing, and before the decision
          // walk so both read the same objects.
          const withTransportItinerary = this.backfillActivityCategories(ownedDays, categoryByProposalId);
          for (const day of withTransportItinerary) {
            for (const act of day.activities ?? []) {
              for (const pid of act.proposalIds ?? []) usedIds.add(pid);
            }
          }

          if (usedIds.size === 0 && cityInputProposals.length > 0) {
            this.logger.warn('Merge produced no proposalIds on any activity for this city — all its proposals will resolve to rejected', {
              tripId: context.tripId, city: stay.city, inputProposalCount: cityInputProposals.length,
            });
          }

          const decisionEnrichmentById = new Map<string, { status: string; reason: string }>();
          for (const raw of rawDecisionLog) {
            const pid = raw['proposalId'];
            const status = raw['status'];
            const reason = raw['reason'];
            if (typeof pid === 'string' && typeof status === 'string' && typeof reason === 'string') {
              decisionEnrichmentById.set(pid, { status, reason });
            }
          }

          const decisions: ProposalDecision[] = cityInputProposals.map((p) => {
            const enrichment = decisionEnrichmentById.get(p.id);
            const accepted = usedIds.has(p.id);
            const status: ProposalDecisionStatus = !accepted
              ? 'rejected'
              : enrichment?.status === 'merged' ? 'merged' : 'accepted';
            const reason = enrichment?.reason ?? (accepted
              ? 'Included in the final itinerary.'
              : 'Not included in the final itinerary — budget, duplicate, or a competing proposal was preferred for that slot.');
            return {
              proposalId: p.id,
              agent: p.agent,
              city: p.city,
              date: p.date,
              slot: p.slot,
              activity: p.activity,
              status,
              reason,
              estimatedCostPerPerson: p.estimatedCostPerPerson,
            };
          });

          // Publish this city's decision events the instant its own merge
          // finishes — independent of slower sibling cities still in flight.
          for (const decision of decisions) {
            await this.publishAgentEvent(
              context.tripId,
              1,
              decision.agent,
              'decision',
              decision as unknown as Record<string, unknown>,
            );
          }

          return {
            itinerary: withTransportItinerary,
            accommodation: Array.isArray((withTransport as Record<string, unknown>)['accommodation'])
              ? ((withTransport as Record<string, unknown>)['accommodation'] as unknown[])
              : [],
            decisions,
            rawDecisionLog,
            reasoning: result.reasoning,
            tokensUsed: result.tokensUsed,
          };
        }),
      );

      let tokensUsed = 0;
      const combinedItinerary: unknown[] = [];
      const combinedAccommodation: unknown[] = [];
      const combinedDecisions: Array<Record<string, unknown>> = [];
      const decisions: ProposalDecision[] = [];
      const reasoningParts: string[] = [];
      for (const [i, result] of cityResults.entries()) {
        tokensUsed += result.tokensUsed;
        const city = routeGraph.cityStays[i]?.city ?? `city-${i}`;
        combinedItinerary.push(...result.itinerary);
        combinedAccommodation.push(...result.accommodation);
        combinedDecisions.push(...result.rawDecisionLog);
        decisions.push(...result.decisions);
        if (result.reasoning) reasoningParts.push(`[${city}] ${result.reasoning}`);
      }
      combinedItinerary.sort((a, b) => ((a as { day: number }).day ?? 0) - ((b as { day: number }).day ?? 0));
      const withTransport: Record<string, unknown> = {
        itinerary: combinedItinerary,
        accommodation: combinedAccommodation,
        decisions: combinedDecisions,
      };

      // Per-persona-agent proposal win rate: the share of that agent's proposals
      // that made it into the final itinerary. Computed deterministically from
      // the decisions above rather than asked of the LLM.
      //
      // NOT traveller satisfaction — it used to be stored under
      // `satisfactionEstimates`, which read as a claim about people. Real
      // per-traveller scores come from the validator, keyed by traveller id.
      const agentWinRates: Record<string, number> = {};
      const countsByAgent = new Map<string, { total: number; won: number }>();
      for (const d of decisions) {
        const c = countsByAgent.get(d.agent) ?? { total: 0, won: 0 };
        c.total += 1;
        if (d.status !== 'rejected') c.won += 1;
        countsByAgent.set(d.agent, c);
      }
      for (const [agent, c] of countsByAgent) {
        agentWinRates[agent] = c.total > 0 ? c.won / c.total : 0;
      }

      // Public holiday / Sunday-Monday closure checks — real activities + dates only
      // exist from this point on, so this can't run any earlier in the workflow.
      // Non-blocking: a failure here must never stop the itinerary from being saved.
      const restrictionsStart = Date.now();
      let restrictionWarnings: RestrictionWarning[] = [];
      try {
        restrictionWarnings = await this.agentCaller.callLogisticsRestrictions(
          context.tripId,
          (withTransport as Record<string, unknown>)['itinerary'] as Array<Record<string, unknown>> ?? [],
          trip.region ?? null,
          context.dates,
        );
        await this.stateManager.logAgentCall({
          tripId: context.tripId,
          agent: 'logistics',
          round: 1,
          action: 'restrictions',
          latencyMs: Date.now() - restrictionsStart,
          tokensUsed: 0,
        });
      } catch (restrictionsErr) {
        this.logger.warn('Restriction check failed — continuing without warnings', {
          tripId: context.tripId, error: String(restrictionsErr),
        });
      }

      // OpenWeatherMap-backed weather/timing impact assessment — same timing
      // constraint as restrictions (real activities + dates only exist now).
      // Non-blocking: a failure here must never stop the itinerary from being saved.
      const weatherStart = Date.now();
      let weatherAssessment: Record<string, unknown> = {};
      let weatherTokensUsed = 0;
      try {
        const weatherResult = await this.agentCaller.callLogisticsWeatherAssessment(
          context.tripId,
          1,
          (withTransport as Record<string, unknown>)['itinerary'] as Array<Record<string, unknown>> ?? [],
          trip.region ?? null,
          context.dates,
          restrictionWarnings,
        );
        weatherAssessment = weatherResult.content;
        weatherTokensUsed = weatherResult.tokensUsed;
        await this.stateManager.logAgentCall({
          tripId: context.tripId,
          agent: 'logistics',
          round: 1,
          action: 'weather-assessment',
          latencyMs: Date.now() - weatherStart,
          tokensUsed: weatherTokensUsed,
        });
      } catch (weatherErr) {
        this.logger.warn('Weather assessment failed — continuing without weather data', {
          tripId: context.tripId, error: String(weatherErr),
        });
      }

      // Real pricing overlay — replaces/tags the merge LLM's own unlabelled
      // cost guess with real attraction DB / Google Places / hotel prices
      // where available. Non-blocking: a failure here must never stop the
      // itinerary from being saved.
      const pricingOverlayStart = Date.now();
      try {
        const overlaid = await this.agentCaller.callLogisticsPricingOverlay(
          context.tripId,
          (withTransport['itinerary'] as Array<Record<string, unknown>>) ?? [],
          (withTransport['accommodation'] as Array<Record<string, unknown>>) ?? [],
          trip.region ?? null,
          context.dates,
        );
        withTransport['itinerary'] = overlaid.itinerary;
        withTransport['accommodation'] = overlaid.accommodation;
        await this.stateManager.logAgentCall({
          tripId: context.tripId,
          agent: 'logistics',
          round: 1,
          action: 'pricing-overlay',
          latencyMs: Date.now() - pricingOverlayStart,
          tokensUsed: 0,
        });
        await this.publishAgentEvent(context.tripId, 1, 'logistics', 'pricing-overlay', {
          repricedCount: overlaid.repricedCount,
        });
      } catch (pricingErr) {
        this.logger.warn('Pricing overlay failed — keeping LLM cost estimates', {
          tripId: context.tripId, error: String(pricingErr),
        });
      }

      // Local/day-trip activity transport (e.g. Pena Palace from a Lisbon
      // base) — same non-blocking treatment. Real venues + dates only exist
      // from this point on, same constraint as restrictions/weather above.
      let satelliteLegs: TransportLeg[] = [];
      const localTransportStart = Date.now();
      try {
        const result = await this.agentCaller.callLogisticsLocalTransport(
          context.tripId,
          (withTransport['itinerary'] as Array<Record<string, unknown>>) ?? [],
          context.dates,
          context.preferredTransport,
        );
        withTransport['itinerary'] = result.itinerary;
        satelliteLegs = result.satelliteLegs;
        await this.stateManager.logAgentCall({
          tripId: context.tripId,
          agent: 'logistics',
          round: 1,
          action: 'local-transport',
          latencyMs: Date.now() - localTransportStart,
          tokensUsed: 0,
        });
        await this.publishAgentEvent(context.tripId, 1, 'logistics', 'local-transport', {
          satelliteLegCount: satelliteLegs.length,
        });
      } catch (localTransportErr) {
        this.logger.warn('Local transport resolution failed — continuing without local transport costs', {
          tripId: context.tripId, error: String(localTransportErr),
        });
      }

      const finalItinerary = { ...withTransport, restrictionWarnings, weatherAssessment, agentWinRates };

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'orchestrator',
        round: 1,
        action: 'merge',
        latencyMs: Date.now() - start,
        tokensUsed,
      });

      await this.stateManager.saveProposal({
        tripId: context.tripId,
        agent: 'orchestrator',
        round: 1,
        content: finalItinerary,
        action: 'propose',
        reasoning: reasoningParts.join('\n'),
      });

      await this.publishAgentEvent(context.tripId, 1, 'orchestrator', 'merge', finalItinerary);

      // Per-city decision events were already published live, as each city's
      // own merge call resolved (see the per-city map above) — guaranteed
      // full coverage since they're derived from inputProposals, not read off
      // the LLM's own decisions log. Here we only roll them up into a single
      // aggregate proposal-status update per agent (fine-grained per-slot
      // detail lives only in the live events — the DB row stays at
      // agent+round granularity, see saveProposal above).
      const statusByAgent = new Map<string, ProposalDecisionStatus>();
      for (const decision of decisions) {
        const prev = statusByAgent.get(decision.agent);
        if (prev !== 'accepted' && prev !== 'merged') {
          statusByAgent.set(decision.agent, decision.status);
        }
      }
      for (const [agent, status] of statusByAgent) {
        await this.stateManager
          .updateProposalStatus(context.tripId, agent, 1, status)
          .catch((err) => {
            this.logger.warn('Failed to update proposal status from decision', {
              tripId: context.tripId, agent, error: String(err),
            });
          });
      }

      return {
        ...context,
        mergedItinerary: finalItinerary,
        routeGraph: satelliteLegs.length > 0 ? { ...routeGraph, satelliteLegs } : routeGraph,
        totalTokensUsed: context.totalTokensUsed + tokensUsed + weatherTokensUsed,
      };
    } catch (err) {
      this.logger.error('Merge failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`merge: ${String(err)}`);
      return context;
    }
  }

  /**
   * ITINERARY_REPAIR: turn finance's rejection into targeted edits on the
   * EXISTING merged itinerary (post-overlay, real prices) instead of the full
   * re-merge this used to trigger. One small LLM call for the edit list; the
   * edits themselves are applied deterministically here so a hallucinated edit
   * can only fail to match an item, never corrupt unrelated days.
   */
  private async executeRepair(context: WorkflowContext): Promise<WorkflowContext> {
    const merged = context.mergedItinerary;
    const feedback = context.financeFeedback;
    if (!merged || !feedback) {
      // Nothing to repair against — FINANCE_VALIDATE will re-review unchanged,
      // and the state machine's retry/abandon budget handles the rest.
      return context;
    }

    const itinerary = Array.isArray(merged['itinerary'])
      ? (merged['itinerary'] as Array<Record<string, unknown>>)
      : [];
    const accommodation = Array.isArray(merged['accommodation'])
      ? (merged['accommodation'] as Array<Record<string, unknown>>)
      : [];
    if (itinerary.length === 0) return context;

    const start = Date.now();
    const repairRound = 1 + (context.retryCount['finance'] ?? 0);
    try {
      const targetTotal = Math.round(context.budgetTotal * (1 + config.BUDGET_TOLERANCE_PCT / 100));
      const result = await this.agentCaller.callOrchestratorRepair(
        context.tripId,
        repairRound,
        itinerary,
        accommodation,
        feedback,
        context.budgetTotal,
        context.budgetCurrency,
        context.groupSize,
        targetTotal,
      );

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'orchestrator',
        round: repairRound,
        action: 'repair',
        latencyMs: Date.now() - start,
        tokensUsed: result.tokensUsed,
      });

      const edits = Array.isArray(result.content['edits'])
        ? (result.content['edits'] as RepairEdit[])
        : [];
      const outcome = this.applyRepairEdits(itinerary, accommodation, edits);

      // One event per edit — the admin/step-3 feed shows the finance ↔
      // orchestrator cost-cutting negotiation as it happens.
      for (const [edit, applied] of [
        ...outcome.applied.map((e): [RepairEdit, boolean] => [e, true]),
        ...outcome.skipped.map((e): [RepairEdit, boolean] => [e, false]),
      ]) {
        await this.publishAgentEvent(context.tripId, repairRound, 'orchestrator', 'repair', {
          ...edit,
          applied,
          overAmountTotal: feedback.overAmountTotal,
        });
      }

      this.logger.info('Repair edits processed', {
        tripId: context.tripId,
        applied: outcome.applied.length,
        skipped: outcome.skipped.length,
      });

      if (outcome.applied.length === 0) {
        return { ...context, totalTokensUsed: context.totalTokensUsed + result.tokensUsed };
      }

      const repairedItinerary = { ...merged, itinerary: outcome.itinerary, accommodation: outcome.accommodation };

      // Persist the FULL repaired itinerary (not just the edit list): the
      // results page picks the highest-round orchestrator proposal that has an
      // `itinerary` array, so this row is what the user actually sees.
      await this.stateManager.saveProposal({
        tripId: context.tripId,
        agent: 'orchestrator',
        round: repairRound + 1,
        content: {
          ...repairedItinerary,
          repair: {
            edits: outcome.applied,
            skippedEdits: outcome.skipped,
            summary: result.content['summary'],
          },
        },
        action: 'repair',
        reasoning: result.reasoning,
      });

      return {
        ...context,
        mergedItinerary: repairedItinerary,
        totalTokensUsed: context.totalTokensUsed + result.tokensUsed,
      };
    } catch (err) {
      this.logger.error('Repair failed — itinerary unchanged', { tripId: context.tripId, error: String(err) });
      context.errors.push(`repair: ${String(err)}`);
      return context;
    }
  }

  /**
   * Applies the repair agent's edit list. Every edit must match an existing
   * item (by day + name/venue) to take effect; `downgrade` additionally
   * requires the new cost to be lower than the current one. Non-matching or
   * rule-breaking edits are skipped, never guessed at.
   */
  private applyRepairEdits(
    itinerary: Array<Record<string, unknown>>,
    accommodation: Array<Record<string, unknown>>,
    edits: RepairEdit[],
  ): {
    itinerary: Array<Record<string, unknown>>;
    accommodation: Array<Record<string, unknown>>;
    applied: RepairEdit[];
    skipped: RepairEdit[];
  } {
    const applied: RepairEdit[] = [];
    const skipped: RepairEdit[] = [];
    const days = itinerary.map((d) => ({ ...d }));
    const acc = accommodation.map((a) => ({ ...a }));
    const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

    for (const edit of edits) {
      let ok = false;

      if (edit.target === 'accommodation') {
        const entry = acc.find(
          (a) => norm(a['name']).includes(norm(edit.name)) || norm(a['city']) === norm(edit.name),
        );
        // Removing accommodation is never valid — the group has to sleep somewhere.
        if (
          entry &&
          edit.type === 'downgrade' &&
          typeof edit.newCostPerPerson === 'number' &&
          edit.newCostPerPerson < Number(entry['pricePerNightPerPerson'] ?? Infinity)
        ) {
          entry['pricePerNightPerPerson'] = edit.newCostPerPerson;
          entry['isEstimate'] = true;
          entry['source'] = 'repair_downgrade';
          if (edit.note) entry['repairNote'] = edit.note;
          ok = true;
        }
      } else {
        const day = days.find((d) => Number(d['day']) === edit.day);
        if (day) {
          if (edit.target === 'activity') {
            const acts = Array.isArray(day['activities'])
              ? [...(day['activities'] as Array<Record<string, unknown>>)]
              : [];
            // Merge output names the activity in `activity`; older fixtures and
            // pricing-overlay items use `name` — match either, plus the venue.
            const idx = acts.findIndex(
              (a) =>
                norm(a['activity']) === norm(edit.name) ||
                norm(a['name']) === norm(edit.name) ||
                norm(a['venue']) === norm(edit.name),
            );
            if (idx >= 0) {
              const item = { ...acts[idx]! };
              if (edit.type === 'remove') {
                // Never empty a day — a repaired trip must still be a trip.
                if (acts.length > 1) {
                  const removedVenue = norm(item['venue']);
                  acts.splice(idx, 1);
                  day['activities'] = acts;
                  // Cascade: drop day-trip/local transport legs to that venue,
                  // or the dead activity's transport cost survives the cut.
                  if (Array.isArray(day['transport'])) {
                    day['transport'] = (day['transport'] as Array<Record<string, unknown>>).filter(
                      (t) => norm(t['to']) !== removedVenue && norm(t['to']) !== norm(edit.name),
                    );
                  }
                  ok = true;
                }
              } else if (
                typeof edit.newCostPerPerson === 'number' &&
                edit.newCostPerPerson < Number(item['estimatedCostPerPerson'] ?? Infinity)
              ) {
                item['estimatedCostPerPerson'] = edit.newCostPerPerson;
                item['isEstimate'] = true;
                item['source'] = 'repair_downgrade';
                if (edit.note) item['repairNote'] = edit.note;
                acts[idx] = item;
                day['activities'] = acts;
                ok = true;
              }
            }
          } else if (edit.target === 'meal') {
            const meals = Array.isArray(day['meals'])
              ? [...(day['meals'] as Array<Record<string, unknown>>)]
              : [];
            const current = meals[0] ? Number(meals[0]['estimatedCostPerPerson'] ?? meals[0]['cost'] ?? Infinity) : Infinity;
            if (
              meals[0] &&
              edit.type === 'downgrade' &&
              typeof edit.newCostPerPerson === 'number' &&
              edit.newCostPerPerson < current
            ) {
              meals[0] = {
                ...meals[0],
                estimatedCostPerPerson: edit.newCostPerPerson,
                isEstimate: true,
                source: 'repair_downgrade',
                ...(edit.note ? { repairNote: edit.note } : {}),
              };
              day['meals'] = meals;
              ok = true;
            }
          } else if (edit.target === 'transport') {
            const transport = Array.isArray(day['transport'])
              ? [...(day['transport'] as Array<Record<string, unknown>>)]
              : [];
            const tidx = transport.findIndex(
              (t) =>
                norm(t['to']) === norm(edit.name) ||
                `${norm(t['from'])} → ${norm(t['to'])}` === norm(edit.name) ||
                (norm(edit.name).length > 2 && norm(t['to']).includes(norm(edit.name))),
            );
            if (tidx >= 0) {
              const leg = { ...transport[tidx]! };
              const current = Number(leg['priceEur'] ?? leg['cost'] ?? Infinity);
              if (
                edit.type === 'downgrade' &&
                typeof edit.newCostPerPerson === 'number' &&
                edit.newCostPerPerson < current
              ) {
                // Finance reads priceEur ?? cost — update whichever carries the price.
                if (leg['priceEur'] !== undefined) leg['priceEur'] = edit.newCostPerPerson;
                else leg['cost'] = edit.newCostPerPerson;
                leg['isEstimate'] = true;
                leg['source'] = 'repair_downgrade';
                if (edit.note) leg['repairNote'] = edit.note;
                transport[tidx] = leg;
                day['transport'] = transport;
                ok = true;
              } else if (edit.type === 'remove') {
                transport.splice(tidx, 1);
                day['transport'] = transport;
                ok = true;
              }
            }
          }
        }
      }

      (ok ? applied : skipped).push(edit);
    }

    return { itinerary: days, accommodation: acc, applied, skipped };
  }

  private async executeFinanceValidate(context: WorkflowContext, trip: Trip): Promise<WorkflowContext> {
    if (!context.mergedItinerary) return context;
    const start = Date.now();
    try {
      const result = await this.agentCaller.callFinanceAgent(
        context.tripId,
        2,
        context.mergedItinerary,
        {
          budgetTotal: context.budgetTotal,
          budgetCurrency: context.budgetCurrency,
          groupSize: context.groupSize,
          dateInput: context.dates,
        },
      );

      const verdict = (result.content['verdict'] ?? {}) as Record<string, unknown>;
      const approved = verdict['approved'] === true;
      const budgetFeasible = verdict['budgetFeasible'] !== false;
      const budgetBreakdown = result.content['budgetBreakdown'] as
        | { grandTotal?: number; budgetTotal?: number; suggestedCuts?: SuggestedCut[] }
        | undefined;

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'finance',
        round: 2,
        action: 'review',
        latencyMs: Date.now() - start,
        tokensUsed: result.tokensUsed,
      });

      await this.stateManager.saveProposal({
        tripId: context.tripId,
        agent: 'finance',
        round: 2,
        content: result.content,
        action: approved ? 'accept' : 'reject',
        reasoning: result.reasoning,
      });

      // Attach finance verdict marker so state machine can read it
      const updated = { ...context.mergedItinerary, _financeApproved: approved, _budgetFeasible: budgetFeasible };

      // Feeds the next merge retry (see buildCostCuttingInstruction) — cleared
      // on approval since there's nothing left to cut.
      const overAmountTotal = Math.max(0, (budgetBreakdown?.grandTotal ?? 0) - (budgetBreakdown?.budgetTotal ?? 0));
      const financeFeedback = approved
        ? undefined
        : {
            overAmountTotal,
            overAmountPerPerson: context.groupSize > 0 ? Math.round(overAmountTotal / context.groupSize) : overAmountTotal,
            issues: Array.isArray(verdict['issues']) ? (verdict['issues'] as string[]) : [],
            suggestedCuts: budgetBreakdown?.suggestedCuts ?? [],
          };

      return {
        ...context,
        mergedItinerary: updated,
        financeFeedback,
        actualCostTotal: budgetBreakdown?.grandTotal ?? context.actualCostTotal,
        totalTokensUsed: context.totalTokensUsed + result.tokensUsed,
      };
    } catch (err) {
      this.logger.error('Finance validate failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`finance-validate: ${String(err)}`);
      return context;
    }
  }

  /**
   * Restore each merged activity's `category` from the slot proposal it was built
   * from. The merge LLM is not asked for the field, and the validator scores a
   * traveller's interests against it — so this is derived from `proposalIds`
   * rather than trusted from the model.
   *
   * An existing category is never overwritten, and objects are copied rather than
   * mutated because the decision derivation reads the same day objects.
   */
  private backfillActivityCategories<
    T extends { activities?: Array<{ proposalIds?: string[]; category?: string }> },
  >(itinerary: T[], categoryByProposalId: ReadonlyMap<string, string>): T[] {
    if (categoryByProposalId.size === 0) return itinerary;

    return itinerary.map((day) => {
      if (!Array.isArray(day.activities)) return day;
      return {
        ...day,
        activities: day.activities.map((activity) => {
          if (typeof activity.category === 'string' && activity.category.trim().length > 0) return activity;
          const source = (activity.proposalIds ?? [])
            .map((id) => categoryByProposalId.get(id))
            .find((category): category is string => category !== undefined);
          return source === undefined ? activity : { ...activity, category: source };
        }),
      };
    });
  }

  private async executeFinalValidation(context: WorkflowContext, trip: Trip): Promise<WorkflowContext> {
    if (!context.mergedItinerary) return context;
    const start = Date.now();
    try {
      const result = await this.agentCaller.callValidatorAgent(
        context.tripId,
        2,
        context.mergedItinerary,
        { mustHaves: context.mustHaves, avoids: context.avoids },
        this.buildComplianceInput(context),
        { budgetTotal: context.budgetTotal, travellerCount: context.groupSize },
      );
      const scoring = (result.content['scoring'] ?? {}) as Record<string, unknown>;
      const score = typeof scoring['overallScore'] === 'number' ? scoring['overallScore'] : 0;
      const breakdown = result.content['compliance'] as ScoreBreakdown | undefined;

      await this.stateManager.logAgentCall({
        tripId: context.tripId,
        agent: 'validator',
        round: 2,
        action: 'score',
        latencyMs: Date.now() - start,
        tokensUsed: result.tokensUsed,
      });

      const scoreFeedback =
        score < 60
          ? this.buildScoreFeedback(score, scoring, trip, context.mergedItinerary, breakdown)
          : undefined;

      return {
        ...context,
        validationScore: score,
        scoreFeedback,
        scoreBreakdown: breakdown,
        totalTokensUsed: context.totalTokensUsed + result.tokensUsed,
      };
    } catch (err) {
      this.logger.error('Final validation failed', { tripId: context.tripId, error: String(err) });
      context.errors.push(`final-validation: ${String(err)}`);
      return context;
    }
  }

  /**
   * Compliance signals for the validator's finance/logistics score axes. All of
   * this is already computed earlier in the run — finance's real cost at
   * FINANCE_VALIDATE, transport downgrades at LOGISTICS_PLANNING, and the
   * restriction/weather passes during the merge — it just had nowhere to go
   * before the score became a blend.
   */
  private buildComplianceInput(context: WorkflowContext): ValidatorComplianceInput | undefined {
    const merged = context.mergedItinerary ?? {};
    const weather = merged['weatherAssessment'] as { overallRisk?: 'low' | 'medium' | 'high' } | undefined;
    const restrictions = merged['restrictionWarnings'];

    const finance =
      typeof context.actualCostTotal === 'number' && context.budgetTotal > 0
        ? { budgetTotal: context.budgetTotal, actualTotal: context.actualCostTotal }
        : undefined;

    const logistics = {
      transportDowngrades: (context.transportPriorities ?? []).filter((p) => !p.wasPreferenceHonored).length,
      restrictionWarnings: Array.isArray(restrictions) ? restrictions.length : 0,
      weatherRisk: weather?.overallRisk ?? 'low',
    };

    if (!finance) return { logistics };
    return { finance, logistics };
  }

  /**
   * Turns the validator's per-traveller scores into something the merge retry
   * can act on: which real travellers scored low, and which of their persona's
   * interest categories the itinerary has little/no content for. The validator
   * response only carries travellerId/label/score (see ScoringEngine.TravellerScore)
   * — persona lives on the orchestrator's own `trip.travellers`, matched back by id.
   *
   * `breakdown` decides `primaryCause`: a score dragged down by budget must not
   * produce a persona-rebalance instruction, which would tell the merge LLM to
   * add *more* content to an itinerary that is already too expensive.
   */
  private buildScoreFeedback(
    overallScore: number,
    scoring: Record<string, unknown>,
    trip: Trip,
    mergedItinerary: Record<string, unknown>,
    breakdown?: ScoreBreakdown,
  ): ScoreFeedback {
    const rawScores = Array.isArray(scoring['scores']) ? (scoring['scores'] as Array<Record<string, unknown>>) : [];
    const itineraryCategories = this.collectItineraryCategories(mergedItinerary);

    const lowScoringTravellers: LowScoringTraveller[] = [];
    for (const row of rawScores) {
      const rowScore = typeof row['score'] === 'number' ? row['score'] : 0;
      if (rowScore >= 60) continue;

      const travellerId = typeof row['travellerId'] === 'string' ? row['travellerId'] : undefined;
      const matched = trip.travellers?.find((t) => t.id === travellerId);
      const personaRaw = matched?.preferences?.['persona'];
      const persona: PersonaKey | null = isPersonaKey(personaRaw) ? personaRaw : null;
      const missingCategories = persona
        ? PERSONA_CATEGORIES[persona].filter(
            (c) => !itineraryCategories.some((ic) => matchesPreferenceTerm(c, ic)),
          )
        : [];

      lowScoringTravellers.push({
        label: typeof row['label'] === 'string' ? row['label'] : 'Traveller',
        persona,
        score: rowScore,
        missingCategories,
      });
    }

    return { overallScore, lowScoringTravellers, primaryCause: this.pickPrimaryCause(breakdown) };
  }

  /** Lowest-scoring available axis; budget wins outright when it capped the score. */
  private pickPrimaryCause(breakdown?: ScoreBreakdown): ScoreFeedback['primaryCause'] {
    if (!breakdown) return 'persona';
    if (breakdown.cappedByBudget) return 'budget';

    const candidates: Array<{ cause: NonNullable<ScoreFeedback['primaryCause']>; score: number }> = [
      { cause: 'persona', score: breakdown.personaScore },
    ];
    if (breakdown.financeScore !== null) candidates.push({ cause: 'budget', score: breakdown.financeScore });
    if (breakdown.logisticsScore !== null) candidates.push({ cause: 'logistics', score: breakdown.logisticsScore });

    return candidates.reduce((worst, c) => (c.score < worst.score ? c : worst)).cause;
  }

  private collectItineraryCategories(mergedItinerary: Record<string, unknown>): string[] {
    const itinerary = mergedItinerary['itinerary'];
    if (!Array.isArray(itinerary)) return [];
    const categories: string[] = [];
    for (const day of itinerary) {
      if (typeof day !== 'object' || day === null) continue;
      const activities = (day as Record<string, unknown>)['activities'];
      if (!Array.isArray(activities)) continue;
      for (const activity of activities) {
        if (typeof activity !== 'object' || activity === null) continue;
        const category = (activity as Record<string, unknown>)['category'];
        if (typeof category === 'string' && category.length > 0) categories.push(category);
      }
    }
    return categories;
  }

  private async finalize(tripId: string, context: WorkflowContext, engineStart: number, lastActionReason?: string): Promise<void> {
    const totalTimeMs = Date.now() - engineStart;
    const isFinish = context.currentState === 'FINISH';
    const budgetFeasible = context.mergedItinerary
      ? (context.mergedItinerary as Record<string, unknown>)['_budgetFeasible'] !== false
      : true;
    const hasItinerary = Boolean(
      context.mergedItinerary &&
      Array.isArray(context.mergedItinerary['itinerary']) &&
      (context.mergedItinerary['itinerary'] as unknown[]).length > 0,
    );
    const overAmount = typeof context.actualCostTotal === 'number'
      ? Math.max(0, Math.round(context.actualCostTotal - context.budgetTotal))
      : 0;
    const overPct = context.budgetTotal > 0 && typeof context.actualCostTotal === 'number'
      ? Math.round((context.actualCostTotal / context.budgetTotal) * 10000) / 100
      : 0;

    const publishItineraryReady = async (): Promise<void> => {
      try {
        await this.eventPublisher.publishToExchange(
          NOTIFICATIONS_EXCHANGE,
          ROUTING_KEY_ITINERARY_READY,
          { tripId, type: 'itinerary_ready', timestamp: new Date().toISOString() },
        );
      } catch (err) {
        this.logger.warn('Failed to publish itinerary-ready event', { tripId, error: String(err) });
      }
    };

    if (isFinish) {
      await this.stateManager.transitionStatus(tripId, 'confirmed');
      this.logger.info('Trip confirmed', { tripId, validationScore: context.validationScore });
      await publishItineraryReady();
    } else if (hasItinerary && budgetFeasible) {
      // Best-effort delivery: retries are exhausted but a complete itinerary
      // exists and the budget isn't structurally impossible. Shipping it
      // flagged over-budget beats cancelling €18 from the target (the exact
      // failure that motivated this path) — the user decides what to do next.
      if (overAmount > 0) {
        context.overBudget = { amountTotal: overAmount, pct: overPct };
        await this.stateManager.saveWorkflowContext(tripId, context);
      }
      await this.stateManager.transitionStatus(tripId, 'confirmed');
      this.logger.info('Trip confirmed best-effort (over budget)', {
        tripId, overAmount, overPct, reason: lastActionReason,
      });
      await publishItineraryReady();
    } else if (!budgetFeasible) {
      const detail = overAmount > 0
        ? `Budget is insufficient for this route — costs ~${Math.round(context.actualCostTotal ?? 0)} ${context.budgetCurrency} against a ${context.budgetTotal} ${context.budgetCurrency} budget, even after cost cutting.`
        : 'Budget is insufficient for this route';
      await this.stateManager.rejectTrip(tripId, detail);
    } else {
      const reason = lastActionReason
        ?? (context.errors.length > 0 ? context.errors[context.errors.length - 1]! : 'Negotiation ended without an itinerary');
      await this.stateManager.transitionStatus(tripId, 'cancelled', undefined, reason);
    }

    await this.stateManager.saveFinalMetric({
      tripId,
      round: 2,
      consensusScore: context.validationScore,
      convergenceRounds: 1,
      forcedConvergence: false,
      financeBlockCount: context.retryCount['finance'] ?? 0,
      logisticsBlockCount: context.retryCount['logistics'] ?? 0,
      totalTokensUsed: context.totalTokensUsed,
      totalTimeMs,
      metadata: { engine: 'v2', finalState: context.currentState, errors: context.errors },
    });

    const payload: NegotiationCompleteEvent = {
      type: 'negotiation_complete',
      rounds: 2,
      forcedConvergence: false,
      consensusScore: context.validationScore ?? 0,
      rejected: !isFinish && !budgetFeasible,
      ...(isFinish ? {} : { reason: lastActionReason }),
      ...(context.overBudget ? { overBudget: context.overBudget } : {}),
    };

    try {
      const event: AgentEvent = {
        tripId,
        type: 'negotiation_complete',
        agent: 'orchestrator',
        round: 2,
        timestamp: new Date().toISOString(),
        content: payload,
      };
      await this.eventPublisher.publish('orchestrator', 'accept', event);
    } catch (err) {
      this.logger.warn('Failed to publish negotiation_complete event', { tripId, error: String(err) });
    }
  }

  private async publishStateEvent(tripId: string, context: WorkflowContext): Promise<void> {
    try {
      const event: AgentEvent = {
        tripId,
        type: `workflow.${context.currentState.toLowerCase()}`,
        agent: 'orchestrator',
        round: 1,
        timestamp: new Date().toISOString(),
        content: { state: context.currentState },
      };
      await this.eventPublisher.publish('orchestrator', 'score', event);
    } catch {
      // Non-critical — state events are for monitoring only
    }
  }

  private async publishAgentEvent(
    tripId: string,
    round: number,
    agent: string,
    action: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    try {
      const event: AgentEvent = {
        tripId,
        type: `agent.${action}`,
        agent: agent as AgentEvent['agent'],
        round,
        timestamp: new Date().toISOString(),
        content,
      };
      await this.eventPublisher.publish(agent as AgentName, action as AgentAction, event);
    } catch {
      // Non-critical — monitoring only
    }
  }

  // Day number for a calendar date, where day 1 = the trip's first date.
  private dayNumberFromDate(baseDate: string, date: string): number {
    return Math.round((Date.parse(date) - Date.parse(baseDate)) / 86400000) + 1;
  }

  // Which city owns each itinerary day, derived from the routeGraph's time
  // windows. This is the source of truth for day→city attribution: a late
  // departure makes the travel date belong to the ORIGIN city (its stay emits
  // the windows for that date), not the destination.
  private buildDayOwnership(routeGraph: RouteGraph): Map<number, { city: string; country: string }> {
    const map = new Map<number, { city: string; country: string }>();
    const base = routeGraph.cityStays[0]?.arrivalDate;
    if (!base) return map;
    for (const stay of routeGraph.cityStays) {
      for (const w of stay.timeWindows) {
        map.set(this.dayNumberFromDate(base, w.date), { city: stay.city, country: stay.country });
      }
    }
    return map;
  }

  // Drops itinerary days a per-city merge call was not asked to own, per
  // buildDayOwnership. A day with no ownership entry (routeGraph gave no
  // routeGraph, or the date falls outside every stay's windows) is kept —
  // absence of ownership data is not evidence of a wrong city.
  private filterOwnedDays<T extends { day?: number }>(
    itinerary: T[],
    dayOwnership: Map<number, { city: string; country: string }>,
    city: string,
  ): T[] {
    if (dayOwnership.size === 0) return itinerary;
    return itinerary.filter((d) => {
      const dayNum = typeof d['day'] === 'number' ? d['day'] : null;
      if (dayNum === null) return true;
      const owner = dayOwnership.get(dayNum);
      if (!owner) return true;
      if (this.normCity(owner.city) === this.normCity(city)) return true;
      this.logger.warn('Dropped itinerary day not owned by this city — likely LLM drift across the merge.txt city-scoping instruction', {
        city, day: dayNum, ownerCity: owner.city,
      });
      return false;
    });
  }

  // Ensures the LLM doesn't drift city names/order away from the canonical destination list.
  private enforceCanonicalDestinations(
    proposal: Record<string, unknown>,
    destinations: Array<{ country: string; city?: string; nights: number }>,
    routeGraph?: RouteGraph,
  ): Record<string, unknown> {
    if (!destinations || destinations.length === 0) return proposal;

    // Prefer window-derived ownership (respects travel-day attribution);
    // fall back to the nights cursor when no routeGraph is available.
    const dayMap = routeGraph ? this.buildDayOwnership(routeGraph) : new Map<number, { city: string; country: string }>();
    let day = 1;
    if (dayMap.size === 0) {
      for (const d of destinations) {
        const city = d.city ?? d.country;
        for (let i = 0; i < d.nights; i++) {
          dayMap.set(day, { city, country: d.country });
          day++;
        }
      }
    } else {
      day = Math.max(...dayMap.keys()) + 1;
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

    for (const d of itinerary) {
      const dayNum = typeof d['day'] === 'number' ? d['day'] : null;
      if (dayNum === null) continue;
      const canon = dayMap.get(dayNum) ?? last;
      if (!canon) continue;
      const cur = typeof d['city'] === 'string' ? d['city'] : '';
      if (this.normCity(cur) !== this.normCity(canon.city)) {
        d['city'] = canon.city;
        d['country'] = canon.country;
      } else if (typeof d['country'] !== 'string' || !d['country']) {
        d['country'] = canon.country;
      }
    }

    let next = proposal;
    if (Array.isArray(proposal['accommodation'])) {
      const kept = (proposal['accommodation'] as Array<Record<string, unknown>>).filter((a) => {
        const city = typeof a['city'] === 'string' ? a['city'] : '';
        return city === '' || inCanonical(city);
      });
      next = { ...proposal, accommodation: kept };
    }

    return { ...next, itinerary };
  }

  // Activities that legitimately live in a blocked transit slot: the journey
  // itself, check-in/out and rest. Everything else is an LLM slip.
  private static readonly TRANSIT_ACTIVITY_PATTERN =
    /travel|fly|flight|drive|depart|journey|transfer|transit|check[ -]?in|check[ -]?out|rest|arriv/i;

  // Deterministic guarantee of "no activities during travel time": merge.txt
  // forbids tourist activities on blocked slots, but that is prompt-level only.
  // Any activity the LLM still placed in a slot the routeGraph marks as
  // transit-blocked is removed here (transit/rest placeholders are kept).
  private stripBlockedSlotActivities(
    proposal: Record<string, unknown>,
    routeGraph: RouteGraph,
  ): Record<string, unknown> {
    const itinerary = Array.isArray(proposal['itinerary'])
      ? (proposal['itinerary'] as Array<Record<string, unknown>>)
      : [];
    if (itinerary.length === 0 || routeGraph.cityStays.length === 0) return proposal;

    const byDay = new Map<number, Record<string, unknown>>();
    for (const d of itinerary) {
      const n = typeof d['day'] === 'number' ? d['day'] : null;
      if (n !== null) byDay.set(n, d);
    }

    // Day numbers derive from window DATES — the windows are the source of
    // truth for which stay owns each calendar day (travel-day attribution).
    const tripBase = routeGraph.cityStays[0]?.arrivalDate;
    if (!tripBase) return proposal;

    for (let i = 0; i < routeGraph.cityStays.length; i++) {
      const stay = routeGraph.cityStays[i];
      if (!stay) continue;

      for (let w = 0; w < stay.timeWindows.length; w++) {
        const window = stay.timeWindows[w];
        if (!window || !window.isTransitDay) continue;
        const day = byDay.get(this.dayNumberFromDate(tripBase, window.date));
        if (!day) continue;

        const activities = Array.isArray(day['activities'])
          ? (day['activities'] as Array<Record<string, unknown>>)
          : [];
        if (activities.length === 0) continue;

        const kept = activities.filter((a) => {
          const time = typeof a['time'] === 'string' ? a['time'].toLowerCase() : '';
          if (time !== window.slot) return true;
          const name = typeof a['activity'] === 'string' ? a['activity'] : '';
          return WorkflowEngine.TRANSIT_ACTIVITY_PATTERN.test(name);
        });
        if (kept.length !== activities.length) {
          this.logger.warn('Removed LLM activities from blocked transit slot', {
            city: stay.city,
            date: window.date,
            slot: window.slot,
            reason: window.blockedReason,
            removed: activities.length - kept.length,
          });
          day['activities'] = kept;
        }
      }
    }

    return { ...proposal, itinerary };
  }

  // Inject real transport legs from routeGraph into the merged itinerary.
  // orderedLegs[i] = leg from destinations[i] → destinations[i+1]. The transit
  // day is the leg's departure DATE — which, under travel-day attribution, may
  // be labelled with the origin city (late departure) or the destination
  // (morning departure). We stamp it with the structured transport array so
  // the frontend and PDF can render it.
  private injectRouteGraphTransport(
    proposal: Record<string, unknown>,
    routeGraph: RouteGraph,
    destinations: Array<{ city?: string; country: string; nights: number }>,
  ): Record<string, unknown> {
    if (routeGraph.orderedLegs.length === 0 || destinations.length < 2) return proposal;

    const itinerary = Array.isArray(proposal['itinerary'])
      ? (proposal['itinerary'] as Array<Record<string, unknown>>)
      : [];

    const byDay = new Map<number, Record<string, unknown>>();
    for (const d of itinerary) {
      const n = typeof d['day'] === 'number' ? d['day'] : null;
      if (n !== null) byDay.set(n, d);
    }

    const tripBase = routeGraph.cityStays[0]?.arrivalDate;
    if (!tripBase) return proposal;

    const transitionDays = new Set<number>();

    for (let i = 0; i < routeGraph.orderedLegs.length; i++) {
      const leg = routeGraph.orderedLegs[i];
      if (!leg) continue;
      const tDayNum = this.dayNumberFromDate(tripBase, leg.departureDate);
      const tDay = byDay.get(tDayNum);
      if (!tDay) continue;

      const best = leg.bestOption;
      if (!best || best.durationMinutes === 0) continue;

      transitionDays.add(tDayNum);

      const fromCity = destinations[i]?.city ?? destinations[i]?.country ?? leg.from;
      const toCity = destinations[i + 1]?.city ?? destinations[i + 1]?.country ?? leg.to;

      tDay['transport'] = [this.buildTransportEntry(fromCity, toCity, best, leg.alternatives)];
      tDay['cityTransition'] = { to: toCity, travelTime: this.travelTimeLabel(best) };
      this.snapTravelSlot(tDay, best.departureTime);
    }

    // Remove stray LLM cityTransitions on non-travel days
    for (const day of itinerary) {
      const n = typeof day['day'] === 'number' ? day['day'] : null;
      if (n !== null && !transitionDays.has(n) && day['cityTransition']) {
        delete day['cityTransition'];
      }
    }

    return { ...proposal, itinerary };
  }

  private buildTransportEntry(
    from: string,
    to: string,
    best: TransportOption,
    alternatives: TransportOption[],
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
      alternatives: alternatives.slice(0, 3),
    };
  }

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
}
