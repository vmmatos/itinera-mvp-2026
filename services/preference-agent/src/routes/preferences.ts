import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@itinera/shared';
import type { AgentEvent } from '@itinera/shared';
import type { BaseAgent } from '@/agents/BaseAgent';

const AGENT_NAMES = ['alice', 'bob', 'carlos', 'diana'] as const;
type AgentKey = (typeof AGENT_NAMES)[number];

const ProposeSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  context: z.string().optional().default(''),
  agents: z.array(z.enum(AGENT_NAMES)).min(1).default([...AGENT_NAMES]),
});

const ReactSchema = z.object({
  tripId: z.string().uuid(),
  round: z.number().int().min(1),
  proposals: z.array(z.unknown()).min(1),
  context: z.string().optional().default(''),
  agents: z.array(z.enum(AGENT_NAMES)).min(1).default([...AGENT_NAMES]),
});

const AGENT_PROFILES = [
  {
    name: 'alice',
    persona: 'Culture & History Enthusiast',
    preferences: ['museums', 'historical sites', 'cultural events', 'architecture', 'art galleries'],
  },
  {
    name: 'bob',
    persona: 'Relaxation & Wine Lover',
    preferences: ['beach', 'coastal resorts', 'wine tasting', 'leisurely pace', 'scenic views'],
  },
  {
    name: 'carlos',
    persona: 'Adventure & Outdoor Explorer',
    preferences: ['hiking', 'adventure sports', 'national parks', 'physical challenges', 'nature'],
  },
  {
    name: 'diana',
    persona: 'Gastronomy & Fine Dining Connoisseur',
    preferences: ['michelin restaurants', 'food markets', 'cooking classes', 'local cuisine', 'wine pairing'],
  },
] as const;

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
      requestedAgents.map((name) => agents[name].propose(tripId, round, context)),
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
      requestedAgents.map((name) => agents[name].react(tripId, round, proposals, context)),
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
    res.json({ agents: AGENT_PROFILES });
  });

  return router;
}
