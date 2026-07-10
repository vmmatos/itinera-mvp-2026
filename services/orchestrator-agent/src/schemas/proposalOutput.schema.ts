import { z } from 'zod';

const ActivitySchema = z.object({
  // Prompts ask for slot names, but the LLM occasionally emits clock times —
  // both are usable downstream, so neither should trigger a validation retry.
  time: z.union([
    z.enum(['morning', 'afternoon', 'evening']),
    z.string().regex(/^\d{1,2}:\d{2}$/),
  ]),
  activity: z.string().min(3),
  venue: z.string().min(3),
  estimatedCostPerPerson: z.number().min(0),
  city: z.string().optional(),
  country: z.string().optional(),
  satisfies: z.array(z.string()).optional(),
  ownerAgent: z.string().optional(),
  description: z.string().optional(),
  // Ids of the input slot proposal(s) this activity was built from — the
  // authoritative link back to the originating proposal, copied verbatim
  // rather than reconstructed from free-text city/date/slot values.
  proposalIds: z.array(z.string()).optional(),
});

const DaySchema = z.object({
  day: z.number().int().min(1),
  city: z.string().optional(),
  country: z.string().optional(),
  activities: z.array(ActivitySchema).min(0),
  // The LLM writes an explicit `null` (not an absent key) on non-transition days.
  cityTransition: z.object({ to: z.string(), travelTime: z.string().optional() }).nullable().optional(),
});

const AccommodationSchema = z.object({
  city: z.string().min(1),
  name: z.string().min(3),
  type: z.enum(['hotel', 'boutique-hotel', 'hostel', 'apartment', 'resort']),
  pricePerNightPerPerson: z.number().min(0),
  nights: z.number().int().min(1),
  country: z.string().optional(),
});

const DecisionSchema = z.object({
  // Optional: this log is enrichment-only (reason text) — WorkflowEngine
  // derives the authoritative accept/merge/reject status from `proposalIds`
  // on the itinerary's own activities, not from this array. When present,
  // it should be the input proposal's id copied verbatim.
  proposalId: z.string().optional(),
  agent: z.string(),
  city: z.string(),
  date: z.string(),
  slot: z.enum(['morning', 'afternoon', 'evening']),
  activity: z.string(),
  status: z.enum(['accepted', 'merged', 'rejected']),
  reason: z.string(),
  estimatedCostPerPerson: z.number().min(0).optional(),
});

export const ProposalOutputSchema = z.object({
  accommodation: z.array(AccommodationSchema).min(1),
  itinerary: z.array(DaySchema).min(1),
  // No downstream consumer reads this (verified: only the prompt/schema/test
  // fixtures reference it) — WorkflowEngine now computes it deterministically
  // from proposal-decision outcomes instead of asking the LLM to estimate it.
  satisfactionEstimates: z.record(z.number().min(0).max(1)).optional(),
  // Supplementary — a malformed/missing decision log must never fail the
  // whole merge (the itinerary is critical path, decisions are not).
  decisions: z.array(DecisionSchema).catch([]),
});

export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;
