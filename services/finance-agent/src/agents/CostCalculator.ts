export interface CostItem {
  name: string;
  cost: number;
  currency: string;
}

export interface TransportItem {
  from: string;
  to: string;
  cost: number;
  currency: string;
}

export interface ItineraryDay {
  day: number;
  activities: CostItem[];
  meals: CostItem[];
  transport: TransportItem[];
}

export interface CostBreakdown {
  byCategory: {
    activities: number;
    meals: number;
    transport: number;
  };
  grandTotal: number;
  currency: string;
  items: ItineraryDay[];
}

export class CostCalculator {
  calculate(itinerary: ItineraryDay[], currency: string): CostBreakdown {
    let activities = 0;
    let meals = 0;
    let transport = 0;

    for (const day of itinerary) {
      for (const item of day.activities) activities += item.cost;
      for (const item of day.meals) meals += item.cost;
      for (const item of day.transport) transport += item.cost;
    }

    const grandTotal = activities + meals + transport;

    return {
      byCategory: { activities, meals, transport },
      grandTotal,
      currency,
      items: itinerary,
    };
  }
}
