import { BaseService } from '@itinera/shared';
import type { ScheduledActivity } from '@/validators/TimingValidator';
import type { PublicHoliday } from '@/services/HolidayService';
import { LOCAL_RESTRICTIONS } from '@/config/localRestrictions';

export interface RestrictionWarning {
  day: number;
  activityName: string;
  warningType: 'public_holiday' | 'sunday_closure' | 'monday_closure' | 'opening_hours';
  message: string;
}

export interface RestrictionsValidationResult {
  warnings: RestrictionWarning[];
}

const DAY_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function parseOpenTime(timeStr: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeStr.trim());
  if (!match) return null;
  return parseInt(match[1] ?? '0', 10) * 60 + parseInt(match[2] ?? '0', 10);
}

function parseCloseTime(timeStr: string): number | null {
  const match = /(\d{1,2}):(\d{2})\s*$/.exec(timeStr.trim());
  if (!match) return null;
  return parseInt(match[1] ?? '0', 10) * 60 + parseInt(match[2] ?? '0', 10);
}

function isOutsideOpeningHours(activityStartTime: string, hoursStr: string): boolean {
  if (/closed/i.test(hoursStr)) return true;

  const activityMinutes = parseOpenTime(activityStartTime);
  if (activityMinutes === null) return false;

  // Handle "HH:MM – HH:MM" or "HH:MM-HH:MM" (may have multiple ranges separated by ", ")
  const ranges = hoursStr.split(/,\s*/);
  for (const range of ranges) {
    const openStr = range.split(/\s*[–\-]\s*/)[0];
    const closeStr = range.split(/\s*[–\-]\s*/)[1];
    if (!openStr || !closeStr) continue;

    const open = parseOpenTime(openStr);
    const close = parseCloseTime(closeStr);
    if (open !== null && close !== null && activityMinutes >= open && activityMinutes < close) {
      return false; // Within at least one valid range
    }
  }

  return true;
}

export class RestrictionsValidator extends BaseService {
  constructor() {
    super('restrictions-validator');
  }

  validate(params: {
    activities: ScheduledActivity[];
    tripDates: string[];
    countryCode: string | null;
    holidays: PublicHoliday[];
    openingHoursMap: Map<string, Record<string, string>>;
  }): RestrictionsValidationResult {
    const { activities, tripDates, countryCode, holidays, openingHoursMap } = params;
    const warnings: RestrictionWarning[] = [];

    const holidayDateSet = new Set(holidays.map((h) => h.date));
    const holidayByDate = new Map(holidays.map((h) => [h.date, h]));
    const countryRules = countryCode ? (LOCAL_RESTRICTIONS[countryCode] ?? []) : [];

    for (const activity of activities) {
      const tripDate = tripDates[activity.day - 1] ?? null;

      // 1. Public holiday check
      if (tripDate && holidayDateSet.has(tripDate)) {
        const holiday = holidayByDate.get(tripDate);
        warnings.push({
          day: activity.day,
          activityName: activity.name,
          warningType: 'public_holiday',
          message: `⚠ "${activity.name}" may be closed — ${tripDate} is ${holiday?.localName ?? holiday?.name ?? 'a public holiday'} in ${countryCode ?? 'this country'}. Verify opening hours and consider alternatives.`,
        });
      }

      // 2. Day-of-week closure rules (Sunday/Monday)
      if (tripDate && countryRules.length > 0) {
        const dow = DAY_OF_WEEK[new Date(tripDate).getUTCDay()];
        if (dow) {
          for (const rule of countryRules) {
            const expectedDow = rule.type === 'sunday_closure' ? 'Sunday' : 'Monday';
            if (dow !== expectedDow) continue;

            const nameLC = activity.name.toLowerCase();
            const matchesKeyword = rule.activityKeywords.some((kw) => nameLC.includes(kw));
            if (matchesKeyword) {
              warnings.push({
                day: activity.day,
                activityName: activity.name,
                warningType: rule.type,
                message: `⚠ "${activity.name}" — ${rule.message}`,
              });
            }
          }
        }
      }

      // 3. Opening hours check (fuzzy name match)
      const nameLC = activity.name.toLowerCase();
      let openingHours: Record<string, string> | undefined;
      for (const [placeName, hours] of openingHoursMap) {
        if (nameLC.includes(placeName) || placeName.includes(nameLC)) {
          openingHours = hours;
          break;
        }
      }

      if (openingHours) {
        const tripDate2 = tripDates[activity.day - 1] ?? null;
        const dow = tripDate2
          ? (DAY_OF_WEEK[new Date(tripDate2).getUTCDay()] ?? null)
          : null;

        const hoursStr = dow ? openingHours[dow] : null;

        if (hoursStr && isOutsideOpeningHours(activity.startTime, hoursStr)) {
          const closedMsg = /closed/i.test(hoursStr)
            ? `is listed as Closed`
            : `opens ${hoursStr} but activity is scheduled at ${activity.startTime}`;
          warnings.push({
            day: activity.day,
            activityName: activity.name,
            warningType: 'opening_hours',
            message: `⚠ "${activity.name}" ${closedMsg} on ${dow ?? 'that day'}. Check current hours before visiting.`,
          });
        }
      }
    }

    return { warnings };
  }
}
