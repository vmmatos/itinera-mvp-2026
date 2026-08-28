import { describe, it, expect } from 'vitest';
import { CostCalculator } from '@/agents/CostCalculator';
import type { ItineraryDay } from '@/agents/CostCalculator';

const calc = new CostCalculator();

const DAY_1: ItineraryDay = {
  day: 1,
  activities: [
    { name: 'Museum', cost: 20, currency: 'EUR' },
    { name: 'City tour', cost: 30, currency: 'EUR' },
  ],
  meals: [
    { name: 'Lunch', cost: 15, currency: 'EUR' },
    { name: 'Dinner', cost: 25, currency: 'EUR' },
  ],
  transport: [
    { from: 'Hotel', to: 'Museum', cost: 10, currency: 'EUR' },
  ],
};

const DAY_2: ItineraryDay = {
  day: 2,
  activities: [{ name: 'Beach', cost: 5, currency: 'EUR' }],
  meals: [{ name: 'Brunch', cost: 20, currency: 'EUR' }],
  transport: [{ from: 'Hotel', to: 'Beach', cost: 8, currency: 'EUR' }],
};

describe('CostCalculator', () => {
  it('sums activities correctly across all days', () => {
    const result = calc.calculate([DAY_1, DAY_2], 'EUR');
    expect(result.byCategory.activities).toBe(55); // 20+30+5
  });

  it('sums meals correctly across all days', () => {
    const result = calc.calculate([DAY_1, DAY_2], 'EUR');
    expect(result.byCategory.meals).toBe(60); // 15+25+20
  });

  it('sums transport correctly across all days', () => {
    const result = calc.calculate([DAY_1, DAY_2], 'EUR');
    expect(result.byCategory.transport).toBe(18); // 10+8
  });

  it('grandTotal equals sum of all categories', () => {
    const result = calc.calculate([DAY_1, DAY_2], 'EUR');
    const { activities, meals, transport } = result.byCategory;
    expect(result.grandTotal).toBe(activities + meals + transport);
    expect(result.grandTotal).toBe(133);
  });

  it('returns zero totals for empty itinerary', () => {
    const result = calc.calculate([], 'USD');
    expect(result.byCategory.activities).toBe(0);
    expect(result.byCategory.meals).toBe(0);
    expect(result.byCategory.transport).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('returns zero totals for days with empty item arrays', () => {
    const emptyDay: ItineraryDay = { day: 1, activities: [], meals: [], transport: [] };
    const result = calc.calculate([emptyDay], 'USD');
    expect(result.grandTotal).toBe(0);
  });

  it('returns the correct currency', () => {
    const result = calc.calculate([DAY_1], 'GBP');
    expect(result.currency).toBe('GBP');
  });

  it('passes itinerary items through unchanged', () => {
    const result = calc.calculate([DAY_1], 'EUR');
    expect(result.items).toStrictEqual([DAY_1]);
  });

  it('calculates single day correctly', () => {
    const result = calc.calculate([DAY_1], 'EUR');
    expect(result.byCategory.activities).toBe(50); // 20+30
    expect(result.byCategory.meals).toBe(40); // 15+25
    expect(result.byCategory.transport).toBe(10);
    expect(result.grandTotal).toBe(100);
  });

  // ── F2: real budget — accommodation, group size, estimatedCostPerPerson ──────

  it('reads estimatedCostPerPerson when cost is absent (orchestrator field)', () => {
    const day: ItineraryDay = {
      day: 1,
      activities: [{ activity: 'Museum', estimatedCostPerPerson: 12 } as never],
      meals: [],
      transport: [],
    };
    const result = calc.calculate([day], 'EUR');
    expect(result.byCategory.activities).toBe(12);
  });

  it('includes accommodation (pricePerNightPerPerson × nights) per person', () => {
    const result = calc.calculate([], 'EUR', [{ pricePerNightPerPerson: 100, nights: 3 }], 1);
    expect(result.byCategory.accommodation).toBe(300);
    expect(result.grandTotal).toBe(300);
  });

  it('multiplies per-person totals by group size for the group budget', () => {
    const result = calc.calculate([DAY_1], 'EUR', [{ pricePerNightPerPerson: 50, nights: 2 }], 2);
    // per person: 100 activities/meals/transport + 100 accommodation = 200; × 2 travellers = 400
    expect(result.perPersonTotal).toBe(200);
    expect(result.grandTotal).toBe(400);
    expect(result.groupSize).toBe(2);
  });

  it('reads transport priceEur from merged logistics legs', () => {
    const day: ItineraryDay = {
      day: 1,
      activities: [],
      meals: [],
      transport: [{ from: 'A', to: 'B', priceEur: 89 } as never],
    };
    const result = calc.calculate([day], 'EUR', [], 1);
    expect(result.byCategory.transport).toBe(89);
  });

  // ── Local/day-trip activity transport + real pricing overlay ─────────────
  // Characterization test: proves CostCalculator needed no changes to absorb
  // the new local-transport and pricing-overlay entries (heuristic-tagged
  // local hop + untagged day-trip satellite leg + priced meals), since it
  // already sums every entry in each category array generically.
  it('sums local and inter-city transport entries alongside a priced meals array without any code change', () => {
    const day: ItineraryDay = {
      day: 1,
      activities: [{ venue: 'Picasso Museum', estimatedCostPerPerson: 14, isEstimate: false, source: 'attraction_db' } as never],
      meals: [{ estimatedCostPerPerson: 50, isEstimate: false, source: 'google_places_price_level' } as never],
      transport: [
        // Local hop: hotel -> museum, heuristic-tagged.
        { from: 'Hotel', to: 'Picasso Museum', priceEur: 2, isEstimate: true, source: 'google_routes_transit_heuristic_fare' } as never,
        // Day-trip satellite leg: same untagged convention as ordinary inter-city legs.
        { from: 'Barcelona', to: 'Sitges', priceEur: 24 } as never,
      ],
    };
    const result = calc.calculate([day], 'EUR', [], 1);
    expect(result.byCategory.activities).toBe(14);
    expect(result.byCategory.meals).toBe(50);
    expect(result.byCategory.transport).toBe(26); // 2 + 24
    expect(result.grandTotal).toBe(90);
  });

  it('sums several named restaurant meal entries on one day', () => {
    const day: ItineraryDay = {
      day: 1,
      activities: [],
      meals: [
        { type: 'Lunch', name: 'Bar Cañete', estimatedCostPerPerson: 22, isEstimate: false, source: 'google_places_price_level' } as never,
        { type: 'Dinner', name: 'Disfrutar', location: 'Eixample', rating: 4.7, estimatedCostPerPerson: 45, isEstimate: false, source: 'google_places_price_level' } as never,
      ],
      transport: [],
    };
    const result = calc.calculate([day], 'EUR', [], 2);
    expect(result.byCategory.meals).toBe(67 * 2); // (22 + 45) per person × 2 travellers
  });
});
