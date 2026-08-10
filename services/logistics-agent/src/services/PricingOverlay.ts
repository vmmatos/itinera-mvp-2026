import type { PricingEnrichment } from '@/services/PricingEnricher';
import type { PriceDetail } from '@/services/RestaurantPricing';

export interface PricedItem {
  venue?: string;
  estimatedCostPerPerson?: number;
  isEstimate?: boolean;
  source?: string;
  [key: string]: unknown;
}

export interface PricedMeal {
  estimatedCostPerPerson: number;
  isEstimate: boolean;
  source: string;
}

export interface PricedDay {
  day: number;
  activities: PricedItem[];
  meals: PricedMeal[];
  [key: string]: unknown;
}

export interface PricedAccommodation {
  city?: string;
  pricePerNightPerPerson?: number;
  isEstimate?: boolean;
  source?: string;
  /** True when the real price exceeds the /plan envelope's per-night ceiling for this city. */
  aboveCeiling?: boolean;
  [key: string]: unknown;
}

export interface PricingOverlayResult {
  itinerary: PricedDay[];
  accommodation: PricedAccommodation[];
  /** Count of activities whose LLM guess was replaced by a real DB price — for SSE/logging. */
  repricedCount: number;
}

/**
 * Overlays real pricing (attraction DB, Google Places restaurant estimates,
 * hotel price lookups — all already computed by PricingEnricher.enrich())
 * onto a merged itinerary's cost fields, which otherwise only ever carry the
 * merge LLM's own unlabelled guess. This overlay step has never existed in
 * this codebase before: PricingEnricher's output was previously only
 * surfaced as read-only advisory data, never applied back onto CostItems.
 */
export function applyPricingOverlay(
  itinerary: PricedDay[],
  accommodation: PricedAccommodation[],
  pricing: PricingEnrichment,
  mealsPerDay: number,
): PricingOverlayResult {
  let repricedCount = 0;

  const pricedItinerary = itinerary.map((day) => {
    const activities = day.activities.map((activity) => {
      const key = activity.venue?.toLowerCase();
      const match: PriceDetail | undefined = key ? pricing.activityPriceByName[key] : undefined;

      if (match && match.source !== 'heuristic_estimate') {
        repricedCount += 1;
        return {
          ...activity,
          estimatedCostPerPerson: match.amount,
          isEstimate: false,
          source: match.source,
        };
      }

      // No real match — keep the LLM's own (usually more contextual) guess,
      // but tag it honestly instead of letting it default to "confirmed real"
      // downstream in BudgetBreakdownBuilder.aggregateFlags.
      return {
        ...activity,
        isEstimate: true,
        source: 'llm_estimate',
      };
    });

    const meal: PricedMeal = {
      estimatedCostPerPerson: pricing.restaurantPricePerMeal.amount * mealsPerDay,
      isEstimate: pricing.restaurantPricePerMeal.isEstimate,
      source: pricing.restaurantPricePerMeal.source,
    };

    return { ...day, activities, meals: [meal] };
  });

  const pricedAccommodation = accommodation.map((entry) => {
    const match = entry.city ? pricing.accommodationByCity[entry.city] : undefined;
    if (!match) return entry;

    return {
      ...entry,
      pricePerNightPerPerson: match.amount,
      isEstimate: match.isEstimate,
      source: match.source,
      ...(match.aboveCeiling ? { aboveCeiling: true } : {}),
    };
  });

  return { itinerary: pricedItinerary, accommodation: pricedAccommodation, repricedCount };
}
