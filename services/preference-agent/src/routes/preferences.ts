import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError, PREFERENCE_AGENT_CONFIGS, PREFERENCE_AGENT_NAMES } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import type { BaseAgent } from '@/agents/BaseAgent';

const AGENT_NAMES = PREFERENCE_AGENT_NAMES as [string, ...string[]];
type AgentKey = (typeof PREFERENCE_AGENT_NAMES)[number];

const ProposeSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  context: z.string().optional().default(''),
  agents: z.array(z.enum(AGENT_NAMES)).min(1).default([...PREFERENCE_AGENT_NAMES]),
});

const ReactSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposals: z.array(z.unknown()).min(1),
  context: z.string().optional().default(''),
  agents: z.array(z.enum(AGENT_NAMES)).min(1).default([...PREFERENCE_AGENT_NAMES]),
});

export function createPreferencesRouter(agents: Record<AgentKey, BaseAgent>): Router {
  const router = Router();

  router.post('/propose', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ProposeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, context, agents: requestedAgents } = parsed.data;

    const results = await Promise.allSettled(
      requestedAgents.map((name) => agents[name as AgentKey].propose(tripId, round, context)),
    );

    const proposals: AgentEvent[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        proposals.push(result.value);
      } else {
        errors.push(String(result.reason));
      }
    }

    if (errors.length > 0) {
      req.app.locals['logger']?.warn('Some agents failed during propose', { errors, tripId, round });
    }

    res.json({ proposals });
  });

  router.post('/react', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ReactSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.flatten().fieldErrors.toString()));
      return;
    }

    const { tripId, round, proposals, context, agents: requestedAgents } = parsed.data;

    const results = await Promise.allSettled(
      requestedAgents.map((name) => agents[name as AgentKey].react(tripId, round, proposals, context)),
    );

    const reactions: AgentEvent[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        reactions.push(result.value);
      } else {
        errors.push(String(result.reason));
      }
    }

    if (errors.length > 0) {
      req.app.locals['logger']?.warn('Some agents failed during react', { errors, tripId, round });
    }

    res.json({ reactions });
  });

  router.get('/profiles', (_req: Request, res: Response): void => {
    res.json({ agents: PREFERENCE_AGENT_CONFIGS });
  });

  return router;
}
