import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface HotelPriceResult {
  pricePerNightPerPerson: number;
  isEstimate: boolean;
  source: string;
  /**
   * True when the returned price is above the caller's budget ceiling — either
   * because the filtered (max_price) search found nothing and we fell back to
   * an unfiltered average, or because even the filtered average still exceeds
   * the ceiling. Never suppressed or clamped to a fake number — this just
   * tells the caller "this city is genuinely pricier than planned."
   */
  aboveCeiling?: boolean;
}

interface SerpHotelProperty {
  name?: string;
  rate_per_night?: { extracted_lowest?: number };
}

interface SerpHotelsResponse {
  properties?: SerpHotelProperty[];
  error?: string;
}

export class HotelPriceService extends BaseService {
  // SerpApi google_hotels returns a per-room nightly rate; assume double
  // occupancy to derive a per-person figure (matches the industry-standard
  // twin/double room assumption used for group travel budgeting).
  private static readonly OCCUPANCY_PER_ROOM = 2;

  constructor() {
    super('hotel-price-service');
  }

  async getNightlyPricePerPerson(
    city: string,
    checkInDate?: string,
    checkOutDate?: string,
    /**
     * Budget ceiling per person per night, when known (from the /plan
     * envelope). Without this, the query averages EVERY hotel SerpApi
     * returns for the city — including luxury properties — which is what
     * produced a EUR 333/night/person figure for Lucerne on a trip budgeted
     * at EUR 21/night/person. Passed through as `max_price` (converted to a
     * per-room figure) so the search itself skews toward what's affordable.
     */
    maxPricePerPersonHint?: number,
  ): Promise<HotelPriceResult | null> {
    if (!config.SERPAPI_KEY || !checkInDate || !checkOutDate) return null;

    const maxPricePerRoom = maxPricePerPersonHint
      ? Math.round(maxPricePerPersonHint * HotelPriceService.OCCUPANCY_PER_ROOM)
      : undefined;

    const filtered = maxPricePerRoom
      ? await this.search(city, checkInDate, checkOutDate, maxPricePerRoom)
      : null;
    if (filtered) {
      // Belt-and-suspenders: don't trust SerpApi's max_price filtering blindly.
      return filtered.pricePerNightPerPerson > maxPricePerPersonHint!
        ? { ...filtered, aboveCeiling: true }
        : filtered;
    }

    // No ceiling given, or the filtered search found nothing in that price
    // range (small/expensive-market cities can genuinely have zero budget
    // listings) — fall back to the unfiltered average, but say so honestly
    // rather than silently returning a number that looks as trustworthy as
    // a filtered one.
    const unfiltered = await this.search(city, checkInDate, checkOutDate);
    if (!unfiltered) return null;
    return maxPricePerRoom ? { ...unfiltered, aboveCeiling: true } : unfiltered;
  }

  private async search(
    city: string,
    checkInDate: string,
    checkOutDate: string,
    maxPricePerRoom?: number,
  ): Promise<HotelPriceResult | null> {
    const qs = new URLSearchParams({
      engine: 'google_hotels',
      q: city,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      currency: 'EUR',
      adults: String(HotelPriceService.OCCUPANCY_PER_ROOM),
      hl: 'en',
      api_key: config.SERPAPI_KEY,
    });
    if (maxPricePerRoom) qs.set('max_price', String(maxPricePerRoom));

    const res = await fetch(`${config.SERPAPI_BASE_URL}?${qs.toString()}`);
    if (!res.ok) {
      throw new Error(`SerpApi google_hotels error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as SerpHotelsResponse;
    if (data.error) {
      throw new Error(`SerpApi google_hotels returned: ${data.error}`);
    }

    const rates = (data.properties ?? [])
      .map((p) => p.rate_per_night?.extracted_lowest)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    if (rates.length === 0) return null;

    const avgNightlyTotal = rates.reduce((s, r) => s + r, 0) / rates.length;

    return {
      pricePerNightPerPerson: Math.round(avgNightlyTotal / HotelPriceService.OCCUPANCY_PER_ROOM),
      isEstimate: false,
      source: 'serpapi_google_hotels',
    };
  }
}
