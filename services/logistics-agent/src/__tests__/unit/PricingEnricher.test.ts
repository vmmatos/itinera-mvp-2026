import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingEnricher } from '@/services/PricingEnricher';
import type { HotelPriceService } from '@/services/HotelPriceService';
import type { PlacesService } from '@/services/PlacesService';
import type { AttractionPriceRepository } from '@/services/AttractionPriceRepository';

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
});
