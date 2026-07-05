import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@itinera/shared';
import type { ConflictAnalyzer } from '@/agents/ConflictAnalyzer';
import type { CompromiseGenerator } from '@/agents/CompromiseGenerator';
import type { ProposalRefiner } from '@/agents/ProposalRefiner';
import type { ItineraryMerger } from '@/agents/ItineraryMerger';

const AnalyzeSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposals: z.array(z.unknown()).min(1),
});

const ProposeSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  conflicts: z.unknown().refine((v) => v !== undefined, { message: 'Required' }),
  context: z.string().optional().default(''),
});

const RefineSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposal: z.unknown().refine((v) => v !== undefined, { message: 'Required' }),
  feedback: z.string().min(1),
  context: z.string().optional().default(''),
});

const MergeSchema = z.object({
  tripId:        z.string().uuid(),
  round:         z.number().int().min(1),
  routeGraph:    z.record(z.unknown()),
  touristOutputs: z.record(z.unknown()),
  budgetPlan:    z.record(z.unknown()),
  context:       z.string().optional().default(''),
});

export function createOrchestratorRouter(
  analyzer: ConflictAnalyzer,
  generator: CompromiseGenerator,
  refiner: ProposalRefiner,
  merger?: ItineraryMerger,
): Router {
  const router = Router();

  router.post('/analyze', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = AnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposals } = parsed.data;
    const analysis = await analyzer.analyze(tripId, round, proposals);
    res.json({ analysis });
  });

  router.post('/propose', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ProposeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, conflicts, context } = parsed.data;
    const compromise = await generator.generateCompromise(tripId, round, conflicts, context);
    res.json({ compromise });
  });

  router.post('/refine', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = RefineSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposal, feedback, context } = parsed.data;
    const refined = await refiner.refine(tripId, round, proposal, feedback, context);
    res.json({ refined });
  });

  // Merge endpoint for WorkflowEngine v2: takes route_graph + 4 tourist outputs → unified itinerary.
  router.post('/merge', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!merger) {
      next(new ValidationError('Merge endpoint not available in this configuration'));
      return;
    }
    const parsed = MergeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, routeGraph, touristOutputs, budgetPlan, context } = parsed.data;
    const merged = await merger.merge(
      tripId,
      round,
      routeGraph as unknown as Parameters<ItineraryMerger['merge']>[2],
      touristOutputs,
      budgetPlan as unknown as Parameters<ItineraryMerger['merge']>[4],
      context,
    );
    res.json({ merged });
  });

  return router;
}
