import { BaseService } from '@itinera/shared';
import { config } from '@/config';

export interface HotelPriceResult {
  pricePerNightPerPerson: number;
  isEstimate: boolean;
  source: string;
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
  ): Promise<HotelPriceResult | null> {
    if (!config.SERPAPI_KEY || !checkInDate || !checkOutDate) return null;

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
