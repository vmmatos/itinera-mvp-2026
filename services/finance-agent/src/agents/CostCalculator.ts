export interface CostItem {
  name?: string;
  // The orchestrator emits per-person costs; older fixtures use a flat `cost`.
  cost?: number;
  estimatedCostPerPerson?: number;
  currency?: string;
  /** true when this item's price is a heuristic guess, not a real quote (issue #73). */
  isEstimate?: boolean;
  /** e.g. 'google_places_price_level' | 'attraction_db' | 'heuristic_estimate' */
  source?: string;
}

export interface TransportItem {
  from?: string;
  to?: string;
  cost?: number;
  priceEur?: number;
  currency?: string;
  isEstimate?: boolean;
  source?: string;
}

export interface AccommodationItem {
  city?: string;
  pricePerNightPerPerson?: number;
  nights?: number;
  isEstimate?: boolean;
  source?: string;
}

export interface ItineraryDay {
  day: number;
  activities: CostItem[];
  meals: CostItem[];
  transport: TransportItem[];
}

export interface CostBreakdown {
  byCategory: {
    accommodation: number;
    activities: number;
    meals: number;
    transport: number;
  };
  /** Total cost for one traveller across the whole trip. */
  perPersonTotal: number;
  /** Total cost for the whole group (perPersonTotal × groupSize) — compared to the budget. */
  grandTotal: number;
  groupSize: number;
  currency: string;
  items: ItineraryDay[];
}

function perPersonCost(item: CostItem): number {
  return item.estimatedCostPerPerson ?? item.cost ?? 0;
}

function perPersonTransport(item: TransportItem): number {
  return item.priceEur ?? item.cost ?? 0;
}

export class CostCalculator {
  calculate(
    itinerary: ItineraryDay[],
    currency: string,
    accommodation: AccommodationItem[] = [],
    groupSize = 1,
  ): CostBreakdown {
    const size = Math.max(1, groupSize);

    let activities = 0;
    let meals = 0;
    let transport = 0;

    for (const day of itinerary) {
      for (const item of day.activities) activities += perPersonCost(item);
      for (const item of day.meals) meals += perPersonCost(item);
      for (const item of day.transport) transport += perPersonTransport(item);
    }

    const accommodationPerPerson = accommodation.reduce(
      (sum, a) => sum + (a.pricePerNightPerPerson ?? 0) * (a.nights ?? 0),
      0,
    );

    // All categories above are per-person; the budget is the group total.
    const perPersonTotal = accommodationPerPerson + activities + meals + transport;

    return {
      byCategory: {
        accommodation: accommodationPerPerson * size,
        activities: activities * size,
        meals: meals * size,
        transport: transport * size,
      },
      perPersonTotal,
      grandTotal: perPersonTotal * size,
      groupSize: size,
      currency,
      items: itinerary,
    };
  }
}
