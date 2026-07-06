import type { ProposalOutput } from '@/schemas/proposalOutput.schema';

interface WarnLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

type PriceRange = [min: number, max: number];

interface CountryRanges {
  activity: PriceRange;
  meal: PriceRange;
  accommodation: PriceRange;
}

const RANGES: Record<string, CountryRanges> = {
  PT: { activity: [0, 80],  meal: [5, 60],  accommodation: [15, 400] },
  ES: { activity: [0, 100], meal: [8, 80],  accommodation: [20, 500] },
  IE: { activity: [0, 120], meal: [10, 100], accommodation: [30, 600] },
  FR: { activity: [0, 120], meal: [10, 100], accommodation: [25, 600] },
  IT: { activity: [0, 120], meal: [8, 90],  accommodation: [25, 600] },
  DE: { activity: [0, 100], meal: [8, 80],  accommodation: [25, 550] },
  DEFAULT: { activity: [0, 150], meal: [5, 120], accommodation: [15, 700] },
};

function getRanges(country?: string): CountryRanges {
  if (!country) return RANGES['DEFAULT']!;
  const code = country.length === 2 ? country.toUpperCase() : country.slice(0, 2).toUpperCase();
  return RANGES[code] ?? RANGES['DEFAULT']!;
}

function inRange(value: number, [min, max]: PriceRange): boolean {
  return value >= min && value <= max;
}

export function auditPrices(proposal: ProposalOutput, logger: WarnLogger): string[] {
  const warnings: string[] = [];

  for (const hotel of proposal.accommodation) {
    const ranges = getRanges(hotel.country);
    if (!inRange(hotel.pricePerNightPerPerson, ranges.accommodation)) {
      const msg = `Accommodation price suspect: ${hotel.name} €${hotel.pricePerNightPerPerson}/night (expected €${ranges.accommodation[0]}–€${ranges.accommodation[1]})`;
      warnings.push(msg);
      logger.warn(msg, { hotel: hotel.name });
    }
  }

  for (const day of proposal.itinerary) {
    for (const act of day.activities) {
      const ranges = getRanges(day.country ?? act.country);
      const category: keyof CountryRanges = act.time === 'evening' ? 'meal' : 'activity';
      const range = ranges[category];
      if (!inRange(act.estimatedCostPerPerson, range)) {
        const msg = `Price suspect: "${act.activity}" €${act.estimatedCostPerPerson}/person (expected €${range[0]}–€${range[1]} for ${category} in ${day.country ?? 'unknown'})`;
        warnings.push(msg);
        logger.warn(msg, { activity: act.activity, day: day.day });
      }
    }
  }

  return warnings;
}
