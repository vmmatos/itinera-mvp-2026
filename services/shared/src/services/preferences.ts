import { PACE_VALUES, PERSONA_CATEGORIES, PERSONA_KEYS, PERSONA_LABELS } from '../types/preferences';
import type { GroupPreferences, Pace, PersonaKey, TravellerPreferences } from '../types/preferences';

/** Ordered slowest → fastest. Ties in `aggregateGroupPreferences` resolve left. */
const PACE_ORDER: readonly Pace[] = ['low', 'medium', 'high'] as const;

export const DEFAULT_GROUP_PREFERENCES: GroupPreferences = {
  pace: 'medium',
  mustHaves: [],
  avoids: [],
};

export const DEFAULT_PREFERENCES: TravellerPreferences = {
  ...DEFAULT_GROUP_PREFERENCES,
  categories: [],
};

/**
 * Lowercase + strip diacritics so pt-PT free text can be compared with the
 * English category enums the agents emit ("Museus" vs "museum", "Gerês" vs "geres").
 */
export function foldTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Below this length a token must match exactly — "bar" must not match "Barcelos". */
const MIN_STEM_LENGTH = 4;
/** Tokens shorter than this are stopword-ish noise ("de", "do", "a") and are dropped. */
const MIN_TOKEN_LENGTH = 3;

function tokenize(value: string): string[] {
  return foldTerm(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/** Crude plural strip — enough to bridge "museus"/"museum" and "praias"/"praia". */
function stem(token: string): string {
  return token.length > MIN_STEM_LENGTH && token.endsWith('s') ? token.slice(0, -1) : token;
}

function tokensMatch(a: string, b: string): boolean {
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  if (Math.min(sa.length, sb.length) < MIN_STEM_LENGTH) return false;
  return sa.startsWith(sb) || sb.startsWith(sa);
}

/**
 * Token-level prefix match — must-haves are free text written by the user
 * ("museus") while the haystack is an activity's category, name or venue
 * ("Museu Nacional do Azulejo", "museum"). Exact equality would never hit, and
 * plain substring containment would let a 3-letter avoid veto half the itinerary.
 *
 * A multi-word term requires every one of its tokens to be present.
 */
export function matchesPreferenceTerm(term: string, haystack: string): boolean {
  const termTokens = tokenize(term);
  const hayTokens = tokenize(haystack);
  if (termTokens.length === 0 || hayTokens.length === 0) return false;
  return termTokens.every((t) => hayTokens.some((h) => tokensMatch(t, h)));
}

function toTermList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Dedupe case/accent-insensitively while preserving the first-seen spelling. */
function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = foldTerm(term);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function toPace(value: unknown): Pace {
  return PACE_VALUES.includes(value as Pace) ? (value as Pace) : DEFAULT_PREFERENCES.pace;
}

export function isPersonaKey(value: unknown): value is PersonaKey {
  return typeof value === 'string' && PERSONA_KEYS.includes(value as PersonaKey);
}

/** Interest vocabulary for a persona; `[]` when the persona is missing or unknown. */
export function categoriesForPersona(persona: unknown): string[] {
  return isPersonaKey(persona) ? [...PERSONA_CATEGORIES[persona]] : [];
}

/** Human label for a persona ("Culture & Museums"); `null` when missing or unknown. */
export function personaLabelFor(persona: unknown): string | null {
  return isPersonaKey(persona) ? PERSONA_LABELS[persona] : null;
}

/**
 * A traveller's soft interests. An explicit `categories` list wins — that is the
 * hook for a future per-traveller interest picker — and otherwise the list is
 * derived from the `persona` the UI already collects. A list that cleans to empty
 * counts as absent, so `categories: ['', ' ']` still falls back to the persona.
 */
export function resolveCategories(raw: Record<string, unknown> | null | undefined): string[] {
  if (raw === null || raw === undefined || typeof raw !== 'object') return [];
  const explicit = dedupeTerms(toTermList(raw['categories']));
  return explicit.length > 0 ? explicit : categoriesForPersona(raw['persona']);
}

/**
 * Read the workflow-relevant fields out of a raw `travellers.preferences` blob.
 * Tolerates missing keys, wrong types, and the legacy `dealBreakers` name.
 *
 * `pace`/`mustHaves`/`avoids` are only present on blobs written before the trip
 * brief moved to `trips.preferences`; they are still read so legacy trips keep
 * working (see `resolveGroupPreferences`).
 */
export function normalizePreferences(raw: Record<string, unknown> | null | undefined): TravellerPreferences {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { ...DEFAULT_PREFERENCES };
  }

  return {
    pace: toPace(raw['pace']),
    mustHaves: dedupeTerms(toTermList(raw['mustHaves'])),
    // `dealBreakers` is what the frontend wrote before this field was unified.
    // Union rather than fallback so a half-migrated blob loses nothing.
    avoids: dedupeTerms([...toTermList(raw['avoids']), ...toTermList(raw['dealBreakers'])]),
    categories: resolveCategories(raw),
  };
}

/**
 * Collapse a group's individual preferences into the single set the workflow acts on.
 *
 * must-haves/avoids are unioned — one traveller's hard exclusion binds the group.
 * pace takes the modal value, breaking ties toward the slower option: a packed
 * itinerary hurts a relaxed traveller more than a relaxed one hurts a packed traveller.
 */
export function aggregateGroupPreferences(
  travellers: ReadonlyArray<{ preferences?: Record<string, unknown> | null }>,
): GroupPreferences {
  if (travellers.length === 0) return { ...DEFAULT_GROUP_PREFERENCES };

  const normalized = travellers.map((t) => normalizePreferences(t.preferences));

  const counts = new Map<Pace, number>();
  for (const { pace } of normalized) {
    counts.set(pace, (counts.get(pace) ?? 0) + 1);
  }

  let pace: Pace = DEFAULT_GROUP_PREFERENCES.pace;
  let best = -1;
  for (const candidate of PACE_ORDER) {
    const count = counts.get(candidate) ?? 0;
    if (count > best) {
      best = count;
      pace = candidate;
    }
  }

  return {
    pace,
    mustHaves: dedupeTerms(normalized.flatMap((p) => p.mustHaves)),
    avoids: dedupeTerms(normalized.flatMap((p) => p.avoids)),
  };
}

/**
 * Does this raw `trips.preferences` blob carry group intent?
 *
 * The column is `NOT NULL DEFAULT '{}'`, so "never written" and "explicitly
 * empty" are indistinguishable at the column level — a valid pace or a non-empty
 * term list is what tells them apart.
 */
export function hasGroupPreferences(raw: Record<string, unknown> | null | undefined): boolean {
  if (raw === null || raw === undefined || typeof raw !== 'object') return false;
  if (PACE_VALUES.includes(raw['pace'] as Pace)) return true;
  return (
    toTermList(raw['mustHaves']).length > 0 ||
    toTermList(raw['avoids']).length > 0 ||
    toTermList(raw['dealBreakers']).length > 0
  );
}

/**
 * The trip brief the workflow acts on.
 *
 * Trip-level wins outright when present; otherwise the travellers' own blobs are
 * collapsed, which is how trips created before `trips.preferences` existed keep
 * working. Precedence rather than union on purpose: a half-updated client that
 * sends both shapes must not have stale per-traveller copies double-counted.
 */
export function resolveGroupPreferences(
  tripPreferences: Record<string, unknown> | null | undefined,
  travellers: ReadonlyArray<{ preferences?: Record<string, unknown> | null }>,
): GroupPreferences {
  if (hasGroupPreferences(tripPreferences)) {
    const normalized = normalizePreferences(tripPreferences);
    return { pace: normalized.pace, mustHaves: normalized.mustHaves, avoids: normalized.avoids };
  }
  return aggregateGroupPreferences(travellers);
}
