import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, normalizePreferences, personaLabelFor } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Traveller } from '@/entities/Traveller';
import type { ValidationService } from '@/services/ValidationService';
import type { ScoringEngine, TravellerPreference } from '@/validators/ScoringEngine';
import type { FairnessCalculator } from '@/validators/FairnessCalculator';
import type { ConstraintChecker } from '@/validators/ConstraintChecker';

const PreferenceTermsSchema = z.array(z.string().max(120)).max(20);

/**
 * The trip-level brief. Sent by the orchestrator, which already holds it in the
 * workflow context — reading `trips` from here would duplicate schema ownership
 * across two services for data that is one field away. Optional so a legacy trip
 * (brief still inside each traveller's blob) keeps scoring.
 *
 * `pace` is deliberately not accepted — see the note at the top of ScoringEngine.
 */
const GroupPreferencesSchema = z.object({
  mustHaves: PreferenceTermsSchema.default([]),
  avoids: PreferenceTermsSchema.default([]),
});

const ValidateSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposal: z.record(z.unknown()),
  groupPreferences: GroupPreferencesSchema.optional(),
});

const TravellerPreferenceSchema = z
  .object({
    travellerId: z.string().min(1).optional(),
    /** @deprecated pre-M109 callers keyed travellers by user id. */
    userId: z.string().min(1).optional(),
    label: z.string().min(1).max(255).optional(),
    preferences: z.object({
      mustHaves: z.array(z.string()).optional(),
      avoids: z.array(z.string()).optional(),
      categories: z.array(z.string()).optional(),
    }),
  })
  .transform((t, ctx) => {
    const travellerId = t.travellerId ?? t.userId;
    if (travellerId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'travellerId is required' });
      return z.NEVER;
    }
    return { travellerId, label: t.label ?? 'Traveller', preferences: t.preferences };
  });

const ItinerarySchema = z.object({
  tripId: z.string().uuid(),
  proposal: z.record(z.unknown()),
  travellers: z.array(TravellerPreferenceSchema).optional(),
});

const ConstraintsSchema = z.object({
  tripId: z.string().uuid(),
  proposal: z.record(z.unknown()),
  constraints: z.object({
    budgetTotal: z.number().positive().optional(),
    travellerCount: z.number().int().positive().optional(),
    durationDays: z.number().int().positive().optional(),
  }),
});

/**
 * Map a stored traveller row onto the scoring shape.
 *
 * must-haves/avoids are group-wide: they come from the trip-level brief when the
 * caller sends it, and otherwise from this traveller's own blob, which is where
 * trips created before `trips.preferences` kept their copy. `categories` is always
 * per traveller — derived from their persona by `normalizePreferences` — and is
 * what makes two travellers score differently against the same itinerary.
 *
 * The label is resolved here rather than in each consumer so the score rows read
 * the same in the UI, the PDF and the admin view.
 */
function toTravellerPreference(
  traveller: Traveller,
  index: number,
  group?: { mustHaves: string[]; avoids: string[] },
): TravellerPreference {
  const normalized = normalizePreferences(traveller.preferences);
  return {
    travellerId: traveller.id,
    label: traveller.name?.trim() || personaLabelFor(traveller.preferences['persona']) || `Traveller ${index + 1}`,
    preferences: {
      mustHaves: group ? group.mustHaves : normalized.mustHaves,
      avoids: group ? group.avoids : normalized.avoids,
      categories: normalized.categories,
    },
  };
}

export function createValidatorRouter(
  validationService: ValidationService,
  scoringEngine: ScoringEngine,
  fairnessCalculator: FairnessCalculator,
  constraintChecker: ConstraintChecker,
): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposal, groupPreferences } = parsed.data;
    const start = Date.now();

    const travellerRepo = AppDataSource.getRepository(Traveller);
    // Ordered so the "Traveller N" label fallback is stable across calls.
    const dbTravellers = await travellerRepo.find({ where: { tripId }, order: { createdAt: 'ASC' } });
    const travellers = dbTravellers.map((t, i) => toTravellerPreference(t, i, groupPreferences));

    const result = await validationService.validate(tripId, round, proposal, {}, travellers);

    res.json({
      content: result,
      reasoning: '',
      latencyMs: Date.now() - start,
      tokensUsed: 0,
    });
  });

  router.post('/itinerary', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ItinerarySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, proposal, travellers: bodyTravellers } = parsed.data;

    let travellers: TravellerPreference[] = bodyTravellers ?? [];
    if (travellers.length === 0) {
      const travellerRepo = AppDataSource.getRepository(Traveller);
      const dbTravellers = await travellerRepo.find({ where: { tripId }, order: { createdAt: 'ASC' } });
      travellers = dbTravellers.map((t, i) => toTravellerPreference(t, i));
    }

    const scoring = scoringEngine.score(proposal, travellers);
    const fairness = fairnessCalculator.calculate(scoring.scores);

    res.json({ scoring, fairness });
  });

  router.post('/constraints', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ConstraintsSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { proposal, constraints } = parsed.data;
    const result = constraintChecker.check(proposal, constraints);

    res.json({ constraints: result });
  });

  return router;
}
