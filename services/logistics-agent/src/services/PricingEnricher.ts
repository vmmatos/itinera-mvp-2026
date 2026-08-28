import type { HotelPriceService } from '@/services/HotelPriceService';
import type { Place, PlacesService } from '@/services/PlacesService';
import type { AttractionPriceRepository } from '@/services/AttractionPriceRepository';
import {
  DEFAULT_PICKS_PER_CITY,
  estimateMealPriceEur,
  pickTopRestaurants,
  type PriceDetail,
  type RestaurantPick,
} from '@/services/RestaurantPricing';

export interface PricingEnrichment {
  /** Nightly per-person price per city name. */
  accommodationByCity: Record<string, PriceDetail>;
  /** Single blended per-meal-per-person estimate — the PricingOverlay fallback. */
  restaurantPricePerMeal: PriceDetail;
  /** Ranked real restaurant picks per city name. `[]` when a city's search
   * returned nothing or failed — the overlay then uses restaurantPricePerMeal. */
  restaurantsByCity: Record<string, RestaurantPick[]>;
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
    /** Per-city accommodation budget ceiling (EUR/person/night), from the /plan envelope. */
    accommodationCeilingByCity?: Record<string, number>,
    /** How many restaurant picks to keep per city (rotation headroom across days). */
    picksLimit: number = DEFAULT_PICKS_PER_CITY,
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

    const [accommodationEntries, restaurantSearches, activityEntries] = await Promise.all([
      Promise.all(
        cities.map(async (city): Promise<[string, PriceDetail]> => {
          const price = await this.hotels
            .getNightlyPricePerPerson(city, checkInDate, checkOutDate, accommodationCeilingByCity?.[city])
            .catch(() => null);
          return [
            city,
            price
              ? {
                  amount: price.pricePerNightPerPerson,
                  isEstimate: price.isEstimate,
                  source: price.source,
                  ...(price.aboveCeiling ? { aboveCeiling: true } : {}),
                }
              : { amount: 0, isEstimate: true, source: 'heuristic_estimate' },
          ];
        }),
      ),
      Promise.all(
        cities.map(async (city): Promise<[string, Place[]]> => [
          city,
          await this.places.searchRestaurants(city).catch((): Place[] => []),
        ]),
      ),
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

    const restaurantsByCity = Object.fromEntries(
      restaurantSearches.map(([city, places]) => [city, pickTopRestaurants(places, picksLimit)]),
    );

    // Blend every city's results into the single fallback estimate. Only when
    // no city returned anything (or there were no cities) do we spend one more
    // call on a region-wide search.
    const allRestaurants = restaurantSearches.flatMap(([, places]) => places);
    const restaurantPricePerMeal: PriceDetail =
      allRestaurants.length > 0
        ? estimateMealPriceEur(allRestaurants)
        : await this.places
            .searchRestaurants(region)
            .then(estimateMealPriceEur)
            .catch((): PriceDetail => ({ amount: 25, isEstimate: true, source: 'heuristic_estimate' }));

    return {
      accommodationByCity: Object.fromEntries(accommodationEntries),
      restaurantPricePerMeal,
      restaurantsByCity,
      activityPriceByName: Object.fromEntries(activityEntries),
    };
  }
}
