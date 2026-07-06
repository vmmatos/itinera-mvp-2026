import { describe, it, expect, vi } from 'vitest';

vi.mock('@/config', () => ({
  config: {
    TRANSPORT_WEIGHT_COST: 0.6,
    TRANSPORT_WEIGHT_DURATION: 40,
    TRANSPORT_WEIGHT_PREFERENCE: 0.18,
    TRANSPORT_WEIGHT_TRANSFERS: 15,
  },
}));

import type { TransportOption } from '@itinera/shared';
import {
  preferenceAlignment,
  rankTransportOptions,
  scoreTransportOption,
  defaultWeights,
} from '@/services/TransportScorer';

function option(partial: Partial<TransportOption> & Pick<TransportOption, 'mode' | 'durationMinutes'>): TransportOption {
  return { warnings: [], ...partial };
}

describe('TransportScorer', () => {
  describe('preferenceAlignment', () => {
    it('is 1 for a direct option in the preferred mode and 0 otherwise', () => {
      expect(preferenceAlignment(option({ mode: 'car', durationMinutes: 120 }), 'car')).toBe(1);
      expect(preferenceAlignment(option({ mode: 'flight', durationMinutes: 120 }), 'car')).toBe(0);
    });

    it('is the time fraction spent in the preferred mode for hybrid routes', () => {
      const hybrid = option({
        mode: 'flight',
        durationMinutes: 240,
        segments: [
          { from: 'Mértola', to: 'Lisboa', mode: 'car', durationMinutes: 120 },
          { from: 'Lisboa', to: 'Barcelona', mode: 'flight', durationMinutes: 120 },
        ],
      });
      expect(preferenceAlignment(hybrid, 'car')).toBe(0.5);
      const busFlight = option({
        mode: 'flight',
        durationMinutes: 240,
        segments: [
          { from: 'Mértola', to: 'Beja', mode: 'bus', durationMinutes: 60 },
          { from: 'Beja', to: 'Barcelona', mode: 'flight', durationMinutes: 180 },
        ],
      });
      expect(preferenceAlignment(busFlight, 'car')).toBe(0);
    });
  });

  describe('rankTransportOptions', () => {
    it('lets the direct drive win a short leg with a car preference', () => {
      const car = option({ mode: 'car', durationMinutes: 150, priceEur: 33 });
      const train = option({ mode: 'train', durationMinutes: 170, priceEur: 40 });
      const ranked = rankTransportOptions([train, car], 'car');
      expect(ranked[0].mode).toBe('car');
    });

    it('lets a hybrid car+flight beat the pure drive when it saves enough hours (organic decision)', () => {
      // Mértola→Barcelona style: 11h drive vs 2h drive + 2h flight.
      const pureDrive = option({ mode: 'car', durationMinutes: 660, priceEur: 200 });
      const hybrid = option({
        mode: 'flight',
        durationMinutes: 240,
        priceEur: 116,
        segments: [
          { from: 'Mértola', to: 'Lisboa', mode: 'car', durationMinutes: 120, priceEur: 26 },
          { from: 'Lisboa', to: 'Barcelona', mode: 'flight', durationMinutes: 120, priceEur: 90 },
        ],
      });
      const ranked = rankTransportOptions([pureDrive, hybrid], 'car');
      // The winner is a copy of the hybrid (an override warning is attached).
      expect(ranked[0].segments).toHaveLength(2);
      expect(ranked[0].durationMinutes).toBe(240);
      expect(ranked[0].warnings.some((w) => w.includes('car preference overridden'))).toBe(true);
    });

    it('ranks a bus+flight combo below an equivalent car+flight combo under a car preference', () => {
      const carFlight = option({
        mode: 'flight',
        durationMinutes: 240,
        priceEur: 120,
        segments: [
          { from: 'A', to: 'Hub', mode: 'car', durationMinutes: 120, priceEur: 30 },
          { from: 'Hub', to: 'B', mode: 'flight', durationMinutes: 120, priceEur: 90 },
        ],
      });
      const busFlight = option({
        mode: 'flight',
        durationMinutes: 240,
        priceEur: 120,
        segments: [
          { from: 'A', to: 'Hub', mode: 'bus', durationMinutes: 120, priceEur: 30 },
          { from: 'Hub', to: 'B', mode: 'flight', durationMinutes: 120, priceEur: 90 },
        ],
      });
      const ranked = rankTransportOptions([busFlight, carFlight], 'car');
      expect(ranked[0]).toBe(carFlight);
    });

    it('imputes the sibling median price for unpriced options instead of a phantom penalty', () => {
      // Unpriced 2h car vs €200 2h flight: with the median (€200) imputed the
      // car ties on cost and the flight's ranking cannot ride on a phantom €999.
      const car = option({ mode: 'car', durationMinutes: 120 });
      const flight = option({ mode: 'flight', durationMinutes: 120, priceEur: 200 });
      const weights = defaultWeights();
      expect(scoreTransportOption(car, undefined, weights, 200)).toBe(
        scoreTransportOption(flight, undefined, weights, 200),
      );
      const ranked = rankTransportOptions([flight, car], 'car');
      expect(ranked[0].mode).toBe('car'); // preference breaks the tie
    });

    it('adds a preference-overridden warning when the winner beats a ≥1.5× slower preferred mode', () => {
      const car = option({ mode: 'car', durationMinutes: 480, priceEur: 100 });
      const flight = option({ mode: 'flight', durationMinutes: 120, priceEur: 80 });
      const ranked = rankTransportOptions([car, flight], 'car');
      expect(ranked[0].mode).toBe('flight');
      expect(ranked[0].warnings.some((w) => w.includes('car preference overridden'))).toBe(true);
    });

    it('penalises transfers so a direct option wins over an equal-cost composed one', () => {
      const direct = option({ mode: 'train', durationMinutes: 180, priceEur: 60 });
      const composed = option({
        mode: 'train',
        durationMinutes: 180,
        priceEur: 60,
        segments: [
          { from: 'A', to: 'Hub', mode: 'bus', durationMinutes: 60, priceEur: 10 },
          { from: 'Hub', to: 'B', mode: 'train', durationMinutes: 120, priceEur: 50 },
        ],
      });
      const ranked = rankTransportOptions([composed, direct], 'best');
      expect(ranked[0]).toBe(direct);
    });

    it('respects custom weights (env-tunable)', () => {
      const slowCheap = option({ mode: 'train', durationMinutes: 600, priceEur: 10 });
      const fastPricey = option({ mode: 'flight', durationMinutes: 60, priceEur: 300 });
      const costObsessed = rankTransportOptions([fastPricey, slowCheap], undefined, {
        cost: 10, duration: 1, preference: 0, transfers: 0,
      });
      expect(costObsessed[0]).toBe(slowCheap);
      const timeObsessed = rankTransportOptions([slowCheap, fastPricey], undefined, {
        cost: 0.01, duration: 100, preference: 0, transfers: 0,
      });
      expect(timeObsessed[0]).toBe(fastPricey);
    });
  });
});
