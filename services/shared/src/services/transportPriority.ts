import type { TransportMode, TransportOption } from '../types/entities';
import type { TransportPriorityResult } from '../types/workflow';
import type { LocalTransportMode, LocalTransportOption, LocalTransportPriorityResult } from '../types/localTransport';

const FEASIBILITY_WARNING_PATTERN = /estimate|approximate|no direct|not available/i;

/**
 * Evaluates which transport option to use for a leg, enforcing the user's preferred
 * mode when valid offers exist. Downgrade to fallback only when the preferred mode
 * fails minimum viability criteria. Decision is purely code-driven — no LLM.
 *
 * Downgrade conditions (any one triggers fallback):
 *   1. No offers for the preferred mode
 *   2. All preferred offers exceed the budget ceiling
 *   3. All preferred offers exceed the time limit
 *   4. All preferred offers are feasibility-only estimates (not real bookings)
 *   5. PreferredMode is 'best' → select the top-ranked option regardless
 */
export function evaluateTransportPriority(
  preferredMode: TransportMode,
  availableOptions: TransportOption[],
  budgetCeilingEurPerPerson: number,
  timeLimitMinutes: number,
): TransportPriorityResult {
  if (availableOptions.length === 0) {
    throw new Error('No transport options available to evaluate');
  }

  const topOption = availableOptions[0];

  if (preferredMode === 'best') {
    return {
      selectedMode: topOption.mode as TransportMode,
      selectedOption: topOption,
      wasPreferenceHonored: true,
    };
  }

  const preferred = availableOptions.filter((o) => o.mode === preferredMode);

  if (preferred.length === 0) {
    return {
      selectedMode: topOption.mode as TransportMode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `No ${preferredMode} offers found for this leg`,
    };
  }

  const withinBudget = preferred.filter(
    (o) => o.priceEur == null || o.priceEur <= budgetCeilingEurPerPerson,
  );
  if (withinBudget.length === 0) {
    const cheapest = Math.min(...preferred.map((o) => o.priceEur ?? Infinity));
    return {
      selectedMode: topOption.mode as TransportMode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers exceed budget ceiling (cheapest €${cheapest.toFixed(0)} > €${budgetCeilingEurPerPerson.toFixed(0)})`,
    };
  }

  const withinTime = withinBudget.filter((o) => o.durationMinutes <= timeLimitMinutes);
  if (withinTime.length === 0) {
    const fastest = Math.min(...withinBudget.map((o) => o.durationMinutes));
    return {
      selectedMode: topOption.mode as TransportMode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers within budget exceed time limit (fastest ${fastest}min > ${timeLimitMinutes}min)`,
    };
  }

  const realOffers = withinTime.filter(
    (o) => !o.warnings.some((w) => FEASIBILITY_WARNING_PATTERN.test(w)),
  );
  if (realOffers.length === 0) {
    return {
      selectedMode: topOption.mode as TransportMode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers within budget/time are feasibility estimates, not confirmed bookings`,
    };
  }

  const best = realOffers.sort((a, b) => (a.priceEur ?? 0) - (b.priceEur ?? 0))[0];
  return {
    selectedMode: preferredMode,
    selectedOption: best,
    wasPreferenceHonored: true,
  };
}

/**
 * Same preference-first, downgrade-with-reason algorithm as
 * `evaluateTransportPriority`, applied to local point-to-point transport
 * (drive/transit/walk) instead of inter-city legs. Kept as a separate
 * function rather than a generic one because `LocalTransportOption` has no
 * `mode: 'best'` concept of its own — callers resolve that via
 * `mapTransportModeToLocalPreference` first.
 */
export function evaluateLocalTransportPriority(
  preferredMode: LocalTransportMode | 'best',
  availableOptions: LocalTransportOption[],
  budgetCeilingEurPerPerson: number,
  timeLimitMinutes: number,
): LocalTransportPriorityResult {
  if (availableOptions.length === 0) {
    throw new Error('No local transport options available to evaluate');
  }

  const topOption = availableOptions[0];

  if (preferredMode === 'best') {
    return {
      selectedMode: topOption.mode,
      selectedOption: topOption,
      wasPreferenceHonored: true,
    };
  }

  const preferred = availableOptions.filter((o) => o.mode === preferredMode);

  if (preferred.length === 0) {
    return {
      selectedMode: topOption.mode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `No ${preferredMode} offers found for this trip`,
    };
  }

  const withinBudget = preferred.filter(
    (o) => o.priceEur == null || o.priceEur <= budgetCeilingEurPerPerson,
  );
  if (withinBudget.length === 0) {
    const cheapest = Math.min(...preferred.map((o) => o.priceEur ?? Infinity));
    return {
      selectedMode: topOption.mode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers exceed budget ceiling (cheapest €${cheapest.toFixed(0)} > €${budgetCeilingEurPerPerson.toFixed(0)})`,
    };
  }

  const withinTime = withinBudget.filter((o) => o.durationMinutes <= timeLimitMinutes);
  if (withinTime.length === 0) {
    const fastest = Math.min(...withinBudget.map((o) => o.durationMinutes));
    return {
      selectedMode: topOption.mode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers within budget exceed time limit (fastest ${fastest}min > ${timeLimitMinutes}min)`,
    };
  }

  const realOffers = withinTime.filter(
    (o) => !o.warnings.some((w) => FEASIBILITY_WARNING_PATTERN.test(w)),
  );
  if (realOffers.length === 0) {
    return {
      selectedMode: topOption.mode,
      selectedOption: topOption,
      wasPreferenceHonored: false,
      downgradeReason: `All ${preferredMode} offers within budget/time are feasibility estimates, not confirmed bookings`,
    };
  }

  const best = realOffers.sort((a, b) => (a.priceEur ?? 0) - (b.priceEur ?? 0))[0];
  return {
    selectedMode: preferredMode,
    selectedOption: best,
    wasPreferenceHonored: true,
  };
}

/**
 * Maps a user's inter-city transport preference onto the closest local-mode
 * analog. There is no local equivalent of a flight, so 'flight' maps to
 * 'best' (let feasibility/cost decide) rather than an arbitrary local mode.
 */
export function mapTransportModeToLocalPreference(preferred: TransportMode): LocalTransportMode | 'best' {
  switch (preferred) {
    case 'car':
      return 'drive';
    case 'train':
      return 'transit';
    case 'flight':
    case 'best':
    default:
      return 'best';
  }
}
