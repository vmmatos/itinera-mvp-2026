import type {
  BudgetBreakdown,
  BudgetCategory,
  BudgetCategoryDetail,
  BudgetOverrun,
  SuggestedCut,
} from '@itinera/shared';
import type { AccommodationItem, CostBreakdown, CostItem, ItineraryDay, TransportItem } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';

// Added contingency on top of the four priced categories, per issue #73.
const BUFFER_RATIO = 0.1;

interface ItemWithFlags {
  isEstimate?: boolean;
  source?: string;
}

// `defaultIsEstimate` covers items with no isEstimate/source at all (older
// fixtures, or categories this PR doesn't touch): transport was already real
// before issue #73 (resolved by TransportService), so untagged transport
// items default to "not an estimate"; accommodation/restaurants/activities
// were previously pure LLM guesses, so untagged items there default to
// "estimate" until logistics-agent's real-pricing merge tags them otherwise.
function aggregateFlags(
  items: ItemWithFlags[],
  defaultIsEstimate: boolean,
): { isEstimate: boolean; source: string } {
  if (items.length === 0) return { isEstimate: defaultIsEstimate, source: 'heuristic_estimate' };
  const isEstimate = items.some((i) => i.isEstimate ?? defaultIsEstimate);
  const sources = [...new Set(items.map((i) => i.source ?? 'heuristic_estimate'))];
  return { isEstimate, source: sources.length === 1 ? sources[0]! : 'mixed' };
}

/**
 * Builds the itemised, per-category, per-person budget breakdown (issue #73)
 * from the existing CostBreakdown/BudgetValidation. Buffer is an added
 * contingency, so `grandTotal` here includes it — a stricter check than
 * BudgetValidator's own (pre-buffer) within/over-budget signal, which still
 * drives the negotiation loop's convergence condition.
 */
export function buildBudgetBreakdown(
  breakdown: CostBreakdown,
  itinerary: ItineraryDay[],
  accommodation: AccommodationItem[],
  validation: BudgetValidation,
): BudgetBreakdown {
  const { groupSize, currency } = breakdown;
  const perPerson = (total: number): number =>
    groupSize > 0 ? Math.round((total / groupSize) * 100) / 100 : total;

  const detail = (
    total: number,
    items: ItemWithFlags[],
    defaultIsEstimate: boolean,
  ): BudgetCategoryDetail => {
    const flags = aggregateFlags(items, defaultIsEstimate);
    return {
      amountTotal: total,
      amountPerPerson: perPerson(total),
      isEstimate: flags.isEstimate,
      source: flags.source,
    };
  };

  const bufferTotal = Math.round(
    (breakdown.byCategory.accommodation +
      breakdown.byCategory.activities +
      breakdown.byCategory.meals +
      breakdown.byCategory.transport) *
      BUFFER_RATIO,
  );

  const categories: BudgetBreakdown['categories'] = {
    accommodation: detail(breakdown.byCategory.accommodation, accommodation as ItemWithFlags[], true),
    restaurants: detail(
      breakdown.byCategory.meals,
      itinerary.flatMap((d) => d.meals) as (CostItem & ItemWithFlags)[],
      true,
    ),
    activities: detail(
      breakdown.byCategory.activities,
      itinerary.flatMap((d) => d.activities) as (CostItem & ItemWithFlags)[],
      true,
    ),
    transport: detail(
      breakdown.byCategory.transport,
      itinerary.flatMap((d) => d.transport) as (TransportItem & ItemWithFlags)[],
      false,
    ),
    buffer: {
      amountTotal: bufferTotal,
      amountPerPerson: perPerson(bufferTotal),
      isEstimate: false,
      source: 'heuristic_estimate',
    },
  };

  const grandTotal = breakdown.grandTotal + bufferTotal;
  const overAmount = grandTotal - validation.budgetTotal;
  const status: 'within_budget' | 'over_budget' = overAmount > 0 ? 'over_budget' : 'within_budget';

  const overruns: BudgetOverrun[] = [];
  if (overAmount > 0 && grandTotal > 0) {
    for (const [category, categoryDetail] of Object.entries(categories) as Array<[BudgetCategory, BudgetCategoryDetail]>) {
      if (categoryDetail.amountTotal <= 0) continue;
      const overAmountTotal = Math.round(overAmount * (categoryDetail.amountTotal / grandTotal));
      if (overAmountTotal <= 0) continue;
      overruns.push({ category, overAmountTotal, overAmountPerPerson: perPerson(overAmountTotal) });
    }
    overruns.sort((a, b) => b.overAmountTotal - a.overAmountTotal);
  }

  return {
    currency,
    currencyMismatch: validation.currency !== 'EUR',
    groupSize,
    categories,
    perPersonTotal: perPerson(grandTotal),
    grandTotal,
    budgetTotal: validation.budgetTotal,
    status,
    percentageUsed: validation.budgetTotal > 0 ? Math.round((grandTotal / validation.budgetTotal) * 10000) / 100 : 0,
    overruns,
    suggestedCuts: [],
  };
}

interface AlternativeSuggestion {
  category?: string;
  suggestion?: { name?: string; venue?: string; saving?: number };
  rationale?: string;
}

const CUT_CATEGORIES: ReadonlySet<string> = new Set(['accommodation', 'restaurants', 'activities', 'transport', 'meals']);

/** Maps AlternativeFinder's free-form LLM suggestions into structured SuggestedCut entries. */
export function mapAlternativesToSuggestedCuts(
  alternatives: { suggestions?: AlternativeSuggestion[] } | null | undefined,
  groupSize: number,
): SuggestedCut[] {
  const suggestions = alternatives?.suggestions ?? [];

  return suggestions
    .filter((s) => typeof s.category === 'string' && CUT_CATEGORIES.has(s.category))
    .map((s): SuggestedCut => {
      const savingPerPerson = s.suggestion?.saving ?? 0;
      const name = s.suggestion?.name ?? s.suggestion?.venue ?? 'alternative';
      const category = s.category === 'meals' ? 'restaurants' : (s.category as SuggestedCut['category']);
      return {
        category,
        description: s.rationale ? `${name} — ${s.rationale}` : name,
        savingPerPerson,
        savingTotal: Math.round(savingPerPerson * groupSize),
      };
    })
    .filter((cut) => cut.savingPerPerson > 0);
}
