import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, NotFoundError } from '@itinera/shared';
import type { CostCalculator } from '@/agents/CostCalculator';
import type { BudgetValidator } from '@/agents/BudgetValidator';
import type { AlternativeFinder } from '@/agents/AlternativeFinder';
import type { ProposalStorageService } from '@/services/ProposalStorageService';

const CostItemSchema = z.object({
  name: z.string().min(1),
  cost: z.number().nonnegative(),
  currency: z.string().min(1),
});

const TransportItemSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  cost: z.number().nonnegative(),
  currency: z.string().min(1),
});

const ItineraryDaySchema = z.object({
  day: z.number().int().min(1),
  activities: z.array(CostItemSchema),
  meals: z.array(CostItemSchema),
  transport: z.array(TransportItemSchema),
});

const ReviewSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposal: z.object({
    itinerary: z.array(ItineraryDaySchema).min(1),
  }),
  budgetTotal: z.number().positive(),
  budgetCurrency: z.string().min(1),
  context: z.string().optional().default(''),
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

    const { tripId, round, proposal, budgetTotal, budgetCurrency, context } = parsed.data;

    const breakdown = calculator.calculate(proposal.itinerary, budgetCurrency);
    const validation = validator.validate(breakdown, budgetTotal, budgetCurrency);
    const review = await finder.findAlternatives(tripId, round, proposal, breakdown, validation, context);

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
