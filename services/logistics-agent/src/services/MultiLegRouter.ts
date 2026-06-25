import type { TransportOption, TransportSegment } from '@itinera/shared';
import { getHubs } from '@/services/HubLookup';
import type { AccessMode } from '@/services/HubLookup';
import type { CityPair } from '@/services/TransportService';

type FetchFn = (pair: CityPair) => Promise<TransportOption[]>;

function accessModeToSegmentMode(m: AccessMode): TransportSegment['mode'] {
  if (m === 'bus') return 'bus';
  if (m === 'train') return 'train';
  return 'car';
}

function buildDisplaySummary(segments: TransportSegment[], totalMinutes: number, totalCostEur: number): string {
  const modes = segments.map((s) => {
    if (s.mode === 'flight') return 'Flight';
    if (s.mode === 'train') return 'Train';
    if (s.mode === 'bus') return 'Bus';
    return 'Car';
  });
  const uniqueModes = [...new Set(modes)];
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const timeStr = m > 0 ? `${h}h${m}m` : `${h}h`;
  return `${uniqueModes.join(' + ')} — ${timeStr} total, ~€${Math.round(totalCostEur)}/person`;
}

/**
 * Resolve multi-leg transport options for a city pair where the origin (or destination)
 * is a remote/rural city without a major airport or main-line rail station.
 *
 * Strategy: origin → hub (static data) + hub → destination (live API via fetchBest).
 *
 * Returns an array of composite TransportOptions (one per viable hub + hub→dest combo),
 * or empty if no hubs are found for this origin.
 */
export async function resolveMultiLegOptions(
  pair: CityPair,
  fetchBest: FetchFn,
): Promise<TransportOption[]> {
  const hubs = getHubs(pair.from);
  if (hubs.length === 0) return [];

  const results: TransportOption[] = [];

  await Promise.allSettled(
    hubs.map(async (hub) => {
      let hubToDestOptions: TransportOption[];
      try {
        hubToDestOptions = await fetchBest({ from: hub.hubCity, to: pair.to, departureDateIso: pair.departureDateIso });
      } catch {
        return; // hub → dest route unavailable
      }

      for (const onwards of hubToDestOptions.slice(0, 3)) {
        const totalMinutes = hub.accessMinutes + onwards.durationMinutes;
        const accessCostEur = hub.accessCostEur;
        const onwardsCostEur = onwards.priceEur ?? 0;
        const totalCostEur = accessCostEur + onwardsCostEur;

        const accessSegment: TransportSegment = {
          from: pair.from,
          to: hub.hubCity,
          mode: accessModeToSegmentMode(hub.accessMode),
          durationMinutes: hub.accessMinutes,
          priceEur: accessCostEur,
        };

        const hubSegment: TransportSegment = {
          from: hub.hubCity,
          to: pair.to,
          mode: onwards.mode === 'bus' ? 'bus' : onwards.mode,
          provider: onwards.provider,
          durationMinutes: onwards.durationMinutes,
          priceEur: onwards.priceEur,
          departureTime: onwards.departureTime,
          flightNumber: onwards.flightNumber,
          trainLine: onwards.trainLine,
        };

        const segments = [accessSegment, hubSegment];
        const composed: TransportOption = {
          mode: onwards.mode,
          provider: onwards.provider,
          durationMinutes: totalMinutes,
          departureTime: onwards.departureTime,
          arrivalTime: onwards.arrivalTime,
          priceEur: totalCostEur,
          flightNumber: onwards.flightNumber,
          trainLine: onwards.trainLine,
          warnings: [
            ...(totalMinutes > 240 ? ['Travel exceeds 4h — consider reducing activities on travel day'] : []),
            ...onwards.warnings.filter((w) => !w.includes('Travel exceeds 4h')),
          ],
          segments,
          displaySummary: buildDisplaySummary(segments, totalMinutes, totalCostEur),
        };

        results.push(composed);
      }
    }),
  );

  return results;
}
