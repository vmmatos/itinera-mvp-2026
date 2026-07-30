import { matchesPreferenceTerm } from '@itinera/shared';

/**
 * `pace` is deliberately absent here. It is generative guidance handed to the
 * tourist agents and the merger — how densely to fill each day — not something a
 * finished itinerary can be scored against. Do not add it as a scoring dimension.
 */
export interface TravellerPreference {
  /** `travellers.id` — always present, unlike `user_id` which is null for guests. */
  travellerId: string;
  /** Resolved at the route boundary: name → persona label → "Traveller N". */
  label: string;
  preferences: {
    /** Explicitly requested themes — weighted double a plain category match. */
    mustHaves?: string[];
    /** Hard exclusions — one match vetoes this traveller's score outright. */
    avoids?: string[];
    /** This traveller's soft interests, derived from their persona. */
    categories?: string[];
  };
}

export interface TravellerScore {
  travellerId: string;
  label: string;
  score: number;
  /** Which avoids were found in the itinerary. Absent when nothing was vetoed. */
  vetoedBy?: string[];
}

export interface ScoringResult {
  scores: TravellerScore[];
  overallScore: number;
}

const MUST_HAVE_WEIGHT = 2;
const CATEGORY_WEIGHT = 1;

/**
 * How many category hits count as full credit for the category component.
 *
 * Must-haves stay linear — the group asked for those explicitly — but categories
 * are a persona-derived proxy, and nobody expects an itinerary to touch every
 * interest a persona implies. Without the cap the denominator grows with the
 * vocabulary, so a traveller could only ever reach a fraction of the score, and
 * because WorkflowStateMachine cancels a trip below an overall 60 that would turn
 * "we filled some of your interests" into a cancelled trip.
 */
const CATEGORY_TARGET = 2;

interface ItineraryTerms {
  /** category + name + venue + description. */
  forMustHaves: string[];
  /** category + name + venue only — a passing mention in prose must not veto a trip. */
  forAvoids: string[];
}

export class ScoringEngine {
  score(proposal: Record<string, unknown>, travellers: TravellerPreference[]): ScoringResult {
    if (travellers.length === 0) {
      return { scores: [], overallScore: 100 };
    }

    const terms = this.extractTerms(proposal);

    const scores: TravellerScore[] = travellers.map((t) => {
      const { mustHaves = [], categories = [], avoids = [] } = t.preferences;

      const vetoedBy = avoids.filter((a) => terms.forAvoids.some((h) => matchesPreferenceTerm(a, h)));
      if (vetoedBy.length > 0) {
        return { travellerId: t.travellerId, label: t.label, score: 0, vetoedBy };
      }

      const categoryTarget = Math.min(categories.length, CATEGORY_TARGET);
      const denominator = mustHaves.length * MUST_HAVE_WEIGHT + categoryTarget * CATEGORY_WEIGHT;
      if (denominator === 0) {
        return { travellerId: t.travellerId, label: t.label, score: 100 };
      }

      const matchedMustHaves = mustHaves.filter((m) =>
        terms.forMustHaves.some((h) => matchesPreferenceTerm(m, h)),
      ).length;
      const matchedCategories = categories.filter((c) =>
        terms.forMustHaves.some((h) => matchesPreferenceTerm(c, h)),
      ).length;

      // Category credit saturates at CATEGORY_TARGET so extra vocabulary can
      // never push a traveller past full marks on that component.
      const earned =
        matchedMustHaves * MUST_HAVE_WEIGHT + Math.min(matchedCategories, categoryTarget) * CATEGORY_WEIGHT;
      const score = Math.max(0, Math.min(100, Math.round((earned / denominator) * 100)));

      return { travellerId: t.travellerId, label: t.label, score };
    });

    const overallScore = Math.round(
      scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
    );

    return { scores, overallScore };
  }

  private extractTerms(proposal: Record<string, unknown>): ItineraryTerms {
    const forMustHaves: string[] = [];
    const forAvoids: string[] = [];

    const itinerary = proposal['itinerary'];
    if (!Array.isArray(itinerary)) return { forMustHaves, forAvoids };

    for (const day of itinerary) {
      if (typeof day !== 'object' || day === null) continue;
      const activities = (day as Record<string, unknown>)['activities'];
      if (!Array.isArray(activities)) continue;

      for (const activity of activities) {
        if (typeof activity !== 'object' || activity === null) continue;
        const a = activity as Record<string, unknown>;

        for (const key of ['category', 'name', 'activity', 'venue']) {
          const value = a[key];
          if (typeof value === 'string' && value.length > 0) {
            forMustHaves.push(value);
            forAvoids.push(value);
          }
        }

        const description = a['description'];
        if (typeof description === 'string' && description.length > 0) {
          forMustHaves.push(description);
        }
      }
    }

    return { forMustHaves, forAvoids };
  }
}
