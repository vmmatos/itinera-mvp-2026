import type { TransportMode, TransportOption } from '@itinera/shared';
import { config } from '@/config';

/**
 * Weighted transport ranking. Lower score = better.
 *
 *   base  = W_COST * priceEur + W_DURATION * hours + W_TRANSFERS * transfers
 *   score = base * (1 − W_PREFERENCE * preferenceAlignment)
 *
 * `preferenceAlignment` is the fraction of journey time spent in the user's
 * preferred mode, so hybrid routes earn partial credit: with a car preference,
 * "drive to Lisboa + fly" scores between a pure drive (1.0) and a bus+flight
 * combo (0.0). This is what lets the agent make an organic call — honour the
 * preference on near-ties, but let a much faster mixed route win.
 *
 * Options without a price are imputed the median price of their siblings
 * (neutral: neither punished with a phantom high price nor rewarded as free).
 */
export interface TransportWeights {
  cost: number;
  duration: number;
  preference: number;
  transfers: number;
}

export function defaultWeights(): TransportWeights {
  return {
    cost: config.TRANSPORT_WEIGHT_COST,
    duration: config.TRANSPORT_WEIGHT_DURATION,
    preference: config.TRANSPORT_WEIGHT_PREFERENCE,
    transfers: config.TRANSPORT_WEIGHT_TRANSFERS,
  };
}

/** Fraction [0..1] of journey minutes spent in the preferred mode. */
export function preferenceAlignment(option: TransportOption, preference: TransportMode): number {
  if (!option.segments || option.segments.length === 0) {
    return option.mode === preference ? 1 : 0;
  }
  const total = option.segments.reduce((s, seg) => s + seg.durationMinutes, 0);
  if (total <= 0) return option.mode === preference ? 1 : 0;
  const aligned = option.segments
    .filter((seg) => seg.mode === preference)
    .reduce((s, seg) => s + seg.durationMinutes, 0);
  return aligned / total;
}

function transfersOf(option: TransportOption): number {
  return option.segments ? Math.max(0, option.segments.length - 1) : 0;
}

function medianPrice(options: TransportOption[]): number | undefined {
  const prices = options
    .map((o) => o.priceEur)
    .filter((p): p is number => p !== undefined)
    .sort((a, b) => a - b);
  if (prices.length === 0) return undefined;
  return prices[Math.floor(prices.length / 2)];
}

export function scoreTransportOption(
  option: TransportOption,
  preference: TransportMode | undefined,
  weights: TransportWeights,
  imputedPriceEur: number | undefined,
): number {
  const price = option.priceEur ?? imputedPriceEur ?? 0;
  const base =
    weights.cost * price +
    weights.duration * (option.durationMinutes / 60) +
    weights.transfers * transfersOf(option);
  if (!preference || preference === 'best') return base;
  return base * (1 - weights.preference * preferenceAlignment(option, preference));
}

/**
 * Rank options by weighted score (best first). When the winner overrides the
 * user's preferred mode and the preferred mode is significantly slower (≥1.5×),
 * a visible explanation is prepended to the winner's warnings.
 */
export function rankTransportOptions(
  options: TransportOption[],
  preference?: TransportMode,
  weights: TransportWeights = defaultWeights(),
): TransportOption[] {
  const imputed = medianPrice(options);
  const sorted = [...options].sort(
    (a, b) =>
      scoreTransportOption(a, preference, weights, imputed) -
      scoreTransportOption(b, preference, weights, imputed),
  );

  const winner = sorted[0];
  if (preference && preference !== 'best' && winner && winner.mode !== preference) {
    const preferred = sorted.find((o) => o.mode === preference && !o.segments);
    if (preferred && preferred.durationMinutes >= winner.durationMinutes * 1.5) {
      const prefH = Math.round(preferred.durationMinutes / 60);
      const bestH = Math.round(winner.durationMinutes / 60);
      sorted[0] = {
        ...winner,
        warnings: [
          `${preference} preference overridden — ${preference} takes ~${prefH}h here vs ~${bestH}h for this option`,
          ...winner.warnings,
        ],
      };
    }
  }

  return sorted;
}
