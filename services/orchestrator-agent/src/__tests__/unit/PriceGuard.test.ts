import { describe, it, expect, vi } from 'vitest';
import { auditPrices } from '@/services/PriceGuard';
import type { ProposalOutput } from '@/schemas/proposalOutput.schema';

const mockLogger = { warn: vi.fn() };

function makeProposal(overrides: Partial<ProposalOutput> = {}): ProposalOutput {
  return {
    accommodation: [{ city: 'Lisboa', name: 'Hotel Bairro Alto', type: 'hotel', pricePerNightPerPerson: 90, nights: 3, country: 'PT' }],
    itinerary: [{ day: 1, city: 'Lisboa', country: 'PT', activities: [{ time: 'morning', activity: 'Visit Belém Tower', venue: 'Belém Tower, Praça do Império', estimatedCostPerPerson: 6 }] }],
    satisfactionEstimates: { alice: 0.8 },
    decisions: [],
    ...overrides,
  };
}

describe('PriceGuard.auditPrices', () => {
  it('returns no warnings for a realistic Portugal itinerary', () => {
    const warnings = auditPrices(makeProposal(), mockLogger);
    expect(warnings).toHaveLength(0);
  });

  it('flags €0 accommodation (hallucinated free hotel)', () => {
    const proposal = makeProposal({
      accommodation: [{ city: 'Lisboa', name: 'Hotel Fantasy', type: 'hotel', pricePerNightPerPerson: 0, nights: 2, country: 'PT' }],
    });
    const warnings = auditPrices(proposal, mockLogger);
    expect(warnings.some((w) => w.includes('Hotel Fantasy'))).toBe(true);
  });

  it('flags outrageously expensive activity in Portugal (€300 museum)', () => {
    const proposal = makeProposal({
      itinerary: [{
        day: 1, city: 'Lisboa', country: 'PT',
        activities: [{ time: 'morning', activity: 'Visit Super Museum', venue: 'Super Museum, Lisboa', estimatedCostPerPerson: 300 }],
      }],
    });
    const warnings = auditPrices(proposal, mockLogger);
    expect(warnings.some((w) => w.includes('Super Museum'))).toBe(true);
  });

  it('does not flag a realistic Ireland hotel price', () => {
    const proposal = makeProposal({
      accommodation: [{ city: 'Dublin', name: 'The Shelbourne Hotel', type: 'hotel', pricePerNightPerPerson: 180, nights: 3, country: 'IE' }],
    });
    const warnings = auditPrices(proposal, mockLogger);
    expect(warnings).toHaveLength(0);
  });

  it('flags activity in unknown country using DEFAULT ranges', () => {
    const proposal = makeProposal({
      itinerary: [{
        day: 1, city: 'Timbuktu', country: 'XX',
        activities: [{ time: 'morning', activity: 'Super Rare Tour', venue: 'Some venue here', estimatedCostPerPerson: 200 }],
      }],
    });
    const warnings = auditPrices(proposal, mockLogger);
    expect(warnings.some((w) => w.includes('Super Rare Tour'))).toBe(true);
  });

  it('calls logger.warn for each flagged item', () => {
    const warnFn = vi.fn();
    const proposal = makeProposal({
      accommodation: [{ city: 'Lisboa', name: 'Hotel Fake', type: 'hotel', pricePerNightPerPerson: 0, nights: 1, country: 'PT' }],
    });
    auditPrices(proposal, { warn: warnFn });
    expect(warnFn).toHaveBeenCalled();
  });
});
