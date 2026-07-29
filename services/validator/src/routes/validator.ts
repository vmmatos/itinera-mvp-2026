import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, normalizePreferences } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Traveller } from '@/entities/Traveller';
import type { ValidationService } from '@/services/ValidationService';
import type { ScoringEngine, TravellerPreference } from '@/validators/ScoringEngine';
import type { FairnessCalculator } from '@/validators/FairnessCalculator';
import type { ConstraintChecker } from '@/validators/ConstraintChecker';

const ValidateSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposal: z.record(z.unknown()),
});

const TravellerPreferenceSchema = z.object({
  userId: z.string().uuid(),
  preferences: z.object({
    mustHaves: z.array(z.string()).optional(),
    avoids: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
  }),
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
 * Map a stored `travellers.preferences` blob onto the scoring shape.
 * `normalizePreferences` unifies the legacy `dealBreakers` key with `avoids`.
 */
function toTravellerPreference(traveller: Traveller): TravellerPreference {
  const normalized = normalizePreferences(traveller.preferences);
  return {
    userId: traveller.userId,
    preferences: {
      mustHaves: normalized.mustHaves,
      avoids: normalized.avoids,
      categories: (traveller.preferences['categories'] as string[] | undefined) ?? [],
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

    const { tripId, round, proposal } = parsed.data;
    const start = Date.now();

    const travellerRepo = AppDataSource.getRepository(Traveller);
    const dbTravellers = await travellerRepo.find({ where: { tripId } });
    const travellers = dbTravellers.map(toTravellerPreference);

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

    let travellers = bodyTravellers ?? [];
    if (travellers.length === 0) {
      const travellerRepo = AppDataSource.getRepository(Traveller);
      const dbTravellers = await travellerRepo.find({ where: { tripId } });
      travellers = dbTravellers.map(toTravellerPreference);
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
