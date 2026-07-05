/**
 * Upgrades a legacy scenario fixture to the current ProposalOutputSchema
 * contract (accommodation + satisfactionEstimates + per-activity venue and
 * estimatedCostPerPerson) WITHOUT touching any field the scenario asserts on.
 * Existing keys always win; only missing required fields get defaults.
 *
 * Keeping fixtures schema-valid matters: an invalid proposal triggers the
 * orchestrator-agent's G2 validation retry, which consumes an extra mocked
 * AI response and doubles the latency/token metrics the scenarios assert.
 */

interface LegacyActivity extends Record<string, unknown> {
  activity?: string;
  cost?: number;
  estimatedCostPerPerson?: number;
  venue?: string;
}

interface LegacyDay extends Record<string, unknown> {
  activities?: LegacyActivity[];
}

interface LegacyProposal extends Record<string, unknown> {
  itinerary?: LegacyDay[];
  accommodation?: unknown[];
  satisfactionEstimates?: Record<string, number>;
}

const DEFAULT_ACCOMMODATION = [
  {
    city: 'Sintra',
    name: 'Casa do Valle guesthouse',
    type: 'hotel',
    pricePerNightPerPerson: 45,
    nights: 1,
  },
];

const DEFAULT_SATISFACTION = { alice: 0.8, bob: 0.8, carlos: 0.8, diana: 0.8 };

export function withProposalContract<T extends LegacyProposal>(proposal: T): T {
  return {
    accommodation: DEFAULT_ACCOMMODATION,
    satisfactionEstimates: DEFAULT_SATISFACTION,
    ...proposal,
    itinerary: (proposal.itinerary ?? []).map((day) => ({
      ...day,
      activities: (day.activities ?? []).map((a) => ({
        venue: typeof a.activity === 'string' && a.activity.length >= 3 ? a.activity : 'Local venue',
        estimatedCostPerPerson: a.estimatedCostPerPerson ?? a.cost ?? 0,
        ...a,
      })),
    })),
  };
}
