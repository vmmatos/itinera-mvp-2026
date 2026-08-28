import { describe, it, expect } from 'vitest';
import { applyPricingOverlay } from '@/services/PricingOverlay';
import type { PricedDay, PricedAccommodation } from '@/services/PricingOverlay';
import type { PricingEnrichment } from '@/services/PricingEnricher';
import type { RestaurantPick } from '@/services/RestaurantPricing';

const pick = (name: string, cost: number, extra: Partial<RestaurantPick> = {}): RestaurantPick => ({
  name,
  estimatedCostPerPerson: cost,
  isEstimate: false,
  source: 'google_places_price_level',
  ...extra,
});

const basePricing = (restaurantsByCity: Record<string, RestaurantPick[]> = {}): PricingEnrichment => ({
  accommodationByCity: {
    Lisbon: { amount: 65, isEstimate: false, source: 'serpapi_google_hotels' },
  },
  restaurantPricePerMeal: { amount: 25, isEstimate: false, source: 'google_places_price_level' },
  restaurantsByCity,
  activityPriceByName: {
    'pena palace': { amount: 14, isEstimate: false, source: 'attraction_db' },
  },
});

const day = (activities: PricedDay['activities'], city = 'Lisbon', dayNum = 1): PricedDay => ({
  day: dayNum,
  city,
  activities,
  meals: [],
});

describe('applyPricingOverlay — activities', () => {
  it('overwrites the LLM guess with a real DB price when the venue matches', () => {
    const itinerary = [day([{ venue: 'Pena Palace', estimatedCostPerPerson: 8 }])];

    const result = applyPricingOverlay(itinerary, [], basePricing(), 2);

    expect(result.itinerary[0].activities[0]).toMatchObject({
      estimatedCostPerPerson: 14,
      isEstimate: false,
      source: 'attraction_db',
    });
    expect(result.repricedCount).toBe(1);
  });

  it('keeps the LLM guess but tags it as an estimate when no real price matches', () => {
    const itinerary = [day([{ venue: 'Mystery Museum', estimatedCostPerPerson: 12 }])];

    const result = applyPricingOverlay(itinerary, [], basePricing(), 2);

    expect(result.itinerary[0].activities[0]).toMatchObject({
      estimatedCostPerPerson: 12,
      isEstimate: true,
      source: 'llm_estimate',
    });
    expect(result.repricedCount).toBe(0);
  });

  it('handles an activity with no venue field without throwing', () => {
    const itinerary = [day([{ estimatedCostPerPerson: 5 }])];

    const result = applyPricingOverlay(itinerary, [], basePricing(), 2);

    expect(result.itinerary[0].activities[0]).toMatchObject({
      estimatedCostPerPerson: 5,
      isEstimate: true,
      source: 'llm_estimate',
    });
  });
});

describe('applyPricingOverlay — meals', () => {
  it('assigns MEALS_PER_DAY named restaurants per day with slot labels', () => {
    const pricing = basePricing({
      Lisbon: [pick('Ramiro', 30, { area: 'Intendente', rating: 4.6 }), pick('Prado', 40, { area: 'Baixa' })],
    });

    const result = applyPricingOverlay([day([])], [], pricing, 2);

    expect(result.itinerary[0].meals).toEqual([
      { type: 'Lunch', name: 'Ramiro', location: 'Intendente', rating: 4.6, estimatedCostPerPerson: 30, isEstimate: false, source: 'google_places_price_level' },
      { type: 'Dinner', name: 'Prado', location: 'Baixa', estimatedCostPerPerson: 40, isEstimate: false, source: 'google_places_price_level' },
    ]);
    expect(result.mealsNamedCount).toBe(2);
  });

  it('uses one Lunch slot when MEALS_PER_DAY is 1', () => {
    const pricing = basePricing({ Lisbon: [pick('Ramiro', 30), pick('Prado', 40)] });

    const result = applyPricingOverlay([day([])], [], pricing, 1);

    expect(result.itinerary[0].meals.map((m) => m.type)).toEqual(['Lunch']);
  });

  it('labels a third meal Breakfast when MEALS_PER_DAY is 3', () => {
    const pricing = basePricing({ Lisbon: [pick('A', 10), pick('B', 10), pick('C', 10), pick('D', 10)] });

    const result = applyPricingOverlay([day([])], [], pricing, 3);

    expect(result.itinerary[0].meals.map((m) => m.type)).toEqual(['Lunch', 'Dinner', 'Breakfast']);
  });

  it('rotates venues across consecutive days in the same city and wraps around', () => {
    const pricing = basePricing({
      Lisbon: [pick('A', 10), pick('B', 10), pick('C', 10), pick('D', 10)],
    });
    const itinerary = [day([], 'Lisbon', 1), day([], 'Lisbon', 2), day([], 'Lisbon', 3)];

    const result = applyPricingOverlay(itinerary, [], pricing, 2);

    expect(result.itinerary[0].meals.map((m) => m.name)).toEqual(['A', 'B']);
    expect(result.itinerary[1].meals.map((m) => m.name)).toEqual(['C', 'D']);
    expect(result.itinerary[2].meals.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('falls back to a cost-only line when the city has no picks', () => {
    const result = applyPricingOverlay([day([], 'Nowhere')], [], basePricing(), 2);

    expect(result.itinerary[0].meals).toEqual([
      { type: 'Meals', name: 'Local restaurants', estimatedCostPerPerson: 50, isEstimate: false, source: 'google_places_price_level' },
    ]);
    expect(result.mealsNamedCount).toBe(0);
  });

  it('falls back to the cost-only line for a day with no city', () => {
    const noCityDay: PricedDay = { day: 1, activities: [], meals: [] };

    const result = applyPricingOverlay([noCityDay], [], basePricing({ Lisbon: [pick('A', 10)] }), 2);

    expect(result.itinerary[0].meals).toHaveLength(1);
    expect(result.itinerary[0].meals[0]).toMatchObject({ name: 'Local restaurants' });
  });

  it('repeats the only venue when a city has fewer picks than meals per day', () => {
    const pricing = basePricing({ Lisbon: [pick('Solo', 20)] });

    const result = applyPricingOverlay([day([])], [], pricing, 2);

    expect(result.itinerary[0].meals.map((m) => m.name)).toEqual(['Solo', 'Solo']);
  });

  it('always leaves every meal entry with a numeric per-person cost for finance', () => {
    const pricing = basePricing({ Lisbon: [pick('A', 18), pick('B', 22)] });

    const result = applyPricingOverlay([day([])], [], pricing, 2);

    for (const meal of result.itinerary[0].meals) {
      expect(typeof meal.estimatedCostPerPerson).toBe('number');
    }
  });

  it('omits location and rating when a pick has neither', () => {
    const pricing = basePricing({ Lisbon: [pick('Plain', 15)] });

    const result = applyPricingOverlay([day([])], [], pricing, 1);

    expect(result.itinerary[0].meals[0]).not.toHaveProperty('location');
    expect(result.itinerary[0].meals[0]).not.toHaveProperty('rating');
  });
});

describe('applyPricingOverlay — accommodation', () => {
  it('overlays accommodation pricing per city, leaving unmatched cities untouched', () => {
    const accommodation: PricedAccommodation[] = [
      { city: 'Lisbon', pricePerNightPerPerson: 40 },
      { city: 'Porto', pricePerNightPerPerson: 30 },
    ];

    const result = applyPricingOverlay([], accommodation, basePricing(), 2);

    expect(result.accommodation[0]).toMatchObject({
      pricePerNightPerPerson: 65, isEstimate: false, source: 'serpapi_google_hotels',
    });
    expect(result.accommodation[1]).toEqual({ city: 'Porto', pricePerNightPerPerson: 30 });
  });
});
