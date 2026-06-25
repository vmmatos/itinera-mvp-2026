import type { LogisticsVerdict, TransportOption } from '@itinera/shared';
import type { TimingValidationResult } from '@/validators/TimingValidator';
import type { RestrictionWarning } from '@/validators/RestrictionsValidator';

/** A travel leg longer than this means the day should carry fewer activities (folded #72). */
const LONG_TRAVEL_DAY_MINUTES = 240; // 4h

interface VerdictInput {
  overallRisk?: unknown; // 'low' | 'medium' | 'high' from the AI assessment
  aiTimingIssues?: unknown[]; // content.timingIssues from the AI assessment
  timingResult: TimingValidationResult;
  restrictionWarnings: RestrictionWarning[];
  transportOptions: Record<number, TransportOption[]>;
}

/**
 * Derive Logistics' stance on the current proposal (card #79).
 *
 * `approved` is true only when the itinerary is physically feasible AND carries
 * no outstanding warnings — so any warning keeps the negotiation loop running
 * until the Orchestrator refines it away.
 */
export function buildLogisticsVerdict(input: VerdictInput): LogisticsVerdict {
  const warnings: string[] = [];

  const criticalTiming = input.timingResult.conflicts.filter((c) => c.severity === 'critical');
  for (const c of criticalTiming) warnings.push(`Day ${c.day}: ${c.description}`);
  for (const w of input.timingResult.warnings) warnings.push(`Day ${w.day}: ${w.description}`);

  // Transport: tight connections (<2h, set upstream) + long travel days (>4h).
  for (const [dayStr, opts] of Object.entries(input.transportOptions)) {
    const best = opts[0];
    if (!best) continue;
    for (const w of best.warnings) warnings.push(`Day ${dayStr}: ${w}`);
    if (best.durationMinutes > LONG_TRAVEL_DAY_MINUTES) {
      const hours = Math.round((best.durationMinutes / 60) * 10) / 10;
      warnings.push(`Day ${dayStr}: long travel leg (~${hours}h) — reduce activities planned for this day`);
    }
  }

  for (const r of input.restrictionWarnings) warnings.push(`Day ${r.day}: ${r.message}`);

  if (Array.isArray(input.aiTimingIssues)) {
    for (const issue of input.aiTimingIssues) {
      const i = issue as Record<string, unknown>;
      if (typeof i['issue'] === 'string') warnings.push(`Day ${i['day'] ?? '?'}: ${i['issue']}`);
    }
  }

  const overallRisk = typeof input.overallRisk === 'string' ? input.overallRisk : 'low';
  const highRisk = overallRisk === 'high';
  const hasCritical = criticalTiming.length > 0;
  const approved = !highRisk && !hasCritical && warnings.length === 0;

  return {
    approved,
    warnings,
    reasoning: approved
      ? 'Itinerary is physically feasible: no timing conflicts, manageable transport, acceptable weather risk.'
      : `Feasibility issues: ${highRisk ? 'high weather risk; ' : ''}${
          hasCritical ? `${criticalTiming.length} critical timing conflict(s); ` : ''
        }${warnings.length} warning(s) to address.`,
  };
}
