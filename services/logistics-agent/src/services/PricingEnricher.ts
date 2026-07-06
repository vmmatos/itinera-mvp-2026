import type { HotelPriceService } from '@/services/HotelPriceService';
import type { PlacesService } from '@/services/PlacesService';
import type { AttractionPriceRepository } from '@/services/AttractionPriceRepository';
import { estimateMealPriceEur, type PriceDetail } from '@/services/RestaurantPricing';

export interface PricingEnrichment {
  /** Nightly per-person price per city name. */
  accommodationByCity: Record<string, PriceDetail>;
  /** Single blended per-meal-per-person estimate for the region. */
  restaurantPricePerMeal: PriceDetail;
  /** Entry price per attraction name (lowercased). */
  activityPriceByName: Record<string, PriceDetail>;
}

interface ItineraryDayLike {
  city?: string;
  activities?: Array<{ name?: string }>;
}

const HEURISTIC_ATTRACTION_PRICE = 10;

export class PricingEnricher {
  constructor(
    private readonly hotels: HotelPriceService,
    private readonly places: PlacesService,
    private readonly attractionPrices: AttractionPriceRepository,
  ) {}

  async enrich(
    region: string,
    itinerary: ItineraryDayLike[],
    checkInDate: string | undefined,
    checkOutDate: string | undefined,
  ): Promise<PricingEnrichment> {
    const cities = [...new Set(itinerary.map((d) => d.city).filter((c): c is string => Boolean(c)))];
    const activityNames = [
      ...new Set(
        itinerary
          .flatMap((d) => d.activities ?? [])
          .map((a) => a.name)
          .filter((n): n is string => Boolean(n)),
      ),
    ];

    const [accommodationEntries, restaurantPricePerMeal, activityEntries] = await Promise.all([
      Promise.all(
        cities.map(async (city): Promise<[string, PriceDetail]> => {
          const price = await this.hotels
            .getNightlyPricePerPerson(city, checkInDate, checkOutDate)
            .catch(() => null);
          return [
            city,
            price
              ? { amount: price.pricePerNightPerPerson, isEstimate: price.isEstimate, source: price.source }
              : { amount: 0, isEstimate: true, source: 'heuristic_estimate' },
          ];
        }),
      ),
      this.places
        .searchRestaurants(region)
        .then(estimateMealPriceEur)
        .catch((): PriceDetail => ({ amount: 25, isEstimate: true, source: 'heuristic_estimate' })),
      Promise.all(
        activityNames.map(async (name): Promise<[string, PriceDetail]> => {
          const price = await this.attractionPrices.findEntryPrice(name).catch(() => null);
          return [
            name.toLowerCase(),
            price
              ? { amount: price.entryPrice, isEstimate: price.isEstimate, source: price.source }
              : { amount: HEURISTIC_ATTRACTION_PRICE, isEstimate: true, source: 'heuristic_estimate' },
          ];
        }),
      ),
    ]);

    return {
      accommodationByCity: Object.fromEntries(accommodationEntries),
      restaurantPricePerMeal,
      activityPriceByName: Object.fromEntries(activityEntries),
    };
  }
}
