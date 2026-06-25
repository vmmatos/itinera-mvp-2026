import { describe, it, expect } from 'vitest';
import { getHubs, normalise } from '@/services/HubLookup';

describe('HubLookup', () => {
  it('normalise strips accents and lowercases', () => {
    expect(normalise('Mértola')).toBe('mertola');
    expect(normalise('COMPORTA')).toBe('comporta');
    expect(normalise('Évora')).toBe('evora');
  });

  it('getHubs returns entries for Comporta', () => {
    const hubs = getHubs('Comporta');
    expect(hubs.length).toBeGreaterThan(0);
    expect(hubs[0]?.accessMode).toBe('bus');
    expect(hubs[0]?.accessMinutes).toBeGreaterThan(0);
    expect(hubs[0]?.accessCostEur).toBeGreaterThan(0);
  });

  it('getHubs returns entries for Mértola (accent-insensitive)', () => {
    const hubs = getHubs('Mértola');
    expect(hubs.length).toBeGreaterThan(0);
    const hubCities = hubs.map((h) => h.hubCity);
    expect(hubCities).toContain('Beja');
  });

  it('getHubs returns empty array for major city (Lisboa)', () => {
    expect(getHubs('Lisboa')).toEqual([]);
  });

  it('getHubs returns empty array for unknown city', () => {
    expect(getHubs('Nowheresville')).toEqual([]);
  });

  it('all hub entries have positive accessMinutes and accessCostEur', () => {
    for (const city of ['comporta', 'mertola', 'lagos', 'sagres']) {
      const hubs = getHubs(city);
      for (const h of hubs) {
        expect(h.accessMinutes).toBeGreaterThan(0);
        expect(h.accessCostEur).toBeGreaterThan(0);
      }
    }
  });
});
