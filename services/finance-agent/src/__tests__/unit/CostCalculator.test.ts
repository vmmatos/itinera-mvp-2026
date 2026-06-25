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
});
