import { z } from 'zod';

const DestinationSchema = z.object({
  country: z.string().min(1).max(100),
  city:    z.string().max(100).optional(),
  nights:  z.number().int().min(1).max(365),
});

const FixedDateInputSchema = z.object({
  mode:      z.literal('fixed'),
  startDate: z.string().date(),
  endDate:   z.string().date(),
});

const FlexibleDateInputSchema = z.object({
  mode:           z.literal('flexible'),
  days:           z.number().int().min(1).max(365),
  preferredMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Must be YYYY-MM').optional(),
  window:         z.enum(['tight', 'moderate', 'open']),
});

export const DateInputSchema = z.discriminatedUnion('mode', [FixedDateInputSchema, FlexibleDateInputSchema]);

export const CreateTripSchema = z.object({
  name:           z.string().min(1).max(255),
  destinations:   z.array(DestinationSchema).min(1).optional(),
  region:         z.string().min(1).max(255).optional(),
  dateInput:      DateInputSchema.optional(),
  budgetTotal:    z.number().positive().optional(),
  budgetCurrency: z.enum(['EUR', 'USD']).default('EUR'),
  travellers: z
    .array(
      z.object({
        userId:      z.string().uuid().optional(),
        preferences: z.record(z.unknown()).default({}),
      }),
    )
    .optional(),
}).transform((data) => {
  const result: typeof data & { region?: string; startDate?: string; endDate?: string } = { ...data };
  // Derive region from destinations if not explicitly set
  if (!result.region && result.destinations?.length) {
    const parts = result.destinations.map((d) => d.city ? `${d.city}, ${d.country}` : d.country);
    result.region = [...new Set(parts)].join(' · ');
  }
  // Derive top-level startDate/endDate from fixed dateInput for TripService compatibility
  if (result.dateInput?.mode === 'fixed') {
    result.startDate = result.dateInput.startDate;
    result.endDate   = result.dateInput.endDate;
  }
  return result;
});

export const TripIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateTripStatusSchema = z.object({
  status: z.enum(['cancelled', 'confirmed']),
});

export type CreateTripInput = z.infer<typeof CreateTripSchema>;
export type UpdateTripStatusInput = z.infer<typeof UpdateTripStatusSchema>;
export type DateInputValue = z.infer<typeof DateInputSchema>;
