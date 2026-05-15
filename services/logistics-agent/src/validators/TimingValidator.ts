import { BaseService } from '@itinera/shared';

export interface ScheduledActivity {
  day: number;
  name: string;
  startTime: string;
  endTime: string;
  location: string;
}

export interface ScheduledTransport {
  day: number;
  from: string;
  to: string;
  startTime: string;
  durationMinutes: number;
}

export interface TimingConflict {
  day: number;
  activity1: string;
  activity2: string;
  conflictType: 'overlap' | 'insufficient_travel_time';
  severity: 'critical' | 'warning';
  description: string;
}

export interface TimingValidationResult {
  valid: boolean;
  conflicts: TimingConflict[];
  warnings: TimingConflict[];
}

function timeToMinutes(time: string): number {
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h * 60 + m;
}

export class TimingValidator extends BaseService {
  constructor() {
    super('timing-validator');
  }

  validate(
    activities: ScheduledActivity[],
    transport: ScheduledTransport[] = [],
  ): TimingValidationResult {
    const conflicts: TimingConflict[] = [];
    const warnings: TimingConflict[] = [];

    const days = new Set(activities.map((a) => a.day));

    for (const day of days) {
      const dayActivities = activities
        .filter((a) => a.day === day)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      const dayTransport = transport.filter((t) => t.day === day);

      this.detectOverlaps(day, dayActivities, conflicts);
      this.detectInsufficientTravelTime(day, dayActivities, dayTransport, warnings);
    }

    return {
      valid: conflicts.length === 0,
      conflicts,
      warnings,
    };
  }

  private detectOverlaps(
    day: number,
    activities: ScheduledActivity[],
    conflicts: TimingConflict[],
  ): void {
    for (let i = 0; i < activities.length; i++) {
      for (let j = i + 1; j < activities.length; j++) {
        const a = activities[i];
        const b = activities[j];
        if (!a || !b) continue;

        const aStart = timeToMinutes(a.startTime);
        const aEnd = timeToMinutes(a.endTime);
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);

        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push({
            day,
            activity1: a.name,
            activity2: b.name,
            conflictType: 'overlap',
            severity: 'critical',
            description: `"${a.name}" (${a.startTime}–${a.endTime}) overlaps with "${b.name}" (${b.startTime}–${b.endTime}) on day ${day}`,
          });
        }
      }
    }
  }

  private detectInsufficientTravelTime(
    day: number,
    activities: ScheduledActivity[],
    transport: ScheduledTransport[],
    warnings: TimingConflict[],
  ): void {
    for (let i = 0; i < activities.length - 1; i++) {
      const current = activities[i];
      const next = activities[i + 1];
      if (!current || !next) continue;

      const gap = timeToMinutes(next.startTime) - timeToMinutes(current.endTime);

      const leg = transport.find(
        (t) =>
          t.from.toLowerCase() === current.location.toLowerCase() &&
          t.to.toLowerCase() === next.location.toLowerCase(),
      );

      if (leg && gap < leg.durationMinutes) {
        warnings.push({
          day,
          activity1: current.name,
          activity2: next.name,
          conflictType: 'insufficient_travel_time',
          severity: 'warning',
          description: `Only ${gap} min gap between "${current.name}" and "${next.name}" but travel from ${current.location} to ${next.location} takes ${leg.durationMinutes} min on day ${day}`,
        });
      }
    }
  }
}
