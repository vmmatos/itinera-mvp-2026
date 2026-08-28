import type { Place } from '@/services/PlacesService';

export interface PriceDetail {
  amount: number;
  isEstimate: boolean;
  source: string;
  /** True when this price is known to exceed the caller's budget ceiling. */
  aboveCeiling?: boolean;
}

// Google Places price_level (0-4) mapped to an estimated EUR cost per meal per
// person. Level 2 ("€€") is the card's own worked example (~€25/meal).
const PRICE_LEVEL_TO_EUR_PER_MEAL: Record<number, number> = {
  0: 8,
  1: 12,
  2: 25,
  3: 45,
  4: 80,
};

const DEFAULT_PRICE_LEVEL = 2;

/** Default per-meal estimate (€€ level) — also used by /plan's envelope reserve. */
export const DEFAULT_MEAL_PRICE_EUR = PRICE_LEVEL_TO_EUR_PER_MEAL[DEFAULT_PRICE_LEVEL]!;

/** How many restaurant picks to keep per city (rotation headroom across days). */
export const DEFAULT_PICKS_PER_CITY = 6;

/** A single restaurant recommendation with its own per-meal-per-person cost. */
export interface RestaurantPick {
  name: string;
  /** Neighbourhood / short address, when the search returned one. */
  area?: string;
  /** Google rating (0-5), when present. */
  rating?: number;
  /** Google Places price_level (0-4), when present. */
  priceLevel?: number;
  /** Per-meal-per-person EUR estimate derived from this venue's price level. */
  estimatedCostPerPerson: number;
  isEstimate: boolean;
  source: string;
  location?: { lat: number; lng: number };
}

/** Maps a Google price_level (0-4) to a per-meal-per-person EUR cost. */
export function priceLevelToMealCost(level: number | null | undefined): PriceDetail {
  if (typeof level === 'number' && level >= 0 && level <= 4) {
    return {
      amount: PRICE_LEVEL_TO_EUR_PER_MEAL[level]!,
      isEstimate: false,
      source: 'google_places_price_level',
    };
  }
  return { amount: DEFAULT_MEAL_PRICE_EUR, isEstimate: true, source: 'heuristic_estimate' };
}

/**
 * Ranks a region's restaurant search results into the top `limit` picks —
 * highest rated first, venues with a known price level preferred on ties,
 * original Places relevance order as the final tie-break. Blank names are
 * dropped and venues de-duplicated by name (text search repeats venues).
 */
export function pickTopRestaurants(restaurants: Place[], limit: number): RestaurantPick[] {
  if (limit <= 0) return [];

  const seen = new Set<string>();
  const deduped = restaurants
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => {
      const key = r.name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  deduped.sort((a, b) => {
    const ratingDelta = (b.r.rating ?? 0) - (a.r.rating ?? 0);
    if (ratingDelta !== 0) return ratingDelta;
    const aHasLevel = typeof a.r.priceLevel === 'number';
    const bHasLevel = typeof b.r.priceLevel === 'number';
    if (aHasLevel !== bHasLevel) return aHasLevel ? -1 : 1;
    return a.index - b.index;
  });

  return deduped.slice(0, limit).map(({ r }) => {
    const cost = priceLevelToMealCost(r.priceLevel);
    return {
      name: r.name.trim(),
      ...(r.vicinity?.trim() ? { area: r.vicinity.trim() } : {}),
      ...(typeof r.rating === 'number' ? { rating: r.rating } : {}),
      ...(typeof r.priceLevel === 'number' ? { priceLevel: r.priceLevel } : {}),
      estimatedCostPerPerson: cost.amount,
      isEstimate: cost.isEstimate,
      source: cost.source,
      ...(r.location ? { location: r.location } : {}),
    };
  });
}

/** Blends a region's restaurant search results into a single per-meal estimate. */
export function estimateMealPriceEur(restaurants: Place[]): PriceDetail {
  const levels = restaurants
    .map((r) => r.priceLevel)
    .filter((l): l is number => typeof l === 'number');

  if (levels.length === 0) {
    return {
      amount: PRICE_LEVEL_TO_EUR_PER_MEAL[DEFAULT_PRICE_LEVEL]!,
      isEstimate: true,
      source: 'heuristic_estimate',
    };
  }

  const avgLevel = levels.reduce((s, l) => s + l, 0) / levels.length;
  const nearestLevel = Math.min(4, Math.max(0, Math.round(avgLevel)));

  return {
    amount: PRICE_LEVEL_TO_EUR_PER_MEAL[nearestLevel]!,
    isEstimate: false,
    source: 'google_places_price_level',
  };
}
