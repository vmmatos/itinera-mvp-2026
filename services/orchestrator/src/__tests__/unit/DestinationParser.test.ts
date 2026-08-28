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

/** Minimal IAIProvider stub whose `complete` returns a fixed JSON string. */
function aiReturning(json: string) {
  return { complete: vi.fn().mockResolvedValue({ content: json, latencyMs: 1, tokensUsed: 1 }) };
}

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
    const ai = aiReturning('[{"city":"Tokyo","country":"Japan"},{"city":"Kyoto","country":"Japan"}]');
    const llmParser = new DestinationParser(ai);
    const result = await llmParser.parse('tokyo then kyoto', 6);

    expect(ai.complete).toHaveBeenCalled();
    expect(result.map((d) => d.city)).toEqual(['Tokyo', 'Kyoto']);
    expect(result.reduce((s, d) => s + d.nights, 0)).toBe(6);
  });

  // ── Country → cities expansion ──────────────────────────────────────────────

  describe('country → cities expansion', () => {
    it('expands a bare country to an ordered city route via the LLM', async () => {
      const ai = aiReturning(
        '[{"city":"Tokyo","country":"Japan"},{"city":"Kyoto","country":"Japan"},{"city":"Osaka","country":"Japan"}]',
      );
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 7);

      expect(result.map((d) => d.city)).toEqual(['Tokyo', 'Kyoto', 'Osaka']);
      expect(result.every((d) => d.country === 'Japan')).toBe(true);
      expect(result.reduce((s, d) => s + d.nights, 0)).toBe(7);
    });

    it('keeps named cities in place and only expands the bare-country markers', async () => {
      const ai = aiReturning(
        '[{"city":"Madrid","country":"Spain"},{"city":"Barcelona","country":"Spain"}]',
      );
      const p = new DestinationParser(ai);
      const result = await p.parse('Tokyo, Japão + Espanha', 6);

      expect(result.map((d) => d.city)).toEqual(['Tokyo', 'Madrid', 'Barcelona']);
      expect(result[0]).toMatchObject({ city: 'Tokyo', country: 'Japan' });
    });

    it('expands several bare countries preserving visiting order', async () => {
      const ai = aiReturning(
        '[{"city":"Lisbon","country":"Portugal"},{"city":"Porto","country":"Portugal"},{"city":"Madrid","country":"Spain"}]',
      );
      const p = new DestinationParser(ai);
      const result = await p.parse('Portugal + Espanha', 8);

      expect(result.map((d) => d.city)).toEqual(['Lisbon', 'Porto', 'Madrid']);
    });

    it('passes the group brief (pace, interests, size) into the LLM prompt', async () => {
      const ai = aiReturning('[{"city":"Kyoto","country":"Japan"}]');
      const p = new DestinationParser(ai);
      await p.parse('Japão', 6, {
        brief: { groupSize: 3, pace: 'high', mustHaves: ['temples'], avoids: ['nightlife'] },
      });

      const userPrompt = ai.complete.mock.calls[0][1][0].content as string;
      expect(userPrompt).toContain('Group of 3');
      expect(userPrompt).toContain('Pace: high');
      expect(userPrompt).toContain('temples');
      expect(userPrompt).toContain('nightlife');
    });

    it('caps the route to ceil(totalNights / 2) cities', async () => {
      const eight = Array.from({ length: 8 }, (_, i) => `{"city":"C${i}","country":"Japan"}`).join(',');
      const ai = aiReturning(`[${eight}]`);
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 4);

      expect(result).toHaveLength(2); // ceil(4/2)
    });

    it('uses fixture cities when expansionMock is on, without calling the LLM', async () => {
      const ai = aiReturning('[{"city":"ShouldNotBeUsed","country":"Japan"}]');
      const p = new DestinationParser(ai, { expansionMock: true });
      const result = await p.parse('Japão', 7);

      expect(ai.complete).not.toHaveBeenCalled();
      expect(result.map((d) => d.city)).toEqual(['Tokyo', 'Kyoto', 'Osaka']);
    });

    it('uses fixture cities when no AI provider is configured but mock is on', async () => {
      const p = new DestinationParser(undefined, { expansionMock: true });
      const result = await p.parse('Portugal', 6);

      expect(result.map((d) => d.city)).toEqual(['Lisbon', 'Porto', 'Sintra']);
      expect(result.every((d) => d.country === 'Portugal')).toBe(true);
    });

    it('falls back to the country name (no throw) when the LLM call rejects', async () => {
      const ai = { complete: vi.fn().mockRejectedValue(new Error('anthropic 529')) };
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 7);

      expect(result).toHaveLength(1);
      expect(result[0].city).toMatch(/japan/i);
      expect(result[0].nights).toBe(7);
    });

    it('falls back (no throw) when the LLM returns malformed JSON', async () => {
      const ai = aiReturning('not json at all');
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 5);

      expect(result).toHaveLength(1);
      expect(result[0].city).toMatch(/japan/i);
    });

    it('falls back when the LLM returns entries without a country', async () => {
      const ai = aiReturning('[{"city":"Tokyo"},{"city":"Kyoto"}]');
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 6);

      expect(result).toHaveLength(1);
      expect(result[0].city).toMatch(/japan/i);
    });

    it('does not expand when expansionEnabled is false', async () => {
      const ai = aiReturning('[{"city":"Tokyo","country":"Japan"}]');
      const p = new DestinationParser(ai, { expansionEnabled: false });
      const result = await p.parse('Japão', 7);

      expect(ai.complete).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].city).toMatch(/japan/i);
    });

    it('does not expand when allowExpansion is false (form preview): returns the bare marker', async () => {
      const ai = aiReturning('[{"city":"Tokyo","country":"Japan"}]');
      const p = new DestinationParser(ai);
      const result = await p.parse('Japão', 7, { allowExpansion: false });

      expect(ai.complete).not.toHaveBeenCalled();
      expect(result).toEqual([{ city: '', country: 'Japan', nights: 7 }]);
    });

    it('keeps resolved city+country input untouched on preview', async () => {
      const p = new DestinationParser();
      const result = await p.parse('lisboa, portugal', 4, { allowExpansion: false });
      expect(result).toEqual([{ city: 'Lisboa', country: 'Portugal', nights: 4 }]);
    });
  });
});
