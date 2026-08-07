import type { TouristSlotInput } from '@itinera/shared';

export interface CityBudgetOverrun {
  city: string;
  budgetPerPersonBlock: number;
  proposedTotalPerPerson: number;
  overByPerPerson: number;
}

interface CostedProposal {
  city?: unknown;
  estimatedCostPerPerson?: unknown;
}

/**
 * Per-city overrun of one persona's own slot proposals against the experiences
 * budget the orchestrator computed for that city (`budgetPerPersonBlock`).
 *
 * Compared per persona rather than across all four: only one persona's proposal
 * wins each slot, so the merged itinerary costs roughly one persona's worth of
 * activities per city — summing all four would compare against a total that
 * never actually gets booked.
 *
 * A city with a budget of 0 is skipped rather than treated as "everything is an
 * overrun": `WorkflowEngine.executeTouristAgents` falls back to 0 when no
 * matching budget block is found, which means "unknown", not "free".
 */
export function findBudgetOverruns(
  slotProposals: readonly CostedProposal[],
  slots: readonly TouristSlotInput[],
): CityBudgetOverrun[] {
  const budgetByCity = new Map<string, number>();
  for (const slot of slots) {
    if (slot.budgetPerPersonBlock > 0) budgetByCity.set(slot.city, slot.budgetPerPersonBlock);
  }
  if (budgetByCity.size === 0) return [];

  const proposedByCity = new Map<string, number>();
  for (const proposal of slotProposals) {
    if (typeof proposal.city !== 'string') continue;
    if (!budgetByCity.has(proposal.city)) continue;
    const cost = typeof proposal.estimatedCostPerPerson === 'number' ? proposal.estimatedCostPerPerson : 0;
    proposedByCity.set(proposal.city, (proposedByCity.get(proposal.city) ?? 0) + cost);
  }

  const overruns: CityBudgetOverrun[] = [];
  for (const [city, budget] of budgetByCity) {
    const proposed = proposedByCity.get(city) ?? 0;
    if (proposed > budget) {
      overruns.push({
        city,
        budgetPerPersonBlock: budget,
        proposedTotalPerPerson: proposed,
        overByPerPerson: Math.round((proposed - budget) * 100) / 100,
      });
    }
  }
  return overruns;
}

/** Corrective instruction naming each overrun, for the re-ask. */
export function buildBudgetCorrectionMessage(overruns: readonly CityBudgetOverrun[], currency: string): string {
  const perCity = overruns
    .map(
      (o) =>
        `${o.city}: you proposed ${o.proposedTotalPerPerson} ${currency}/person against a budget of ${o.budgetPerPersonBlock} ${currency}/person (over by ${o.overByPerPerson})`,
    )
    .join('; ');
  return (
    `Your proposals exceed the experiences budget for one or more cities — ${perCity}. ` +
    `Revise so each city's total estimatedCostPerPerson fits within its budgetPerPersonBlock. ` +
    `Prefer cheaper or free alternatives that still fit your persona rather than dropping slots entirely. ` +
    `Reply with corrected JSON only, no explanation.`
  );
}
