import { describe, it, expect } from 'vitest';

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

import { vi } from 'vitest';
import { RestrictionsValidator } from '@/validators/RestrictionsValidator';
import type { RestrictionWarning } from '@/validators/RestrictionsValidator';
import type { ScheduledActivity } from '@/validators/TimingValidator';
import type { PublicHoliday } from '@/services/HolidayService';

const validator = new RestrictionsValidator();

const act = (day: number, name: string, startTime = '10:00', location = 'City'): ScheduledActivity => ({
  day, name, startTime, endTime: '12:00', location,
});

const holiday = (date: string, name: string, localName = name): PublicHoliday => ({
  date, name, localName, countryCode: 'PT',
});

// 2026-06-10 is a Wednesday — Portugal Day
// 2026-06-07 is a Sunday
// 2026-06-08 is a Monday

describe('RestrictionsValidator', () => {
  describe('clean schedule', () => {
    it('returns no warnings for a clean schedule', () => {
      const result = validator.validate({
        activities: [act(1, 'Eiffel Tower Visit')],
        tripDates: ['2026-06-09'], // Tuesday
        countryCode: 'FR',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('public holiday detection', () => {
    it('warns when activity falls on a public holiday', () => {
      const result = validator.validate({
        activities: [act(1, 'Jerónimos Monastery')],
        tripDates: ['2026-06-10'],
        countryCode: 'PT',
        holidays: [holiday('2026-06-10', 'Portugal Day', 'Dia de Portugal')],
        openingHoursMap: new Map(),
      });

      expect(result.warnings).toHaveLength(1);
      const w = result.warnings[0] as RestrictionWarning;
      expect(w.warningType).toBe('public_holiday');
      expect(w.activityName).toBe('Jerónimos Monastery');
      expect(w.day).toBe(1);
      expect(w.message).toContain('Dia de Portugal');
    });

    it('does not warn when activity date is not a holiday', () => {
      const result = validator.validate({
        activities: [act(1, 'Jerónimos Monastery')],
        tripDates: ['2026-06-09'],
        countryCode: 'PT',
        holidays: [holiday('2026-06-10', 'Portugal Day')],
        openingHoursMap: new Map(),
      });

      expect(result.warnings).toHaveLength(0);
    });

    it('skips public holiday check when tripDates is empty', () => {
      const result = validator.validate({
        activities: [act(1, 'Jerónimos Monastery')],
        tripDates: [],
        countryCode: 'PT',
        holidays: [holiday('2026-06-10', 'Portugal Day')],
        openingHoursMap: new Map(),
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Sunday closure rules', () => {
    // 2026-06-07 is a Sunday
    it('warns for shop activity on Sunday in Germany', () => {
      const result = validator.validate({
        activities: [act(1, 'Lidl supermarket shopping')],
        tripDates: ['2026-06-07'],
        countryCode: 'DE',
        holidays: [],
        openingHoursMap: new Map(),
      });

      const warn = result.warnings.find((w) => w.warningType === 'sunday_closure');
      expect(warn).toBeDefined();
      expect(warn?.activityName).toBe('Lidl supermarket shopping');
      expect(warn?.message).toContain('Germany');
    });

    it('warns for supermarket on Sunday in Austria', () => {
      const result = validator.validate({
        activities: [act(1, 'SPAR supermarket')],
        tripDates: ['2026-06-07'],
        countryCode: 'AT',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.some((w) => w.warningType === 'sunday_closure')).toBe(true);
    });

    it('warns for shop on Sunday in Switzerland', () => {
      const result = validator.validate({
        activities: [act(1, 'Migros shopping')],
        tripDates: ['2026-06-07'],
        countryCode: 'CH',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.some((w) => w.warningType === 'sunday_closure')).toBe(true);
    });

    it('does not warn for non-matching activity on Sunday in Germany', () => {
      const result = validator.validate({
        activities: [act(1, 'Brandenburg Gate walk')],
        tripDates: ['2026-06-07'],
        countryCode: 'DE',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.filter((w) => w.warningType === 'sunday_closure')).toHaveLength(0);
    });

    it('does not warn for Sunday closure on a weekday', () => {
      // 2026-06-08 is Monday
      const result = validator.validate({
        activities: [act(1, 'REWE supermarket')],
        tripDates: ['2026-06-08'],
        countryCode: 'DE',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.filter((w) => w.warningType === 'sunday_closure')).toHaveLength(0);
    });
  });

  describe('Monday closure rules', () => {
    // 2026-06-08 is a Monday
    it('warns for museum visit on Monday in France', () => {
      const result = validator.validate({
        activities: [act(1, 'Musée d\'Orsay')],
        tripDates: ['2026-06-08'],
        countryCode: 'FR',
        holidays: [],
        openingHoursMap: new Map(),
      });

      const warn = result.warnings.find((w) => w.warningType === 'monday_closure');
      expect(warn).toBeDefined();
      expect(warn?.activityName).toBe('Musée d\'Orsay');
    });

    it('warns for restaurant on Monday in Spain', () => {
      const result = validator.validate({
        activities: [act(1, 'El Restaurante de la Abuela')],
        tripDates: ['2026-06-08'],
        countryCode: 'ES',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.some((w) => w.warningType === 'monday_closure')).toBe(true);
    });

    it('warns for museum on Monday in Portugal', () => {
      const result = validator.validate({
        activities: [act(1, 'Museu Nacional de Arte Antiga')],
        tripDates: ['2026-06-08'],
        countryCode: 'PT',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.some((w) => w.warningType === 'monday_closure')).toBe(true);
    });

    it('does not warn for Monday closure on a non-Monday', () => {
      // 2026-06-09 is Tuesday
      const result = validator.validate({
        activities: [act(1, 'Louvre museum visit')],
        tripDates: ['2026-06-09'],
        countryCode: 'FR',
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.filter((w) => w.warningType === 'monday_closure')).toHaveLength(0);
    });
  });

  describe('opening hours check', () => {
    it('warns when opening hours say Closed for that day', () => {
      const hoursMap = new Map([
        ['louvre museum', { Monday: 'Closed', Tuesday: '09:00 – 18:00' }],
      ]);

      const result = validator.validate({
        activities: [act(1, 'Louvre Museum', '10:00')],
        tripDates: ['2026-06-08'], // Monday
        countryCode: 'FR',
        holidays: [],
        openingHoursMap: hoursMap,
      });

      const warn = result.warnings.find((w) => w.warningType === 'opening_hours');
      expect(warn).toBeDefined();
      expect(warn?.message).toContain('Closed');
    });

    it('warns when activity starts outside opening range', () => {
      const hoursMap = new Map([
        ['national museum', { Tuesday: '09:00 – 17:00' }],
      ]);

      const result = validator.validate({
        activities: [act(1, 'National Museum', '18:30')],
        tripDates: ['2026-06-09'], // Tuesday
        countryCode: null,
        holidays: [],
        openingHoursMap: hoursMap,
      });

      const warn = result.warnings.find((w) => w.warningType === 'opening_hours');
      expect(warn).toBeDefined();
      expect(warn?.message).toContain('18:30');
    });

    it('does not warn when activity is within opening hours', () => {
      const hoursMap = new Map([
        ['national museum', { Tuesday: '09:00 – 18:00' }],
      ]);

      const result = validator.validate({
        activities: [act(1, 'National Museum', '11:00')],
        tripDates: ['2026-06-09'], // Tuesday
        countryCode: null,
        holidays: [],
        openingHoursMap: hoursMap,
      });

      expect(result.warnings.filter((w) => w.warningType === 'opening_hours')).toHaveLength(0);
    });

    it('does not warn when no opening hours match found', () => {
      const hoursMap = new Map([
        ['some other place', { Tuesday: 'Closed' }],
      ]);

      const result = validator.validate({
        activities: [act(1, 'Eiffel Tower', '10:00')],
        tripDates: ['2026-06-09'],
        countryCode: null,
        holidays: [],
        openingHoursMap: hoursMap,
      });

      expect(result.warnings).toHaveLength(0);
    });

    it('skips opening hours day check when tripDates is empty', () => {
      const hoursMap = new Map([
        ['louvre museum', { Monday: 'Closed' }],
      ]);

      const result = validator.validate({
        activities: [act(1, 'Louvre Museum', '10:00')],
        tripDates: [],
        countryCode: null,
        holidays: [],
        openingHoursMap: hoursMap,
      });

      // No tripDate means no day-of-week resolution → no opening hours warning
      expect(result.warnings.filter((w) => w.warningType === 'opening_hours')).toHaveLength(0);
    });
  });

  describe('null countryCode', () => {
    it('skips closure rules when countryCode is null', () => {
      const result = validator.validate({
        activities: [act(1, 'Lidl supermarket')],
        tripDates: ['2026-06-07'], // Sunday
        countryCode: null,
        holidays: [],
        openingHoursMap: new Map(),
      });

      expect(result.warnings.filter((w) => w.warningType === 'sunday_closure')).toHaveLength(0);
    });
  });

  describe('multiple activities on same day', () => {
    it('warns independently for each matching activity', () => {
      const result = validator.validate({
        activities: [
          act(1, 'Aldi shopping', '09:00'),
          act(1, 'Rewe supermarket', '11:00'),
          act(1, 'Brandenburg Gate walk', '14:00'),
        ],
        tripDates: ['2026-06-07'], // Sunday
        countryCode: 'DE',
        holidays: [],
        openingHoursMap: new Map(),
      });

      const closureWarns = result.warnings.filter((w) => w.warningType === 'sunday_closure');
      expect(closureWarns).toHaveLength(2);
      expect(closureWarns.map((w) => w.activityName)).toContain('Aldi shopping');
      expect(closureWarns.map((w) => w.activityName)).toContain('Rewe supermarket');
    });
  });
});
