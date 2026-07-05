import { describe, it, expect } from 'vitest';
import { evaluateTransportPriority } from '@/services/TransportPriorityEngine';
import type { TransportOption } from '@itinera/shared';

const FLIGHT: TransportOption = {
  mode: 'flight',
  durationMinutes: 120,
  priceEur: 80,
  warnings: [],
};

const TRAIN: TransportOption = {
  mode: 'train',
  durationMinutes: 180,
  priceEur: 40,
  warnings: [],
};

const BUDGET = 200;
const TIME_LIMIT = 300;

describe('evaluateTransportPriority', () => {
  it('honors preferred mode when valid offer exists', () => {
    const result = evaluateTransportPriority('flight', [FLIGHT, TRAIN], BUDGET, TIME_LIMIT);
    expect(result.selectedMode).toBe('flight');
    expect(result.wasPreferenceHonored).toBe(true);
    expect(result.downgradeReason).toBeUndefined();
  });

  it('best mode returns top-ranked option and marks preference honored', () => {
    const result = evaluateTransportPriority('best', [TRAIN, FLIGHT], BUDGET, TIME_LIMIT);
    expect(result.selectedMode).toBe('train');
    expect(result.wasPreferenceHonored).toBe(true);
    expect(result.selectedOption).toBe(TRAIN);
  });

  it('downgrades when no offers for preferred mode', () => {
    const result = evaluateTransportPriority('flight', [TRAIN], BUDGET, TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/no flight offers/i);
    expect(result.selectedMode).toBe('train');
  });

  it('downgrades when all preferred offers exceed budget ceiling', () => {
    const expensive: TransportOption = { ...FLIGHT, priceEur: 500 };
    const result = evaluateTransportPriority('flight', [expensive, TRAIN], 100, TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/budget ceiling/i);
    expect(result.downgradeReason).toContain('500');
  });

  it('downgrades when all preferred offers within budget exceed time limit', () => {
    const slow: TransportOption = { ...FLIGHT, durationMinutes: 600 };
    const result = evaluateTransportPriority('flight', [slow, TRAIN], BUDGET, 300);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/time limit/i);
    expect(result.downgradeReason).toContain('600min');
  });

  it('downgrades when all preferred offers are feasibility estimates', () => {
    const estimate: TransportOption = {
      ...FLIGHT,
      warnings: ['Price is an estimate only — no direct route found'],
    };
    const result = evaluateTransportPriority('flight', [estimate, TRAIN], BUDGET, TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/feasibility estimates/i);
  });

  it('selects cheapest valid preferred offer when multiple exist', () => {
    const cheap: TransportOption = { ...FLIGHT, priceEur: 60 };
    const pricey: TransportOption = { ...FLIGHT, priceEur: 150 };
    const result = evaluateTransportPriority('flight', [pricey, cheap, TRAIN], BUDGET, TIME_LIMIT);
    expect(result.selectedOption.priceEur).toBe(60);
    expect(result.wasPreferenceHonored).toBe(true);
  });

  it('throws when no options provided', () => {
    expect(() => evaluateTransportPriority('flight', [], BUDGET, TIME_LIMIT)).toThrow(
      'No transport options available',
    );
  });

  it('honors preferred mode when priceEur is undefined (treat as free)', () => {
    const freeOffer: TransportOption = { mode: 'car', durationMinutes: 90, warnings: [] };
    const result = evaluateTransportPriority('car', [freeOffer, TRAIN], BUDGET, TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(true);
    expect(result.selectedMode).toBe('car');
  });
});
