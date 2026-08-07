/**
 * Preferences that steer itinerary generation, at two distinct scopes.
 *
 * `GroupPreferences` is the trip brief — one pace, one set of must-haves, one
 * set of avoids for the whole group. The UI collects it once, so it lives in the
 * `trips.preferences` JSONB column. Trips created before that column existed
 * carry the same keys duplicated inside every `travellers.preferences` blob;
 * `resolveGroupPreferences` reads either shape.
 *
 * `TravellerPreferences` adds the one genuinely per-person axis, `categories`,
 * which is what makes two travellers score differently against the same
 * itinerary. It lives in `travellers.preferences` alongside other free-form keys
 * (persona, flexibility, dietary, constraints) — everything else is passthrough.
 *
 * Naming note: the frontend historically wrote `dealBreakers` for what the UI
 * labels "Avoid". `normalizePreferences` accepts that legacy key and maps it
 * onto `avoids`, which is the single name used from here on.
 */
export type Pace = 'low' | 'medium' | 'high';

export const PACE_VALUES: readonly Pace[] = ['low', 'medium', 'high'] as const;

export interface GroupPreferences {
  /** How densely the group wants each day filled. */
  pace: Pace;
  /** Themes the group explicitly asked for — weighted higher when scoring. */
  mustHaves: string[];
  /** Hard exclusions — an itinerary matching one vetoes the traveller's score. */
  avoids: string[];
  /**
   * Count of real travellers per persona in this group — e.g. `{ action: 1,
   * relaxation: 1 }` for a 2-person group with no culture/gastronomy traveller.
   * Absent or omitting a key means zero real travellers hold that persona.
   * Lets the merge prompt weight fairness by who is actually in the group,
   * instead of treating all 4 tourist agents as equally represented — see
   * `deriveGroupPersonaWeights`. Optional so existing bare
   * `{ pace, mustHaves, avoids }` callers still compile.
   */
  personaWeights?: PersonaWeights;
}

export interface TravellerPreferences extends GroupPreferences {
  /**
   * Soft interests for one traveller. Derived from their `persona` unless the
   * client sent an explicit list — see `resolveCategories`. Not a statement of
   * measured sentiment: it is a keyword proxy, and anything rendered from it
   * should be labelled as a preference match rather than as satisfaction.
   */
  categories: string[];
}

/** The four personas the UI offers, one per preference agent. */
export type PersonaKey = 'culture' | 'relaxation' | 'action' | 'gastronomy';

/** Count of real travellers per persona — see `GroupPreferences.personaWeights`. */
export type PersonaWeights = Partial<Record<PersonaKey, number>>;

export const PERSONA_KEYS: readonly PersonaKey[] = [
  'culture',
  'relaxation',
  'action',
  'gastronomy',
] as const;

/** Mirrors PERSONA_LABELS in apps/frontend/types/index.ts. */
export const PERSONA_LABELS: Record<PersonaKey, string> = {
  culture:    'Culture & Museums',
  relaxation: 'Relaxation & Beach',
  action:     'Action & Hiking',
  gastronomy: 'Gastronomy',
};

/**
 * Interest vocabulary per persona.
 *
 * Deliberately mirrors the closed `category` enums the slot prompts ask for
 * (`{alice,bob,carlos,diana}-slots.txt`) rather than the prose keyword lists in
 * PREFERENCE_AGENT_CONFIGS ("leisurely pace", "physical challenges"): those read
 * well in a system prompt but never match an activity's category, so they would
 * only inflate the scoring denominator. These terms are what the agents actually
 * emit, and WorkflowEngine now stamps that category onto merged activities.
 */
export const PERSONA_CATEGORIES: Record<PersonaKey, readonly string[]> = {
  culture:    ['culture', 'museum', 'history'],
  relaxation: ['beach', 'relaxation', 'wine'],
  action:     ['hiking', 'adventure', 'outdoor'],
  gastronomy: ['gastronomy', 'fine-dining', 'market'],
};
