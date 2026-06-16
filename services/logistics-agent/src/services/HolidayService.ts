import { BaseService } from '@itinera/shared';
import { config } from '@/config';
import type { RedisService } from '@/services/RedisService';

export interface PublicHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  types: string[];
}

const BASE_URL = 'https://date.nager.at/api/v3';

export class HolidayService extends BaseService {
  constructor(private readonly redis: RedisService) {
    super('holiday-service');
  }

  async getHolidays(countryCode: string, year: number): Promise<PublicHoliday[]> {
    const cacheKey = `holidays:${countryCode}:${year}`;

    const cached = await this.redis.get<PublicHoliday[]>(cacheKey);
    if (cached) {
      this.logger.info('Holiday cache hit', { countryCode, year });
      return cached;
    }

    try {
      const url = `${BASE_URL}/PublicHolidays/${year}/${countryCode}`;
      const res = await fetch(url);

      if (!res.ok) {
        this.logger.warn('date.nager.at returned non-ok status — skipping holidays', {
          status: res.status,
          countryCode,
          year,
        });
        return [];
      }

      const data = (await res.json()) as NagerHoliday[];
      const holidays: PublicHoliday[] = data.map((h) => ({
        date: h.date,
        localName: h.localName,
        name: h.name,
        countryCode: h.countryCode,
      }));

      if (holidays.length > 0) {
        await this.redis.set(cacheKey, holidays, config.ATTRACTIONS_CACHE_TTL_SECONDS);
      }

      return holidays;
    } catch (err: unknown) {
      this.logger.warn('Failed to fetch public holidays — skipping', {
        countryCode,
        year,
        error: String(err),
      });
      return [];
    }
  }
}
