import { BaseService } from '@itinera/shared';
import type { PlacesService, Place } from '@/services/PlacesService';
import type { RedisService } from '@/services/RedisService';

export class AttractionDB extends BaseService {
  constructor(
    private readonly places: PlacesService,
    private readonly redis: RedisService,
    private readonly ttlSeconds: number,
  ) {
    super('attraction-db');
  }

  async getAttractions(region: string, category?: string): Promise<Place[]> {
    const cacheKey = `attractions:${region}:${category ?? 'all'}`;
    const cached = await this.redis.get<Place[]>(cacheKey);

    if (cached) {
      this.logger.debug('Attractions cache hit', { region, category });
      return cached;
    }

    const attractions = await this.places.searchAttractions(region, category);
    await this.redis.set(cacheKey, attractions, this.ttlSeconds);

    this.logger.debug('Attractions cached', { region, category, count: attractions.length });
    return attractions;
  }

  async getOpeningHours(region: string, placeId: string): Promise<Record<string, string>> {
    const cacheKey = `opening_hours:${placeId}`;
    const cached = await this.redis.get<Record<string, string>>(cacheKey);

    if (cached) {
      this.logger.debug('Opening hours cache hit', { placeId });
      return cached;
    }

    const attractions = await this.getAttractions(region);
    const place = attractions.find((p) => p.id === placeId);
    const hours = place?.openingHours ?? {};

    await this.redis.set(cacheKey, hours, this.ttlSeconds);
    return hours;
  }
}
