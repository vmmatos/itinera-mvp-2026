import { BaseService } from '@itinera/shared';
import type { SpecialEvent } from '@itinera/shared';
import { config } from '@/config';
import type { RedisService } from '@/services/RedisService';

interface TicketmasterImage {
  url: string;
  width: number;
}

interface TicketmasterEvent {
  id: string;
  name: string;
  url: string;
  dates: {
    start: {
      localDate: string;
      localTime?: string;
    };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
  }>;
  images?: TicketmasterImage[];
  _embedded?: {
    venues?: Array<{ name?: string }>;
  };
}

interface TicketmasterResponse {
  _embedded?: {
    events?: TicketmasterEvent[];
  };
}

function mapTicketmasterEvent(city: string, event: TicketmasterEvent): SpecialEvent | null {
  if (!event.id || !event.name || !event.dates?.start?.localDate) return null;

  const classification = event.classifications?.[0];
  const image = event.images?.find((img) => img.width >= 300) ?? event.images?.[0];

  return {
    id: event.id,
    name: event.name,
    url: event.url,
    startDate: event.dates.start.localDate,
    startTime: event.dates.start.localTime,
    city,
    venueName: event._embedded?.venues?.[0]?.name,
    category: classification?.segment?.name ?? 'Miscellaneous',
    genre: classification?.genre?.name,
    imageUrl: image?.url,
  };
}

const MOCK_EVENTS: Record<string, Array<Omit<SpecialEvent, 'city'>>> = {
  default: [
    {
      id: 'mock-music-1',
      name: 'Festival de Música da Cidade',
      url: 'https://example.com/mock-event/festival-musica',
      startDate: '',
      startTime: '20:00',
      venueName: 'Praça Central',
      category: 'Music',
      genre: 'Rock',
    },
    {
      id: 'mock-arts-1',
      name: 'Feira de Arte Contemporânea',
      url: 'https://example.com/mock-event/feira-arte',
      startDate: '',
      venueName: 'Centro Cultural',
      category: 'Arts & Theatre',
    },
  ],
};

export class SpecialEventsService extends BaseService {
  constructor(private readonly redis: RedisService) {
    super('special-events-service');
  }

  async getEvents(city: string, startDate: string, endDate: string): Promise<SpecialEvent[]> {
    const cacheKey = `events:${city}:${startDate}:${endDate}`;

    const cached = await this.redis.get<SpecialEvent[]>(cacheKey);
    if (cached) {
      this.logger.info('Special events cache hit', { city, startDate, endDate });
      return cached;
    }

    if (config.EVENTS_MOCK) {
      return this.mockEvents(city, startDate);
    }

    if (!config.TICKETMASTER_API_KEY) {
      this.logger.info('Ticketmaster API key not configured — skipping special events', { city });
      return [];
    }

    try {
      const url = new URL(`${config.TICKETMASTER_BASE_URL}/events.json`);
      url.searchParams.set('apikey', config.TICKETMASTER_API_KEY);
      url.searchParams.set('city', city);
      url.searchParams.set('startDateTime', `${startDate}T00:00:00Z`);
      url.searchParams.set('endDateTime', `${endDate}T23:59:59Z`);
      url.searchParams.set('size', String(config.EVENTS_MAX_PER_CITY));
      // No classificationName filter — every category (Music, Sports, Arts &
      // Theatre, Film, Misc) is surfaced; matchesMustHave badges the ones
      // relevant to what the group asked for instead of hiding the rest.

      const res = await fetch(url.toString());
      if (!res.ok) {
        this.logger.warn('Ticketmaster returned non-ok status — skipping events', {
          status: res.status,
          city,
        });
        return [];
      }

      const data = (await res.json()) as TicketmasterResponse;
      const events = (data._embedded?.events ?? [])
        .map((e) => mapTicketmasterEvent(city, e))
        .filter((e): e is SpecialEvent => e !== null);

      if (events.length > 0) {
        await this.redis.set(cacheKey, events, config.EVENTS_CACHE_TTL_SECONDS);
      }

      return events;
    } catch (err: unknown) {
      this.logger.warn('Failed to fetch special events — skipping', {
        city,
        error: String(err),
      });
      return [];
    }
  }

  private mockEvents(city: string, startDate: string): SpecialEvent[] {
    return MOCK_EVENTS.default.map((e) => ({ ...e, city, startDate }));
  }
}
