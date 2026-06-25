import { describe, it, expect } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import { vi } from 'vitest';
import { DestinationParser } from '@/services/DestinationParser';

describe('DestinationParser', () => {
  const parser = new DestinationParser();

  it('parses the multi-city / multi-country free-text string', async () => {
    const result = await parser.parse(
      'comporta + mertola, portugal + barcelona, espanha + dublin, irlanda',
      10,
    );

    expect(result.map((d) => d.city)).toEqual(['Comporta', 'Mertola', 'Barcelona', 'Dublin']);
    expect(result.map((d) => d.country)).toEqual(['Portugal', 'Portugal', 'Spain', 'Ireland']);
    expect(result.reduce((s, d) => s + d.nights, 0)).toBe(10);
  });

  it('distributes leftover nights to the first cities', async () => {
    const result = await parser.parse('comporta + mertola, portugal + barcelona, espanha + dublin, irlanda', 10);
    // 10 nights / 4 cities → 3,3,2,2
    expect(result.map((d) => d.nights)).toEqual([3, 3, 2, 2]);
  });

  it('handles a single city + country', async () => {
    const result = await parser.parse('lisboa, portugal', 4);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ city: 'Lisboa', country: 'Portugal', nights: 4 });
  });

  it('gives at least one night per city when nights < cities', async () => {
    const result = await parser.parse('porto + braga + coimbra, portugal', 2);
    expect(result).toHaveLength(3);
    for (const d of result) expect(d.nights).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a single destination when no country is recognised', async () => {
    const result = await parser.parse('somewhere unknown', 5);
    expect(result).toHaveLength(1);
    expect(result[0].nights).toBe(5);
  });

  it('uses the LLM fallback when cities lack a country and a provider is given', async () => {
    const ai = {
      complete: vi.fn().mockResolvedValue({
        content: '[{"city":"Tokyo","country":"Japan"},{"city":"Kyoto","country":"Japan"}]',
        latencyMs: 1,
        tokensUsed: 1,
      }),
    };
    const llmParser = new DestinationParser(ai);
    const result = await llmParser.parse('tokyo then kyoto', 6);

    expect(ai.complete).toHaveBeenCalled();
    expect(result.map((d) => d.city)).toEqual(['Tokyo', 'Kyoto']);
    expect(result.reduce((s, d) => s + d.nights, 0)).toBe(6);
  });
});
