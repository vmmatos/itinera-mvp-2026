import { describe, it, expect, vi } from 'vitest';
import { resolveMultiLegOptions } from '@/services/MultiLegRouter';
import type { TransportOption } from '@itinera/shared';

function makeFlight(priceEur: number, durationMinutes: number): TransportOption {
  return { mode: 'flight', provider: 'Test Air', durationMinutes, priceEur, warnings: [] };
}

describe('MultiLegRouter', () => {
  it('returns empty for a major hub origin (no HubLookup entry)', async () => {
    const fetchBest = vi.fn().mockResolvedValue([makeFlight(100, 120)]);
    const result = await resolveMultiLegOptions({ from: 'Lisboa', to: 'Dublin' }, fetchBest);
    expect(result).toHaveLength(0);
    expect(fetchBest).not.toHaveBeenCalled();
  });

  it('composes multi-leg option for remote origin (Comporta → Dublin)', async () => {
    const fetchBest = vi.fn().mockResolvedValue([makeFlight(120, 140)]);
    const result = await resolveMultiLegOptions({ from: 'Comporta', to: 'Dublin' }, fetchBest);

    expect(result.length).toBeGreaterThan(0);
    const option = result[0]!;
    // Total duration = hub access time + flight time
    expect(option.durationMinutes).toBeGreaterThan(140);
    // Total cost = hub access cost + flight cost
    expect(option.priceEur).toBeGreaterThan(120);
    expect(option.segments).toBeDefined();
    expect(option.segments!.length).toBe(2);
    // First segment is the bus/train to hub
    expect(['bus', 'train', 'car']).toContain(option.segments![0]!.mode);
    // Second segment is the flight
    expect(option.segments![1]!.mode).toBe('flight');
    // displaySummary should describe the journey
    expect(option.displaySummary).toBeTruthy();
  });

  it('creates multi-leg for Mértola with Beja hub', async () => {
    const fetchBest = vi.fn().mockResolvedValue([makeFlight(95, 110)]);
    const result = await resolveMultiLegOptions({ from: 'Mértola', to: 'Barcelona' }, fetchBest);

    expect(result.length).toBeGreaterThan(0);
    // First segment should go to Beja (first hub entry for Mértola)
    const segments = result[0]!.segments!;
    expect(segments[0]!.to).toBe('Beja');
  });

  it('skips hub if fetchBest throws for that pair', async () => {
    // Only Faro hub succeeds, Beja hub fails
    const fetchBest = vi.fn().mockImplementation(({ from }: { from: string }) => {
      if (from === 'Beja') return Promise.reject(new Error('no route'));
      return Promise.resolve([makeFlight(110, 120)]);
    });
    const result = await resolveMultiLegOptions({ from: 'Mértola', to: 'Barcelona' }, fetchBest);
    // Should still return options from the Faro hub
    expect(result.length).toBeGreaterThan(0);
    const hubs = result.map((r) => r.segments?.[0]?.to);
    expect(hubs).not.toContain('Beja');
  });

  it('marks journey as >4h travel warning when total exceeds 240 min', async () => {
    // Comporta → Grândola (first hub, 40min bus) + 210min flight = 250min > 240min
    const fetchBest = vi.fn().mockResolvedValue([makeFlight(90, 210)]);
    const result = await resolveMultiLegOptions({ from: 'Comporta', to: 'Dublin' }, fetchBest);
    const opt = result[0]!;
    expect(opt.durationMinutes).toBeGreaterThan(240);
    expect(opt.warnings.some((w) => w.includes('4h'))).toBe(true);
  });
});
