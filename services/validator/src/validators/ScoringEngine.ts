export interface TravellerPreference {
  userId: string;
  preferences: {
    categories?: string[];
    avoid?: string[];
  };
}

export interface TravellerScore {
  userId: string;
  score: number;
}

export interface ScoringResult {
  scores: TravellerScore[];
  overallScore: number;
}

export class ScoringEngine {
  score(proposal: Record<string, unknown>, travellers: TravellerPreference[]): ScoringResult {
    if (travellers.length === 0) {
      return { scores: [], overallScore: 100 };
    }

    const activityCategories = this.extractCategories(proposal);

    const scores: TravellerScore[] = travellers.map((t) => {
      const { categories = [], avoid = [] } = t.preferences;
      const total = categories.length + avoid.length;
      if (total === 0) {
        return { userId: t.userId, score: 100 };
      }

      const matched = categories.filter((c) =>
        activityCategories.some((a) => a.toLowerCase() === c.toLowerCase()),
      ).length;

      const avoided = avoid.filter((c) =>
        activityCategories.some((a) => a.toLowerCase() === c.toLowerCase()),
      ).length;

      const raw = ((matched - avoided) / total) * 100;
      const clamped = Math.max(0, Math.min(100, Math.round(raw)));

      return { userId: t.userId, score: clamped };
    });

    const overallScore = Math.round(
      scores.reduce((sum, s) => sum + s.score, 0) / scores.length,
    );

    return { scores, overallScore };
  }

  private extractCategories(proposal: Record<string, unknown>): string[] {
    const categories: string[] = [];
    const itinerary = proposal['itinerary'];
    if (!Array.isArray(itinerary)) return categories;

    for (const day of itinerary) {
      if (typeof day !== 'object' || day === null) continue;
      const d = day as Record<string, unknown>;
      const activities = d['activities'];
      if (!Array.isArray(activities)) continue;
      for (const activity of activities) {
        if (typeof activity !== 'object' || activity === null) continue;
        const a = activity as Record<string, unknown>;
        if (typeof a['category'] === 'string') {
          categories.push(a['category']);
        }
        if (typeof a['name'] === 'string') {
          categories.push(a['name']);
        }
      }
    }

    return categories;
  }
}
