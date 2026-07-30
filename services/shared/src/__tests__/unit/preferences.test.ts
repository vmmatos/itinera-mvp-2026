import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GROUP_PREFERENCES,
  DEFAULT_PREFERENCES,
  aggregateGroupPreferences,
  categoriesForPersona,
  foldTerm,
  hasGroupPreferences,
  isPersonaKey,
  matchesPreferenceTerm,
  normalizePreferences,
  personaLabelFor,
  resolveCategories,
  resolveGroupPreferences,
} from '../../services/preferences';
import { PERSONA_CATEGORIES } from '../../types/preferences';

describe('foldTerm', () => {
  it('lowercases and strips diacritics', () => {
    expect(foldTerm('Gerês')).toBe('geres');
    expect(foldTerm('  MUSEUS  ')).toBe('museus');
  });
});

describe('matchesPreferenceTerm', () => {
  it('matches across languages via containment', () => {
    expect(matchesPreferenceTerm('museus', 'Museum')).toBe(true);
    expect(matchesPreferenceTerm('museus', 'Museu Nacional do Azulejo')).toBe(true);
  });

  it('matches ignoring accents and case', () => {
    expect(matchesPreferenceTerm('Gerês', 'geres national park')).toBe(true);
  });

  it('matches on a single token of a multi-word venue', () => {
    expect(matchesPreferenceTerm('praias', 'Praia de Matosinhos')).toBe(true);
  });

  it('requires every token of a multi-word term', () => {
    expect(matchesPreferenceTerm('wine tasting', 'Wine tasting at Quinta do Vale')).toBe(true);
    expect(matchesPreferenceTerm('wine tasting', 'Wine cellar tour')).toBe(false);
  });

  it('returns false for unrelated terms', () => {
    expect(matchesPreferenceTerm('praias', 'wine tasting')).toBe(false);
  });

  it('does not let a short term prefix-match a longer word', () => {
    expect(matchesPreferenceTerm('bar', 'Barcelos old town')).toBe(false);
    expect(matchesPreferenceTerm('bar', 'Rooftop bar')).toBe(true);
  });

  it('returns false when either side is empty', () => {
    expect(matchesPreferenceTerm('', 'museum')).toBe(false);
    expect(matchesPreferenceTerm('museus', '')).toBe(false);
    expect(matchesPreferenceTerm('   ', 'museum')).toBe(false);
  });
});

describe('normalizePreferences', () => {
  it('reads a complete preferences blob', () => {
    expect(
      normalizePreferences({
        pace: 'low',
        persona: 'action',
        mustHaves: ['praias', 'museus'],
        avoids: ['discotecas'],
      }),
    ).toEqual({
      pace: 'low',
      mustHaves: ['praias', 'museus'],
      avoids: ['discotecas'],
      // Derived from `persona` — nothing writes `categories` today.
      categories: [...PERSONA_CATEGORIES.action],
    });
  });

  it('maps the legacy dealBreakers key onto avoids', () => {
    expect(normalizePreferences({ pace: 'high', dealBreakers: ['casinos'] })).toEqual({
      pace: 'high',
      mustHaves: [],
      avoids: ['casinos'],
      categories: [],
    });
  });

  it('unions avoids and dealBreakers when both are present', () => {
    const result = normalizePreferences({ avoids: ['casinos'], dealBreakers: ['discotecas'] });
    expect(result.avoids).toEqual(['casinos', 'discotecas']);
  });

  it('dedupes case- and accent-insensitively, keeping the first spelling', () => {
    const result = normalizePreferences({ mustHaves: ['Museus', 'museus', 'MUSÉUS', 'praias'] });
    expect(result.mustHaves).toEqual(['Museus', 'praias']);
  });

  it('trims and drops empty strings', () => {
    expect(normalizePreferences({ mustHaves: ['  praias  ', '', '   '] }).mustHaves).toEqual(['praias']);
  });

  it('falls back to defaults for null and undefined', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it('falls back to medium for an invalid pace', () => {
    expect(normalizePreferences({ pace: 'turbo' }).pace).toBe('medium');
    expect(normalizePreferences({ pace: 42 }).pace).toBe('medium');
    expect(normalizePreferences({}).pace).toBe('medium');
  });

  it('ignores non-array and non-string list entries', () => {
    const result = normalizePreferences({ mustHaves: 'praias', avoids: ['ok', 7, null] });
    expect(result.mustHaves).toEqual([]);
    expect(result.avoids).toEqual(['ok']);
  });
});

describe('aggregateGroupPreferences', () => {
  it('unions must-haves and avoids across travellers', () => {
    const result = aggregateGroupPreferences([
      { preferences: { pace: 'medium', mustHaves: ['museus'], avoids: ['discotecas'] } },
      { preferences: { pace: 'medium', mustHaves: ['praias', 'Museus'], dealBreakers: ['casinos'] } },
    ]);
    expect(result.mustHaves).toEqual(['museus', 'praias']);
    expect(result.avoids).toEqual(['discotecas', 'casinos']);
  });

  it('takes the modal pace', () => {
    const result = aggregateGroupPreferences([
      { preferences: { pace: 'high' } },
      { preferences: { pace: 'high' } },
      { preferences: { pace: 'low' } },
    ]);
    expect(result.pace).toBe('high');
  });

  it('breaks a pace tie toward the slower option', () => {
    const result = aggregateGroupPreferences([
      { preferences: { pace: 'high' } },
      { preferences: { pace: 'low' } },
    ]);
    expect(result.pace).toBe('low');
  });

  it('returns defaults for an empty group', () => {
    expect(aggregateGroupPreferences([])).toEqual(DEFAULT_GROUP_PREFERENCES);
  });

  it('tolerates travellers with missing or null preferences', () => {
    expect(aggregateGroupPreferences([{ preferences: null }, {}])).toEqual(DEFAULT_GROUP_PREFERENCES);
  });

  it('never aggregates categories — they are the per-traveller axis', () => {
    const result = aggregateGroupPreferences([
      { preferences: { persona: 'culture' } },
      { preferences: { persona: 'gastronomy' } },
    ]);
    expect(result).not.toHaveProperty('categories');
  });
});

describe('isPersonaKey / categoriesForPersona / personaLabelFor', () => {
  it('accepts the four personas the UI offers', () => {
    for (const persona of ['culture', 'relaxation', 'action', 'gastronomy']) {
      expect(isPersonaKey(persona)).toBe(true);
      expect(categoriesForPersona(persona).length).toBeGreaterThan(0);
      expect(personaLabelFor(persona)).toBeTruthy();
    }
  });

  it('maps each persona onto its own vocabulary', () => {
    expect(categoriesForPersona('culture')).toEqual(['culture', 'museum', 'history']);
    expect(categoriesForPersona('gastronomy')).toEqual(['gastronomy', 'fine-dining', 'market']);
  });

  it('returns an empty list and a null label for a missing or unknown persona', () => {
    for (const bad of [undefined, null, '', 'wine', 42, {}, ['culture']]) {
      expect(isPersonaKey(bad)).toBe(false);
      expect(categoriesForPersona(bad)).toEqual([]);
      expect(personaLabelFor(bad)).toBeNull();
    }
  });

  it('returns a fresh array so callers cannot mutate the registry', () => {
    const first = categoriesForPersona('culture');
    first.push('nightlife');
    expect(categoriesForPersona('culture')).toEqual(['culture', 'museum', 'history']);
  });
});

describe('resolveCategories', () => {
  it('prefers an explicit list over the persona-derived one', () => {
    expect(resolveCategories({ persona: 'culture', categories: ['nightlife'] })).toEqual(['nightlife']);
  });

  it('derives from the persona when no explicit list is present', () => {
    expect(resolveCategories({ persona: 'action' })).toEqual(['hiking', 'adventure', 'outdoor']);
  });

  it('treats an explicit list that cleans to empty as absent', () => {
    expect(resolveCategories({ persona: 'culture', categories: ['', '   '] })).toEqual([
      'culture', 'museum', 'history',
    ]);
  });

  it('ignores a non-array categories value', () => {
    expect(resolveCategories({ persona: 'culture', categories: 'museums' })).toEqual([
      'culture', 'museum', 'history',
    ]);
    expect(resolveCategories({ categories: 7 })).toEqual([]);
  });

  it('dedupes an explicit list case- and accent-insensitively', () => {
    expect(resolveCategories({ categories: ['Museum', 'museum', 'praia'] })).toEqual(['Museum', 'praia']);
  });

  it('returns an empty list for a malformed blob', () => {
    expect(resolveCategories(null)).toEqual([]);
    expect(resolveCategories(undefined)).toEqual([]);
  });
});

describe('hasGroupPreferences', () => {
  it('is true when a valid pace or any term list is present', () => {
    expect(hasGroupPreferences({ pace: 'low' })).toBe(true);
    expect(hasGroupPreferences({ mustHaves: ['museus'] })).toBe(true);
    expect(hasGroupPreferences({ avoids: ['casinos'] })).toBe(true);
    expect(hasGroupPreferences({ dealBreakers: ['casinos'] })).toBe(true);
  });

  it('is false for an unwritten, empty or malformed blob', () => {
    expect(hasGroupPreferences({})).toBe(false);
    expect(hasGroupPreferences(null)).toBe(false);
    expect(hasGroupPreferences(undefined)).toBe(false);
    expect(hasGroupPreferences({ pace: 'turbo' })).toBe(false);
    expect(hasGroupPreferences({ mustHaves: [], avoids: [] })).toBe(false);
    expect(hasGroupPreferences({ mustHaves: 'museus' })).toBe(false);
  });
});

describe('resolveGroupPreferences', () => {
  const travellers = [
    { preferences: { pace: 'high', mustHaves: ['discotecas'], avoids: ['museus'] } },
    { preferences: { pace: 'high', mustHaves: ['bares'] } },
  ];

  it('takes the trip-level brief and ignores per-traveller copies', () => {
    expect(
      resolveGroupPreferences({ pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] }, travellers),
    ).toEqual({ pace: 'low', mustHaves: ['museus'], avoids: ['discotecas'] });
  });

  it('maps a trip-level dealBreakers key onto avoids', () => {
    expect(resolveGroupPreferences({ dealBreakers: ['casinos'] }, []).avoids).toEqual(['casinos']);
  });

  it('falls back to the travellers for a legacy trip', () => {
    const result = resolveGroupPreferences({}, travellers);
    expect(result.pace).toBe('high');
    expect(result.mustHaves).toEqual(['discotecas', 'bares']);
    expect(result.avoids).toEqual(['museus']);
  });

  it('falls back for a null or malformed trip blob', () => {
    expect(resolveGroupPreferences(null, travellers).pace).toBe('high');
    expect(resolveGroupPreferences({ pace: 'turbo' }, travellers).pace).toBe('high');
  });

  it('returns defaults when neither scope carries anything', () => {
    expect(resolveGroupPreferences(null, [])).toEqual(DEFAULT_GROUP_PREFERENCES);
    expect(resolveGroupPreferences({}, [{ preferences: {} }])).toEqual(DEFAULT_GROUP_PREFERENCES);
  });

  it('never leaks categories into the group brief', () => {
    const result = resolveGroupPreferences({ pace: 'low', mustHaves: ['museus'] }, travellers);
    expect(result).not.toHaveProperty('categories');
  });
});
