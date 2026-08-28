import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEAL_PRICE_EUR,
  estimateMealPriceEur,
  pickTopRestaurants,
  priceLevelToMealCost,
} from '@/services/RestaurantPricing';
import type { Place } from '@/services/PlacesService';

function place(priceLevel: number | null): Place {
  return {
    id: 'p', name: 'Restaurant', location: { lat: 0, lng: 0 },
    category: 'restaurant', rating: null, priceLevel, openingHours: {}, metadata: {},
  };
}

function restaurant(overrides: Partial<Place>): Place {
  return {
    id: 'r', name: 'Venue', location: { lat: 1, lng: 2 },
    category: 'restaurant', rating: null, priceLevel: null, openingHours: {}, metadata: {},
    ...overrides,
  };
}

describe('estimateMealPriceEur', () => {
  it('maps a blended price level to the correct EUR estimate', () => {
    const result = estimateMealPriceEur([place(2), place(2)]);
    expect(result).toEqual({ amount: 25, isEstimate: false, source: 'google_places_price_level' });
  });

  it('averages and rounds mixed price levels', () => {
    const result = estimateMealPriceEur([place(1), place(3)]); // avg 2 -> level 2
    expect(result.amount).toBe(25);
    expect(result.isEstimate).toBe(false);
  });

  it('falls back to a heuristic estimate when no restaurants have a price level', () => {
    const result = estimateMealPriceEur([place(null), place(null)]);
    expect(result).toEqual({ amount: 25, isEstimate: true, source: 'heuristic_estimate' });
  });

  it('falls back to a heuristic estimate when the list is empty', () => {
    const result = estimateMealPriceEur([]);
    expect(result.isEstimate).toBe(true);
    expect(result.source).toBe('heuristic_estimate');
  });

  it('ignores entries without a price level when averaging', () => {
    const result = estimateMealPriceEur([place(4), place(null)]);
    expect(result).toEqual({ amount: 80, isEstimate: false, source: 'google_places_price_level' });
  });
});

describe('priceLevelToMealCost', () => {
  it('maps a known price level to a confirmed EUR cost', () => {
    expect(priceLevelToMealCost(1)).toEqual({ amount: 12, isEstimate: false, source: 'google_places_price_level' });
    expect(priceLevelToMealCost(4)).toEqual({ amount: 80, isEstimate: false, source: 'google_places_price_level' });
  });

  it('falls back to the €€ default estimate when the level is missing or out of range', () => {
    for (const level of [undefined, null, -1, 5]) {
      expect(priceLevelToMealCost(level)).toEqual({
        amount: DEFAULT_MEAL_PRICE_EUR, isEstimate: true, source: 'heuristic_estimate',
      });
    }
  });
});

describe('pickTopRestaurants', () => {
  it('ranks by rating desc and respects the limit', () => {
    const picks = pickTopRestaurants(
      [
        restaurant({ name: 'Low', rating: 3.9 }),
        restaurant({ name: 'High', rating: 4.8 }),
        restaurant({ name: 'Mid', rating: 4.4 }),
      ],
      2,
    );
    expect(picks.map((p) => p.name)).toEqual(['High', 'Mid']);
  });

  it('clamps to the number of available venues', () => {
    const picks = pickTopRestaurants([restaurant({ name: 'Only' })], 5);
    expect(picks).toHaveLength(1);
  });

  it('prefers venues with a known price level on a rating tie', () => {
    const picks = pickTopRestaurants(
      [
        restaurant({ name: 'NoLevel', rating: 4.5 }),
        restaurant({ name: 'HasLevel', rating: 4.5, priceLevel: 2 }),
      ],
      2,
    );
    expect(picks[0].name).toBe('HasLevel');
  });

  it('derives per-meal cost from the price level, or the default when absent', () => {
    const [withLevel, without] = pickTopRestaurants(
      [
        restaurant({ name: 'Cheap', rating: 4.6, priceLevel: 1 }),
        restaurant({ name: 'Unknown', rating: 4.5 }),
      ],
      2,
    );
    expect(withLevel).toMatchObject({ estimatedCostPerPerson: 12, isEstimate: false, source: 'google_places_price_level' });
    expect(without).toMatchObject({
      estimatedCostPerPerson: DEFAULT_MEAL_PRICE_EUR, isEstimate: true, source: 'heuristic_estimate',
    });
  });

  it('drops blank names and de-duplicates by name case-insensitively', () => {
    const picks = pickTopRestaurants(
      [
        restaurant({ name: '   ', rating: 5 }),
        restaurant({ name: 'Prado', rating: 4.5 }),
        restaurant({ name: 'prado', rating: 4.9 }),
      ],
      5,
    );
    expect(picks.map((p) => p.name)).toEqual(['Prado']);
  });

  it('maps vicinity to area and passes coordinates through', () => {
    const [p] = pickTopRestaurants(
      [restaurant({ name: 'Ramiro', rating: 4.7, vicinity: ' Intendente ', location: { lat: 9, lng: 8 } })],
      1,
    );
    expect(p).toMatchObject({ area: 'Intendente', location: { lat: 9, lng: 8 } });
  });

  it('omits area when the venue has no vicinity', () => {
    const [p] = pickTopRestaurants([restaurant({ name: 'Ramiro', rating: 4.7 })], 1);
    expect(p).not.toHaveProperty('area');
  });

  it('returns an empty list for no input or a non-positive limit', () => {
    expect(pickTopRestaurants([], 3)).toEqual([]);
    expect(pickTopRestaurants([restaurant({ name: 'X' })], 0)).toEqual([]);
  });
});
