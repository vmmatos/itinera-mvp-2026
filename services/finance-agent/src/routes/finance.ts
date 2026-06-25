import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, NotFoundError } from '@itinera/shared';
import type { CostCalculator, ItineraryDay, CostItem, TransportItem } from '@/agents/CostCalculator';
import type { BudgetValidator } from '@/agents/BudgetValidator';
import type { AlternativeFinder } from '@/agents/AlternativeFinder';
import type { ProposalStorageService } from '@/services/ProposalStorageService';
import { buildFinanceVerdict } from '@/services/FinanceVerdict';

const ReviewSchema = z.object({
  tripId:         z.string().uuid(),
  round:          z.number().int().min(1),
  proposal:       z.record(z.unknown()),
  budgetTotal:    z.number().positive(),
  budgetCurrency: z.string().min(1),
  context:        z.string().optional().default(''),
  dateInput: z.object({
    mode:           z.string(),
    preferredMonth: z.string().optional(),
    window:         z.string().optional(),
    days:           z.number().optional(),
  }).nullable().optional(),
});

const BreakdownQuerySchema = z.object({
  tripId: z.string().uuid(),
  round: z.coerce.number().int().min(1).optional(),
});

export function createFinanceRouter(
  calculator: CostCalculator,
  validator: BudgetValidator,
  finder: AlternativeFinder,
  storage: ProposalStorageService,
): Router {
  const router = Router();

  router.post('/review', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposal, budgetTotal, budgetCurrency, context, dateInput } = parsed.data;

    const rawItinerary = Array.isArray(proposal['itinerary']) ? proposal['itinerary'] : [];
    const itinerary: ItineraryDay[] = (rawItinerary as Array<Record<string, unknown>>).map((day) => ({
      day: typeof day['day'] === 'number' ? day['day'] : 1,
      activities: Array.isArray(day['activities']) ? (day['activities'] as CostItem[]) : [],
      meals: Array.isArray(day['meals']) ? (day['meals'] as CostItem[]) : [],
      transport: Array.isArray(day['transport']) ? (day['transport'] as TransportItem[]) : [],
    }));

    const breakdown = calculator.calculate(itinerary, budgetCurrency);
    const validation = validator.validate(breakdown, budgetTotal, budgetCurrency);
    const review = await finder.findAlternatives(tripId, round, proposal, breakdown, validation, context, dateInput ?? null);

    // Attach Finance's structured verdict so the Orchestrator can decide whether
    // the trip has converged (or is impossible and must be rejected).
    const reviewContent = (review.content ?? {}) as Record<string, unknown>;
    const alternatives = reviewContent['alternatives'] as
      { revisedBudgetEstimate?: number; totalPotentialSaving?: number } | undefined;
    reviewContent['verdict'] = buildFinanceVerdict(breakdown, validation, alternatives ?? null);
    review.content = reviewContent;

    res.json({ review });
  });

  router.get('/breakdown', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = BreakdownQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round } = parsed.data;
    const proposal = await storage.findLatestByTripId(tripId, round);

    if (!proposal) {
      next(new NotFoundError('Finance breakdown'));
      return;
    }

    res.json({ breakdown: proposal.content });
  });

  return router;
}
