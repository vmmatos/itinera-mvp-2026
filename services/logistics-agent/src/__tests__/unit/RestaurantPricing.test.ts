import { describe, it, expect } from 'vitest';
import { estimateMealPriceEur } from '@/services/RestaurantPricing';
import type { Place } from '@/services/PlacesService';

function place(priceLevel: number | null): Place {
  return {
    id: 'p', name: 'Restaurant', location: { lat: 0, lng: 0 },
    category: 'restaurant', rating: null, priceLevel, openingHours: {}, metadata: {},
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
