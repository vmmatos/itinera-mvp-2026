import type { Place } from '@/services/PlacesService';

export interface PriceDetail {
  amount: number;
  isEstimate: boolean;
  source: string;
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
