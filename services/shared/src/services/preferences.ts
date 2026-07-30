import { PACE_VALUES } from '../types/preferences';
import type { Pace, TravellerPreferences } from '../types/preferences';

/** Ordered slowest → fastest. Ties in `aggregateGroupPreferences` resolve left. */
const PACE_ORDER: readonly Pace[] = ['low', 'medium', 'high'] as const;

export const DEFAULT_PREFERENCES: TravellerPreferences = {
  pace: 'medium',
  mustHaves: [],
  avoids: [],
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

/**
 * Read the three workflow-relevant fields out of a raw `travellers.preferences`
 * blob. Tolerates missing keys, wrong types, and the legacy `dealBreakers` name.
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
): TravellerPreferences {
  if (travellers.length === 0) return { ...DEFAULT_PREFERENCES };

  const normalized = travellers.map((t) => normalizePreferences(t.preferences));

  const counts = new Map<Pace, number>();
  for (const { pace } of normalized) {
    counts.set(pace, (counts.get(pace) ?? 0) + 1);
  }

  let pace: Pace = DEFAULT_PREFERENCES.pace;
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
