import { describe, it, expect } from 'vitest';
import {
  evaluateTransportPriority,
  evaluateLocalTransportPriority,
  mapTransportModeToLocalPreference,
} from '../../services/transportPriority';
import type { TransportOption } from '../../types/entities';
import type { LocalTransportOption } from '../../types/localTransport';

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

const DRIVE: LocalTransportOption = {
  mode: 'drive',
  durationMinutes: 20,
  priceEur: 15,
  warnings: [],
};

const TRANSIT: LocalTransportOption = {
  mode: 'transit',
  durationMinutes: 35,
  priceEur: 2,
  transitLine: 'Metro Line M1',
  transitVehicleType: 'SUBWAY',
  warnings: [],
};

const LOCAL_BUDGET = 20;
const LOCAL_TIME_LIMIT = 60;

describe('evaluateLocalTransportPriority', () => {
  it('honors preferred mode when valid offer exists', () => {
    const result = evaluateLocalTransportPriority('transit', [DRIVE, TRANSIT], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.selectedMode).toBe('transit');
    expect(result.wasPreferenceHonored).toBe(true);
    expect(result.downgradeReason).toBeUndefined();
  });

  it('best mode returns top-ranked option and marks preference honored', () => {
    const result = evaluateLocalTransportPriority('best', [DRIVE, TRANSIT], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.selectedMode).toBe('drive');
    expect(result.selectedOption).toBe(DRIVE);
    expect(result.wasPreferenceHonored).toBe(true);
  });

  it('downgrades when no offers for preferred mode', () => {
    const result = evaluateLocalTransportPriority('walk', [DRIVE, TRANSIT], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/no walk offers/i);
    expect(result.selectedMode).toBe('drive');
  });

  it('downgrades when all preferred offers exceed budget ceiling', () => {
    const expensiveDrive: LocalTransportOption = { ...DRIVE, priceEur: 50 };
    const result = evaluateLocalTransportPriority('drive', [expensiveDrive, TRANSIT], 20, LOCAL_TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/budget ceiling/i);
    expect(result.downgradeReason).toContain('50');
  });

  it('downgrades when all preferred offers within budget exceed time limit', () => {
    const slowTransit: LocalTransportOption = { ...TRANSIT, durationMinutes: 90 };
    const result = evaluateLocalTransportPriority('transit', [DRIVE, slowTransit], LOCAL_BUDGET, 60);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/time limit/i);
    expect(result.downgradeReason).toContain('90min');
  });

  it('downgrades when all preferred offers are feasibility estimates', () => {
    const estimateTransit: LocalTransportOption = {
      ...TRANSIT,
      warnings: ['Duration is an approximate estimate only'],
    };
    const result = evaluateLocalTransportPriority('transit', [DRIVE, estimateTransit], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(false);
    expect(result.downgradeReason).toMatch(/feasibility estimates/i);
  });

  it('selects cheapest valid preferred offer when multiple exist', () => {
    const cheapDrive: LocalTransportOption = { ...DRIVE, priceEur: 8 };
    const pricey: LocalTransportOption = { ...DRIVE, priceEur: 18 };
    const result = evaluateLocalTransportPriority('drive', [pricey, cheapDrive, TRANSIT], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.selectedOption.priceEur).toBe(8);
    expect(result.wasPreferenceHonored).toBe(true);
  });

  it('throws when no options provided', () => {
    expect(() => evaluateLocalTransportPriority('drive', [], LOCAL_BUDGET, LOCAL_TIME_LIMIT)).toThrow(
      'No local transport options available',
    );
  });

  it('honors preferred mode when priceEur is undefined (walk is free)', () => {
    const walk: LocalTransportOption = { mode: 'walk', durationMinutes: 12, warnings: [] };
    const result = evaluateLocalTransportPriority('walk', [walk, TRANSIT], LOCAL_BUDGET, LOCAL_TIME_LIMIT);
    expect(result.wasPreferenceHonored).toBe(true);
    expect(result.selectedMode).toBe('walk');
  });
});

describe('mapTransportModeToLocalPreference', () => {
  it('maps car to drive', () => {
    expect(mapTransportModeToLocalPreference('car')).toBe('drive');
  });

  it('maps train to transit', () => {
    expect(mapTransportModeToLocalPreference('train')).toBe('transit');
  });

  it('maps flight to best (no local analog)', () => {
    expect(mapTransportModeToLocalPreference('flight')).toBe('best');
  });

  it('maps best to best', () => {
    expect(mapTransportModeToLocalPreference('best')).toBe('best');
  });
});
