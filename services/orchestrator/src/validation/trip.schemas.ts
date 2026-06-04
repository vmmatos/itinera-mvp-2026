import { z } from 'zod';

const DestinationSchema = z.object({
  country: z.string().min(1).max(100),
  city:    z.string().max(100).optional(),
  nights:  z.number().int().min(1).max(365),
});

export const CreateTripSchema = z.object({
  name:         z.string().min(1).max(255),
  destinations: z.array(DestinationSchema).min(1).optional(),
  region:       z.string().min(1).max(255).optional(),
  startDate:    z.string().date().optional(),
  endDate:      z.string().date().optional(),
  budgetTotal:  z.number().positive().optional(),
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
  // Derive region from destinations if not explicitly set
  if (!data.region && data.destinations?.length) {
    const parts = data.destinations.map((d) => d.city ? `${d.city}, ${d.country}` : d.country);
    return { ...data, region: [...new Set(parts)].join(' · ') };
  }
  return data;
});

export const TripIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateTripStatusSchema = z.object({
  status: z.enum(['cancelled', 'confirmed']),
});

export type CreateTripInput = z.infer<typeof CreateTripSchema>;
export type UpdateTripStatusInput = z.infer<typeof UpdateTripStatusSchema>;
