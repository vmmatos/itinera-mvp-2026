import { z } from 'zod';

/**
 * Output contract for the repair agent (see prompts/repair.txt). The agent
 * never rewrites the itinerary — it returns a short list of targeted edits
 * that the orchestrator applies deterministically, so a hallucinated edit can
 * only fail to match an item, never corrupt unrelated days.
 */
export const RepairEditSchema = z.object({
  type: z.enum(['remove', 'downgrade']),
  // Accommodation edits are trip-level; everything else names a 1-based day.
  day: z.number().int().min(1).optional(),
  target: z.enum(['activity', 'meal', 'transport', 'accommodation']),
  name: z.string().min(1),
  // downgrade only — must be lower than the item's current cost.
  newCostPerPerson: z.number().min(0).optional(),
  note: z.string().optional(),
});

export const RepairOutputSchema = z.object({
  edits: z.array(RepairEditSchema).min(1),
  summary: z.string().optional(),
});

export type RepairOutput = z.infer<typeof RepairOutputSchema>;
