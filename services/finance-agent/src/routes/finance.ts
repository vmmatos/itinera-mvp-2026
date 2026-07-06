import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, NotFoundError } from '@itinera/shared';
import type { BudgetPlan, BudgetBlock } from '@itinera/shared';
import type { CostCalculator, ItineraryDay, CostItem, TransportItem, AccommodationItem } from '@/agents/CostCalculator';
import type { BudgetValidator } from '@/agents/BudgetValidator';
import type { AlternativeFinder } from '@/agents/AlternativeFinder';
import type { ProposalStorageService } from '@/services/ProposalStorageService';
import { buildFinanceVerdict } from '@/services/FinanceVerdict';

const ReviewSchema = z.object({
  tripId:         z.string().uuid(),
  round:          z.number().int().min(1),
  proposal:       z.record(z.unknown()),
  budgetTotal:    z.coerce.number().positive(),
  budgetCurrency: z.string().min(1),
  groupSize:      z.coerce.number().int().min(1).optional().default(1),
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

  // Early budget envelope check: validates transport + accommodation costs against budget
  // before tourist agents run. Pure code — no LLM. Uses existing CostCalculator + BudgetValidator.
  const EstimateSchema = z.object({
    tripId:         z.string().uuid(),
    routeGraph:     z.object({
      orderedLegs:  z.array(z.object({ totalCostEurPerPerson: z.number() })),
      cityStays:    z.array(z.object({
        city:                   z.string(),
        nights:                 z.number().int().min(1),
        budgetPerPersonPerNight: z.number(),
      })),
      totalTransportCostEurPerPerson: z.number(),
      totalDurationDays: z.number(),
    }),
    budgetTotal:    z.coerce.number().positive(),
    budgetCurrency: z.string().min(1).default('EUR'),
    groupSize:      z.coerce.number().int().min(1).default(1),
  });

  // Accommodation ~35% of experience budget; experiences get the rest
  const ACCOMMODATION_RATIO = 0.35;

  router.post('/estimate', (req: Request, res: Response, next: NextFunction): void => {
    const parsed = EstimateSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { routeGraph, budgetTotal, budgetCurrency, groupSize } = parsed.data;
    const budgetPerPerson = budgetTotal / groupSize;

    const transportTotal = routeGraph.totalTransportCostEurPerPerson;
    const accommodationTotal = routeGraph.cityStays.reduce(
      (sum, stay) => sum + stay.budgetPerPersonPerNight * stay.nights, 0,
    );
    const experiencesTotal = Math.max(0, budgetPerPerson - transportTotal - accommodationTotal);

    const perBlock: BudgetBlock[] = routeGraph.cityStays.map((stay) => {
      const stayTransport = routeGraph.orderedLegs
        .filter((_, i) => i < routeGraph.cityStays.indexOf(stay))
        .reduce((sum, leg) => sum + leg.totalCostEurPerPerson, 0);
      const stayAccommodation = stay.budgetPerPersonPerNight * stay.nights;
      const nightRatio = routeGraph.totalDurationDays > 0 ? stay.nights / routeGraph.totalDurationDays : 1;
      const stayExperiences = Math.round(experiencesTotal * nightRatio);
      return {
        city: stay.city,
        transportCostEurPerPerson: Math.round(stayTransport),
        accommodationBudgetEurPerPerson: Math.round(stayAccommodation),
        experiencesBudgetEurPerPerson: stayExperiences,
        totalEurPerPerson: Math.round(stayTransport + stayAccommodation + stayExperiences),
      } satisfies BudgetBlock;
    });

    const totalEurPerPerson = Math.round(transportTotal + accommodationTotal + experiencesTotal);
    const feasible = experiencesTotal >= 0 && transportTotal + accommodationTotal <= budgetPerPerson;
    const bufferPct = Math.round(((budgetPerPerson - transportTotal - accommodationTotal) / budgetPerPerson) * 100);

    const budgetPlan: BudgetPlan = {
      perBlock,
      totalEurPerPerson,
      grandTotal: Math.round(totalEurPerPerson * groupSize),
      feasible,
      bufferPct,
      currency: budgetCurrency,
    };

    res.json({ budgetPlan });
  });

  router.post('/review', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposal, budgetTotal, budgetCurrency, groupSize, context, dateInput } = parsed.data;

    const rawItinerary = Array.isArray(proposal['itinerary']) ? proposal['itinerary'] : [];
    const itinerary: ItineraryDay[] = (rawItinerary as Array<Record<string, unknown>>).map((day) => ({
      day: typeof day['day'] === 'number' ? day['day'] : 1,
      activities: Array.isArray(day['activities']) ? (day['activities'] as CostItem[]) : [],
      meals: Array.isArray(day['meals']) ? (day['meals'] as CostItem[]) : [],
      transport: Array.isArray(day['transport']) ? (day['transport'] as TransportItem[]) : [],
    }));

    const accommodation: AccommodationItem[] = Array.isArray(proposal['accommodation'])
      ? (proposal['accommodation'] as AccommodationItem[])
      : [];

    const breakdown = calculator.calculate(itinerary, budgetCurrency, accommodation, groupSize);
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
