/**
 * Traveller preferences that steer itinerary generation.
 *
 * These live inside the `travellers.preferences` JSONB column alongside other
 * free-form keys (persona, flexibility, dietary, constraints). Only the three
 * fields below are consumed by the workflow — everything else is passthrough.
 *
 * Naming note: the frontend historically wrote `dealBreakers` for what the UI
 * labels "Avoid". `normalizePreferences` accepts that legacy key and maps it
 * onto `avoids`, which is the single name used from here on.
 */
export type Pace = 'low' | 'medium' | 'high';

export const PACE_VALUES: readonly Pace[] = ['low', 'medium', 'high'] as const;

export interface TravellerPreferences {
  /** How densely the group wants each day filled. */
  pace: Pace;
  /** Themes the group explicitly asked for — weighted higher when scoring. */
  mustHaves: string[];
  /** Hard exclusions — an itinerary matching one vetoes the traveller's score. */
  avoids: string[];
}
