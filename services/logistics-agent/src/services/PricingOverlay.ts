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
  /** Slot label — 'Lunch' | 'Dinner' | 'Breakfast' | 'Meal N', or 'Meals' for the fallback line. */
  type: string;
  /** Restaurant name, or 'Local restaurants' for the cost-only fallback line. */
  name: string;
  /** Neighbourhood / area, when the restaurant search returned one. */
  location?: string;
  /** Google rating (0-5), when present. */
  rating?: number;
  estimatedCostPerPerson: number;
  isEstimate: boolean;
  source: string;
}

export interface PricedDay {
  day: number;
  city?: string;
  activities: PricedItem[];
  meals: PricedMeal[];
  [key: string]: unknown;
}

/** Slot labels by index; extra slots beyond the list fall back to "Meal N". */
const MEAL_LABELS = ['Lunch', 'Dinner', 'Breakfast'];
const mealLabel = (i: number): string => MEAL_LABELS[i] ?? `Meal ${i + 1}`;

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
  /** Count of meal entries populated with a real named restaurant — for SSE/logging. */
  mealsNamedCount: number;
}

/**
 * Overlays real pricing (attraction DB, Google Places restaurant estimates,
 * hotel price lookups — all already computed by PricingEnricher.enrich())
 * onto a merged itinerary's cost fields, which otherwise only ever carry the
 * merge LLM's own unlabelled guess. Also replaces each day's meal budget line
 * with `mealsPerDay` real named restaurant picks for that day's city (rotating
 * through the city's list), falling back to the cost-only line when a city has
 * no picks.
 */
export function applyPricingOverlay(
  itinerary: PricedDay[],
  accommodation: PricedAccommodation[],
  pricing: PricingEnrichment,
  mealsPerDay: number,
): PricingOverlayResult {
  let repricedCount = 0;
  let mealsNamedCount = 0;
  // Per-city cursor so consecutive days in the same city don't repeat venues.
  const cursorByCity = new Map<string, number>();

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

    const city = typeof day.city === 'string' ? day.city : undefined;
    const picks = (city && pricing.restaurantsByCity[city]) || [];

    let meals: PricedMeal[];
    if (picks.length === 0) {
      // No real venues for this city — keep the cost-only budget line so
      // Finance still sees the spend and the PDF/timeline still render.
      meals = [
        {
          type: 'Meals',
          name: 'Local restaurants',
          estimatedCostPerPerson: pricing.restaurantPricePerMeal.amount * mealsPerDay,
          isEstimate: pricing.restaurantPricePerMeal.isEstimate,
          source: pricing.restaurantPricePerMeal.source,
        },
      ];
    } else {
      const start = cursorByCity.get(city!) ?? 0;
      meals = Array.from({ length: mealsPerDay }, (_, i) => {
        const pick = picks[(start + i) % picks.length]!;
        mealsNamedCount += 1;
        return {
          type: mealLabel(i),
          name: pick.name,
          ...(pick.area ? { location: pick.area } : {}),
          ...(pick.rating !== undefined ? { rating: pick.rating } : {}),
          estimatedCostPerPerson: pick.estimatedCostPerPerson,
          isEstimate: pick.isEstimate,
          source: pick.source,
        };
      });
      cursorByCity.set(city!, (start + mealsPerDay) % picks.length);
    }

    return { ...day, activities, meals };
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

  return {
    itinerary: pricedItinerary,
    accommodation: pricedAccommodation,
    repricedCount,
    mealsNamedCount,
  };
}
