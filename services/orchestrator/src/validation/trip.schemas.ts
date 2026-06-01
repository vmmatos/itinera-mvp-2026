import { z } from 'zod';

export const CreateTripSchema = z.object({
  name: z.string().min(1).max(255),
  region: z.string().min(1).max(255).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  budgetTotal: z.number().positive().optional(),
  budgetCurrency: z.string().length(3).default('EUR'),
  travellers: z
    .array(
      z.object({
        userId: z.string().uuid(),
        preferences: z.record(z.unknown()).default({}),
      }),
    )
    .optional(),
});

export const TripIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateTripInput = z.infer<typeof CreateTripSchema>;
