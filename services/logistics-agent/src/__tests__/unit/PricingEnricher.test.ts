import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingEnricher } from '@/services/PricingEnricher';
import type { HotelPriceService } from '@/services/HotelPriceService';
import type { Place, PlacesService } from '@/services/PlacesService';
import type { AttractionPriceRepository } from '@/services/AttractionPriceRepository';

function restaurant(name: string, priceLevel: number | null, rating: number | null = null): Place {
  return {
    id: name, name, location: { lat: 0, lng: 0 },
    category: 'restaurant', rating, priceLevel, openingHours: {}, metadata: {},
  };
}

describe('PricingEnricher', () => {
  let hotels: HotelPriceService;
  let places: PlacesService;
  let attractionPrices: AttractionPriceRepository;
  let enricher: PricingEnricher;

  beforeEach(() => {
    hotels = { getNightlyPricePerPerson: vi.fn() } as unknown as HotelPriceService;
    places = { searchRestaurants: vi.fn() } as unknown as PlacesService;
    attractionPrices = { findEntryPrice: vi.fn() } as unknown as AttractionPriceRepository;
    enricher = new PricingEnricher(hotels, places, attractionPrices);
  });

  it('returns real prices for cities/activities that resolve successfully', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue({
      pricePerNightPerPerson: 60, isEstimate: false, source: 'serpapi_google_hotels',
    });
    vi.mocked(places.searchRestaurants).mockResolvedValue([
      { id: '1', name: 'R', location: { lat: 0, lng: 0 }, category: 'restaurant', rating: null, priceLevel: 2, openingHours: {}, metadata: {} },
    ]);
    vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue({
      entryPrice: 14, isEstimate: false, source: 'attraction_db',
    });

    const result = await enricher.enrich(
      'Lisbon',
      [{ city: 'Lisbon', activities: [{ name: 'Pena Palace' }] }],
      '2026-07-10',
      '2026-07-12',
    );

    expect(result.accommodationByCity['Lisbon']).toEqual({ amount: 60, isEstimate: false, source: 'serpapi_google_hotels' });
    expect(result.restaurantPricePerMeal).toEqual({ amount: 25, isEstimate: false, source: 'google_places_price_level' });
    expect(result.activityPriceByName['pena palace']).toEqual({ amount: 14, isEstimate: false, source: 'attraction_db' });
  });

  it('falls back to a heuristic estimate when the hotel price cannot be resolved', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue(null);
    vi.mocked(places.searchRestaurants).mockResolvedValue([]);
    vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue(null);

    const result = await enricher.enrich('Lisbon', [{ city: 'Lisbon' }], undefined, undefined);

    expect(result.accommodationByCity['Lisbon']).toEqual({ amount: 0, isEstimate: true, source: 'heuristic_estimate' });
  });

  it('falls back to a heuristic estimate when the hotel lookup throws', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockRejectedValue(new Error('SerpApi down'));
    vi.mocked(places.searchRestaurants).mockRejectedValue(new Error('Places down'));
    vi.mocked(attractionPrices.findEntryPrice).mockRejectedValue(new Error('DB down'));

    const result = await enricher.enrich(
      'Lisbon',
      [{ city: 'Lisbon', activities: [{ name: 'Mystery Museum' }] }],
      '2026-07-10',
      '2026-07-12',
    );

    expect(result.accommodationByCity['Lisbon']).toEqual({ amount: 0, isEstimate: true, source: 'heuristic_estimate' });
    expect(result.restaurantPricePerMeal).toEqual({ amount: 25, isEstimate: true, source: 'heuristic_estimate' });
    expect(result.activityPriceByName['mystery museum']).toEqual({ amount: 10, isEstimate: true, source: 'heuristic_estimate' });
  });

  it('passes the per-city accommodation ceiling through to the hotel lookup', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue({
      pricePerNightPerPerson: 20, isEstimate: false, source: 'serpapi_google_hotels',
    });
    vi.mocked(places.searchRestaurants).mockResolvedValue([]);
    vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue(null);

    await enricher.enrich(
      'Switzerland',
      [{ city: 'Lucerne' }],
      '2026-07-10',
      '2026-07-17',
      { Lucerne: 21 },
    );

    expect(hotels.getNightlyPricePerPerson).toHaveBeenCalledWith('Lucerne', '2026-07-10', '2026-07-17', 21);
  });

  it('propagates aboveCeiling from the hotel lookup onto the price detail', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue({
      pricePerNightPerPerson: 333, isEstimate: false, source: 'serpapi_google_hotels', aboveCeiling: true,
    });
    vi.mocked(places.searchRestaurants).mockResolvedValue([]);
    vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue(null);

    const result = await enricher.enrich('Switzerland', [{ city: 'Lucerne' }], '2026-07-10', '2026-07-17', { Lucerne: 21 });

    expect(result.accommodationByCity['Lucerne']).toEqual({
      amount: 333, isEstimate: false, source: 'serpapi_google_hotels', aboveCeiling: true,
    });
  });

  it('deduplicates repeated cities and activity names', async () => {
    vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue({
      pricePerNightPerPerson: 60, isEstimate: false, source: 'serpapi_google_hotels',
    });
    vi.mocked(places.searchRestaurants).mockResolvedValue([]);
    vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue(null);

    await enricher.enrich(
      'Lisbon',
      [
        { city: 'Lisbon', activities: [{ name: 'Tower' }] },
        { city: 'Lisbon', activities: [{ name: 'Tower' }] },
      ],
      '2026-07-10',
      '2026-07-12',
    );

    expect(hotels.getNightlyPricePerPerson).toHaveBeenCalledTimes(1);
    expect(attractionPrices.findEntryPrice).toHaveBeenCalledTimes(1);
  });

  describe('restaurantsByCity', () => {
    beforeEach(() => {
      vi.mocked(hotels.getNightlyPricePerPerson).mockResolvedValue({
        pricePerNightPerPerson: 60, isEstimate: false, source: 'serpapi_google_hotels',
      });
      vi.mocked(attractionPrices.findEntryPrice).mockResolvedValue(null);
    });

    it('ranks and caps real restaurant picks per city and blends the fallback across all cities', async () => {
      vi.mocked(places.searchRestaurants).mockImplementation(async (query: string) => {
        if (query === 'Lisbon') return [restaurant('Ramiro', 2, 4.7), restaurant('Prado', 3, 4.3)];
        if (query === 'Porto') return [restaurant('Cantina', 1, 4.5)];
        return [];
      });

      const result = await enricher.enrich(
        'Portugal',
        [{ city: 'Lisbon' }, { city: 'Porto' }],
        undefined,
        undefined,
      );

      expect(result.restaurantsByCity['Lisbon'].map((p) => p.name)).toEqual(['Ramiro', 'Prado']);
      expect(result.restaurantsByCity['Porto'].map((p) => p.name)).toEqual(['Cantina']);
      // blend of levels 2, 3, 1 -> avg 2 -> €25, real
      expect(result.restaurantPricePerMeal).toEqual({ amount: 25, isEstimate: false, source: 'google_places_price_level' });
    });

    it('leaves a city empty when its search fails, without affecting the others', async () => {
      vi.mocked(places.searchRestaurants).mockImplementation(async (query: string) => {
        if (query === 'Lisbon') return [restaurant('Ramiro', 2, 4.7)];
        throw new Error('Places down for Porto');
      });

      const result = await enricher.enrich(
        'Portugal',
        [{ city: 'Lisbon' }, { city: 'Porto' }],
        undefined,
        undefined,
      );

      expect(result.restaurantsByCity['Lisbon']).toHaveLength(1);
      expect(result.restaurantsByCity['Porto']).toEqual([]);
    });

    it('only spends a region-wide search when every city returned nothing', async () => {
      vi.mocked(places.searchRestaurants).mockImplementation(async (query: string) => {
        if (query === 'Portugal') return [restaurant('Region Spot', 3)];
        return [];
      });

      const result = await enricher.enrich(
        'Portugal',
        [{ city: 'Lisbon' }, { city: 'Porto' }],
        undefined,
        undefined,
      );

      expect(places.searchRestaurants).toHaveBeenCalledWith('Portugal');
      expect(result.restaurantsByCity).toEqual({ Lisbon: [], Porto: [] });
      expect(result.restaurantPricePerMeal.amount).toBe(45); // level 3
    });

    it('uses only the region-wide search when the itinerary has no cities', async () => {
      vi.mocked(places.searchRestaurants).mockResolvedValue([restaurant('Region Spot', 2)]);

      const result = await enricher.enrich('Portugal', [{ activities: [{ name: 'Walk' }] }], undefined, undefined);

      expect(result.restaurantsByCity).toEqual({});
      expect(places.searchRestaurants).toHaveBeenCalledTimes(1);
      expect(places.searchRestaurants).toHaveBeenCalledWith('Portugal');
    });

    it('searches each distinct city only once', async () => {
      vi.mocked(places.searchRestaurants).mockResolvedValue([restaurant('Ramiro', 2, 4.7)]);

      await enricher.enrich(
        'Portugal',
        [{ city: 'Lisbon' }, { city: 'Lisbon' }],
        undefined,
        undefined,
      );

      expect(places.searchRestaurants).toHaveBeenCalledTimes(1);
      expect(places.searchRestaurants).toHaveBeenCalledWith('Lisbon');
    });
  });
});
