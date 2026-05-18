export interface Constraint {
  budgetTotal?: number;
  travellerCount?: number;
  durationDays?: number;
}

export interface ConstraintViolation {
  type: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ConstraintCheckResult {
  passed: boolean;
  violations: ConstraintViolation[];
}

export class ConstraintChecker {
  check(proposal: Record<string, unknown>, constraints: Constraint): ConstraintCheckResult {
    const violations: ConstraintViolation[] = [];

    if (constraints.durationDays !== undefined) {
      const itinerary = proposal['itinerary'];
      if (Array.isArray(itinerary) && itinerary.length > constraints.durationDays) {
        violations.push({
          type: 'date_range',
          message: `Itinerary has ${itinerary.length} days but trip allows ${constraints.durationDays}`,
          severity: 'error',
        });
      }
    }

    if (constraints.budgetTotal !== undefined) {
      const finance = proposal['finance'] as Record<string, unknown> | undefined;
      const breakdown = finance?.['breakdown'] as Record<string, unknown> | undefined;
      const grandTotal = breakdown?.['grandTotal'];
      if (typeof grandTotal === 'number' && grandTotal > constraints.budgetTotal) {
        violations.push({
          type: 'budget',
          message: `Estimated cost ${grandTotal} exceeds budget ${constraints.budgetTotal}`,
          severity: 'error',
        });
      }
    }

    if (constraints.travellerCount !== undefined) {
      const count = proposal['travellerCount'];
      if (typeof count === 'number' && count !== constraints.travellerCount) {
        violations.push({
          type: 'traveller_count',
          message: `Proposal covers ${count} travellers but trip has ${constraints.travellerCount}`,
          severity: 'warning',
        });
      }
    }

    const hasError = violations.some((v) => v.severity === 'error');

    return { passed: !hasError, violations };
  }
}
