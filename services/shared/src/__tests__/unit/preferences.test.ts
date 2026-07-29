import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  aggregateGroupPreferences,
  foldTerm,
  matchesPreferenceTerm,
  normalizePreferences,
} from '../../services/preferences';

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
    ).toEqual({ pace: 'low', mustHaves: ['praias', 'museus'], avoids: ['discotecas'] });
  });

  it('maps the legacy dealBreakers key onto avoids', () => {
    expect(normalizePreferences({ pace: 'high', dealBreakers: ['casinos'] })).toEqual({
      pace: 'high',
      mustHaves: [],
      avoids: ['casinos'],
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
    expect(aggregateGroupPreferences([])).toEqual(DEFAULT_PREFERENCES);
  });

  it('tolerates travellers with missing or null preferences', () => {
    expect(aggregateGroupPreferences([{ preferences: null }, {}])).toEqual(DEFAULT_PREFERENCES);
  });
});
