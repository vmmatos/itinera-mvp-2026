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

const PreferenceTermsSchema = z.array(z.string().max(120)).max(20);

/**
 * Only the workflow-relevant keys are typed; `.passthrough()` keeps the rest of
 * the blob (persona, dietary, constraints, budgetLimit) which is stored verbatim.
 * `dealBreakers` is the legacy name for `avoids` — accepted so older clients keep
 * working; `normalizePreferences` in @itinera/shared unifies them on read.
 *
 * `pace`/`mustHaves`/`avoids` are still accepted here because the brief used to
 * be copied into every traveller. New clients send it once at the trip level
 * (`TripPreferencesSchema`); `categories` is the per-traveller key.
 */
const TravellerPreferencesSchema = z
  .object({
    pace:         z.enum(['low', 'medium', 'high']).optional(),
    mustHaves:    PreferenceTermsSchema.optional(),
    avoids:       PreferenceTermsSchema.optional(),
    dealBreakers: PreferenceTermsSchema.optional(),
    categories:   PreferenceTermsSchema.optional(),
  })
  .passthrough();

/** The group brief, collected once by the form. Stored in `trips.preferences`. */
const TripPreferencesSchema = z
  .object({
    pace:         z.enum(['low', 'medium', 'high']).optional(),
    mustHaves:    PreferenceTermsSchema.optional(),
    avoids:       PreferenceTermsSchema.optional(),
    dealBreakers: PreferenceTermsSchema.optional(),
  })
  .passthrough();

export const CreateTripSchema = z.object({
  name:                z.string().min(1).max(255),
  destinations:        z.array(DestinationSchema).min(1).optional(),
  region:              z.string().min(1).max(255).optional(),
  dateInput:           DateInputSchema.optional(),
  budgetTotal:         z.number().positive().optional(),
  budgetCurrency:      z.enum(['EUR', 'USD']).default('EUR'),
  transportPreference: z.enum(['flight', 'train', 'car', 'best']).default('best').optional(),
  preferences:         TripPreferencesSchema.default({}),
  travellers: z
    .array(
      z.object({
        userId:      z.string().uuid().optional(),
        name:        z.string().min(1).max(255).optional(),
        preferences: TravellerPreferencesSchema.default({}),
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
