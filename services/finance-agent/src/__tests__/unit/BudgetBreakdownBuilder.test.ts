import { describe, it, expect } from 'vitest';
import { buildBudgetBreakdown, mapAlternativesToSuggestedCuts } from '@/agents/BudgetBreakdownBuilder';
import type { CostBreakdown, ItineraryDay, AccommodationItem } from '@/agents/CostCalculator';
import type { BudgetValidation } from '@/agents/BudgetValidator';

function breakdown(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    byCategory: { accommodation: 200, activities: 100, meals: 100, transport: 100 },
    perPersonTotal: 500,
    grandTotal: 500,
    groupSize: 1,
    currency: 'EUR',
    items: [],
    ...overrides,
  };
}

function validation(overrides: Partial<BudgetValidation> = {}): BudgetValidation {
  return {
    status: 'within_budget',
    percentageUsed: 90,
    remaining: 50,
    budgetTotal: 550,
    currency: 'EUR',
    ...overrides,
  };
}

describe('buildBudgetBreakdown', () => {
  it('builds per-category per-person amounts including a 10% buffer', () => {
    const bd = buildBudgetBreakdown(breakdown(), [], [], validation());

    expect(bd.categories.accommodation.amountTotal).toBe(200);
    expect(bd.categories.restaurants.amountTotal).toBe(100);
    expect(bd.categories.activities.amountTotal).toBe(100);
    expect(bd.categories.transport.amountTotal).toBe(100);
    expect(bd.categories.buffer.amountTotal).toBe(50); // 10% of 500
    expect(bd.grandTotal).toBe(550);
    expect(bd.perPersonTotal).toBe(550); // groupSize 1
  });

  it('divides amounts per person for a group', () => {
    const bd = buildBudgetBreakdown(breakdown({ groupSize: 2 }), [], [], validation({ budgetTotal: 1100 }));

    expect(bd.categories.accommodation.amountPerPerson).toBe(100);
    expect(bd.perPersonTotal).toBe(275); // 550/2
  });

  it('flags accommodation/restaurants/activities as estimates when items carry no pricing source', () => {
    const accommodation: AccommodationItem[] = [{ city: 'Lisbon', pricePerNightPerPerson: 200, nights: 1 }];
    const bd = buildBudgetBreakdown(breakdown(), [], accommodation, validation());

    expect(bd.categories.accommodation.isEstimate).toBe(true);
    expect(bd.categories.accommodation.source).toBe('heuristic_estimate');
  });

  it('marks a category as real when every item is tagged isEstimate: false', () => {
    const accommodation: AccommodationItem[] = [
      { city: 'Lisbon', pricePerNightPerPerson: 200, nights: 1, isEstimate: false, source: 'serpapi_google_hotels' },
    ];
    const bd = buildBudgetBreakdown(breakdown(), [], accommodation, validation());

    expect(bd.categories.accommodation.isEstimate).toBe(false);
    expect(bd.categories.accommodation.source).toBe('serpapi_google_hotels');
  });

  it('marks a category mixed when items come from different sources', () => {
    const itinerary: ItineraryDay[] = [{
      day: 1,
      activities: [
        { name: 'A', estimatedCostPerPerson: 50, isEstimate: false, source: 'attraction_db' },
        { name: 'B', estimatedCostPerPerson: 50, isEstimate: false, source: 'heuristic_estimate' },
      ],
      meals: [],
      transport: [],
    }];
    const bd = buildBudgetBreakdown(breakdown(), itinerary, [], validation());

    expect(bd.categories.activities.source).toBe('mixed');
  });

  it('does not default transport to "estimate" when untagged (transport was already real pre-#73)', () => {
    const itinerary: ItineraryDay[] = [{
      day: 1, activities: [], meals: [],
      transport: [{ from: 'A', to: 'B', priceEur: 30 }],
    }];
    const bd = buildBudgetBreakdown(breakdown(), itinerary, [], validation());

    expect(bd.categories.transport.isEstimate).toBe(false);
  });

  it('flags overruns proportionally to each category share when over budget', () => {
    // grandTotal (incl. 10% buffer) = 550; budget 400 => over by 150
    const bd = buildBudgetBreakdown(breakdown(), [], [], validation({ budgetTotal: 400 }));

    expect(bd.status).toBe('over_budget');
    expect(bd.overruns.length).toBeGreaterThan(0);
    const total = bd.overruns.reduce((s, o) => s + o.overAmountTotal, 0);
    // proportional split should sum close to the total overage (rounding tolerance)
    expect(Math.abs(total - 150)).toBeLessThanOrEqual(bd.overruns.length);
    // largest category (accommodation) should have the largest overrun share
    expect(bd.overruns[0]?.category).toBe('accommodation');
  });

  it('reports no overruns when within budget', () => {
    const bd = buildBudgetBreakdown(breakdown(), [], [], validation({ budgetTotal: 10_000 }));
    expect(bd.status).toBe('within_budget');
    expect(bd.overruns).toEqual([]);
  });

  it('flags a currency mismatch when the trip budget is not EUR', () => {
    const bd = buildBudgetBreakdown(breakdown(), [], [], validation({ currency: 'USD' }));
    expect(bd.currencyMismatch).toBe(true);
  });
});

describe('mapAlternativesToSuggestedCuts', () => {
  it('maps LLM suggestions with a positive saving into structured cuts', () => {
    const cuts = mapAlternativesToSuggestedCuts({
      suggestions: [
        { category: 'accommodation', suggestion: { name: 'Hostel X', saving: 45 }, rationale: 'Cheaper but central' },
      ],
    }, 2);

    expect(cuts).toEqual([
      { category: 'accommodation', description: 'Hostel X — Cheaper but central', savingPerPerson: 45, savingTotal: 90 },
    ]);
  });

  it('maps "meals" category to "restaurants"', () => {
    const cuts = mapAlternativesToSuggestedCuts({
      suggestions: [{ category: 'meals', suggestion: { name: 'Local tasca', saving: 10 } }],
    }, 1);

    expect(cuts[0]?.category).toBe('restaurants');
  });

  it('drops suggestions with zero or negative saving', () => {
    const cuts = mapAlternativesToSuggestedCuts({
      suggestions: [{ category: 'activities', suggestion: { name: 'Free museum', saving: 0 } }],
    }, 1);

    expect(cuts).toEqual([]);
  });

  it('returns an empty array when alternatives is null/undefined', () => {
    expect(mapAlternativesToSuggestedCuts(null, 1)).toEqual([]);
    expect(mapAlternativesToSuggestedCuts(undefined, 1)).toEqual([]);
  });

  it('drops suggestions with an unrecognised category', () => {
    const cuts = mapAlternativesToSuggestedCuts({
      suggestions: [{ category: 'insurance', suggestion: { name: 'Skip it', saving: 20 } }],
    }, 1);
    expect(cuts).toEqual([]);
  });
});
