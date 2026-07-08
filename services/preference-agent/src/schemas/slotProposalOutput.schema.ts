import { z } from 'zod';

const SlotProposalSchema = z.object({
  city: z.string().min(1),
  date: z.string().min(1),
  slot: z.enum(['morning', 'afternoon', 'evening']),
  activity: z.string().min(1),
  venue: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  estimatedCostPerPerson: z.number().min(0),
  durationMinutes: z.number().optional(),
  satisfies: z.array(z.string()).optional(),
});

export const SlotProposalsOutputSchema = z.object({
  slotProposals: z.array(SlotProposalSchema).min(0),
  reasoning: z.string().optional(),
});

export type SlotProposalsOutput = z.infer<typeof SlotProposalsOutputSchema>;
