import { describe, it, expect } from 'vitest';

import { TimingValidator } from '@/validators/TimingValidator';
import type { ScheduledActivity, ScheduledTransport } from '@/validators/TimingValidator';

const validator = new TimingValidator();

const act = (
  day: number,
  name: string,
  startTime: string,
  endTime: string,
  location = 'Hotel',
): ScheduledActivity => ({ day, name, startTime, endTime, location });

const leg = (
  day: number,
  from: string,
  to: string,
  startTime: string,
  durationMinutes: number,
): ScheduledTransport => ({ day, from, to, startTime, durationMinutes });

describe('TimingValidator', () => {
  describe('no conflicts', () => {
    it('returns valid when schedule is clean', () => {
      const result = validator.validate([
        act(1, 'Breakfast', '08:00', '09:00', 'Hotel'),
        act(1, 'Museum', '10:00', '12:00', 'Museum'),
        act(1, 'Lunch', '12:30', '13:30', 'Restaurant'),
      ]);

      expect(result.valid).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns valid for activities on different days', () => {
      const result = validator.validate([
        act(1, 'Morning hike', '08:00', '12:00', 'Park'),
        act(2, 'Morning hike', '08:00', '12:00', 'Park'),
      ]);

      expect(result.valid).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns valid when activities are back-to-back with no gap', () => {
      const result = validator.validate([
        act(1, 'Tour', '09:00', '11:00', 'Centre'),
        act(1, 'Lunch', '11:00', '12:00', 'Centre'),
      ]);

      expect(result.valid).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('overlap detection', () => {
    it('detects critical conflict when activities fully overlap', () => {
      const result = validator.validate([
        act(1, 'Museum', '10:00', '13:00', 'Museum'),
        act(1, 'Beach', '11:00', '14:00', 'Beach'),
      ]);

      expect(result.valid).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.conflictType).toBe('overlap');
      expect(result.conflicts[0]?.severity).toBe('critical');
      expect(result.conflicts[0]?.activity1).toBe('Museum');
      expect(result.conflicts[0]?.activity2).toBe('Beach');
      expect(result.conflicts[0]?.day).toBe(1);
    });

    it('detects conflict when one activity starts inside another', () => {
      const result = validator.validate([
        act(1, 'Tour', '09:00', '12:00', 'Centre'),
        act(1, 'Lunch', '11:30', '13:00', 'Restaurant'),
      ]);

      expect(result.valid).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.conflictType).toBe('overlap');
    });

    it('detects multiple conflicts on same day', () => {
      const result = validator.validate([
        act(1, 'A', '10:00', '13:00', 'Loc1'),
        act(1, 'B', '11:00', '14:00', 'Loc2'),
        act(1, 'C', '12:00', '15:00', 'Loc3'),
      ]);

      expect(result.valid).toBe(false);
      expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    });

    it('description contains activity names and times', () => {
      const result = validator.validate([
        act(1, 'Museum', '10:00', '13:00', 'Museum'),
        act(1, 'Beach', '11:00', '14:00', 'Beach'),
      ]);

      expect(result.conflicts[0]?.description).toContain('Museum');
      expect(result.conflicts[0]?.description).toContain('Beach');
    });
  });

  describe('insufficient travel time', () => {
    it('warns when gap is less than transport duration', () => {
      const result = validator.validate(
        [
          act(1, 'Hotel Breakfast', '08:00', '09:00', 'Hotel'),
          act(1, 'Museum Visit', '09:10', '12:00', 'Museum'),
        ],
        [leg(1, 'Hotel', 'Museum', '09:00', 30)],
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.conflictType).toBe('insufficient_travel_time');
      expect(result.warnings[0]?.severity).toBe('warning');
      expect(result.warnings[0]?.activity1).toBe('Hotel Breakfast');
      expect(result.warnings[0]?.activity2).toBe('Museum Visit');
    });

    it('no warning when gap equals transport duration exactly', () => {
      const result = validator.validate(
        [
          act(1, 'Hotel Breakfast', '08:00', '09:00', 'Hotel'),
          act(1, 'Museum Visit', '09:30', '12:00', 'Museum'),
        ],
        [leg(1, 'Hotel', 'Museum', '09:00', 30)],
      );

      expect(result.warnings).toHaveLength(0);
    });

    it('no warning when transport leg is not defined between locations', () => {
      const result = validator.validate(
        [
          act(1, 'Breakfast', '08:00', '09:00', 'Hotel'),
          act(1, 'Museum', '09:10', '12:00', 'Museum'),
        ],
        [],
      );

      expect(result.warnings).toHaveLength(0);
    });

    it('warning description contains duration and location info', () => {
      const result = validator.validate(
        [
          act(1, 'Breakfast', '08:00', '09:00', 'Hotel'),
          act(1, 'Museum', '09:10', '12:00', 'Museum'),
        ],
        [leg(1, 'Hotel', 'Museum', '09:00', 30)],
      );

      expect(result.warnings[0]?.description).toContain('Hotel');
      expect(result.warnings[0]?.description).toContain('Museum');
      expect(result.warnings[0]?.description).toContain('30');
    });
  });
});
