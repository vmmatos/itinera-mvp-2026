import { describe, it, expect } from 'vitest';
import { ProposalOutputSchema } from '@/schemas/proposalOutput.schema';

const BASE = {
  accommodation: [{ city: 'Paris', name: 'Hotel Lumiere Paris', type: 'hotel', pricePerNightPerPerson: 80, nights: 3 }],
  itinerary: [{ day: 1, activities: [{ time: 'morning', activity: 'Visit Eiffel Tower', venue: 'Eiffel Tower, Champ de Mars 5', estimatedCostPerPerson: 25 }] }],
  satisfactionEstimates: { alice: 0.8 },
};

const VALID_DECISION = {
  agent: 'alice',
  city: 'Paris',
  date: '2026-08-01',
  slot: 'morning' as const,
  activity: 'Visit Eiffel Tower',
  status: 'accepted' as const,
  reason: 'top group weight, no conflicts',
  estimatedCostPerPerson: 25,
};

describe('ProposalOutputSchema — decisions', () => {
  it('accepts a valid decisions array', () => {
    const result = ProposalOutputSchema.safeParse({ ...BASE, decisions: [VALID_DECISION] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decisions).toEqual([VALID_DECISION]);
  });

  it('defaults to an empty array when decisions is missing entirely', () => {
    const result = ProposalOutputSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decisions).toEqual([]);
  });

  it('degrades a malformed decisions array to [] without failing the whole parse', () => {
    const result = ProposalOutputSchema.safeParse({
      ...BASE,
      decisions: [{ ...VALID_DECISION, status: 'maybe' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.decisions).toEqual([]);
  });

  it('still fails when itinerary is missing (decisions never masks a real failure)', () => {
    const result = ProposalOutputSchema.safeParse({
      accommodation: BASE.accommodation,
      satisfactionEstimates: BASE.satisfactionEstimates,
      decisions: [VALID_DECISION],
    });
    expect(result.success).toBe(false);
  });

  it('still fails when accommodation is missing (decisions never masks a real failure)', () => {
    const result = ProposalOutputSchema.safeParse({
      itinerary: BASE.itinerary,
      satisfactionEstimates: BASE.satisfactionEstimates,
      decisions: [VALID_DECISION],
    });
    expect(result.success).toBe(false);
  });
});
