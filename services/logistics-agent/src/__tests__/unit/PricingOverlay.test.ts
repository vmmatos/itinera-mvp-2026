import { describe, it, expect } from 'vitest';
import { applyPricingOverlay } from '@/services/PricingOverlay';
import type { PricedDay, PricedAccommodation } from '@/services/PricingOverlay';
import type { PricingEnrichment } from '@/services/PricingEnricher';

const basePricing = (): PricingEnrichment => ({
  accommodationByCity: {
    Lisbon: { amount: 65, isEstimate: false, source: 'serpapi_google_hotels' },
  },
  restaurantPricePerMeal: { amount: 25, isEstimate: false, source: 'google_places_price_level' },
  activityPriceByName: {
    'pena palace': { amount: 14, isEstimate: false, source: 'attraction_db' },
  },
});

const day = (activities: PricedDay['activities']): PricedDay => ({
  day: 1,
  city: 'Lisbon',
  activities,
  meals: [],
});

describe('applyPricingOverlay', () => {
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

  it('keeps the LLM guess when only a heuristic-fallback match exists', () => {
    const pricing = basePricing();
    pricing.activityPriceByName['generic spot'] = { amount: 10, isEstimate: true, source: 'heuristic_estimate' };
    const itinerary = [day([{ venue: 'Generic Spot', estimatedCostPerPerson: 7 }])];

    const result = applyPricingOverlay(itinerary, [], pricing, 2);

    expect(result.itinerary[0].activities[0]).toMatchObject({
      estimatedCostPerPerson: 7,
      isEstimate: true,
      source: 'llm_estimate',
    });
    expect(result.repricedCount).toBe(0);
  });

  it('injects a meals entry per day from the blended restaurant estimate', () => {
    const itinerary = [day([])];

    const result = applyPricingOverlay(itinerary, [], basePricing(), 2);

    expect(result.itinerary[0].meals).toEqual([
      { estimatedCostPerPerson: 50, isEstimate: false, source: 'google_places_price_level' },
    ]);
  });

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
