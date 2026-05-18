import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@itinera/shared';
import { AppDataSource } from '@/data-source';
import { Traveller } from '@/entities/Traveller';
import type { ValidationService } from '@/services/ValidationService';
import type { ScoringEngine } from '@/validators/ScoringEngine';
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
    categories: z.array(z.string()).optional(),
    avoid: z.array(z.string()).optional(),
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
    const travellers = dbTravellers.map((t) => ({
      userId: t.userId,
      preferences: {
        categories: (t.preferences['categories'] as string[] | undefined) ?? [],
        avoid: (t.preferences['avoid'] as string[] | undefined) ?? [],
      },
    }));

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
      travellers = dbTravellers.map((t) => ({
        userId: t.userId,
        preferences: {
          categories: (t.preferences['categories'] as string[] | undefined) ?? [],
          avoid: (t.preferences['avoid'] as string[] | undefined) ?? [],
        },
      }));
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
