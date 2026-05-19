import { createLogger, NotFoundError } from '@itinera/shared'
import type { RedisService } from '@/services/RedisService'
import type {
  ShareRecord,
  ItineraryData,
  GenerateShareResponse,
  GetShareResponse,
} from '@/types/sharing'
import { config } from '@/config'

export class ShareLinkGenerator {
  private readonly logger = createLogger('share-link-generator')

  constructor(private readonly redis: RedisService) {}

  async generate(
    tripId: string,
    itinerary: ItineraryData,
    createdBy: string,
  ): Promise<GenerateShareResponse> {
    const shareId = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.SHARE_LINK_TTL_SECONDS * 1000)

    const record: ShareRecord = {
      shareId,
      tripId,
      createdBy,
      itinerary,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    await this.redis.set(`share:${shareId}`, record, config.SHARE_LINK_TTL_SECONDS)

    this.logger.info('Share link generated', { shareId, tripId, createdBy })

    return {
      shareId,
      shareUrl: `${config.SHARING_BASE_URL}/api/v1/share/${shareId}`,
      expiresAt: expiresAt.toISOString(),
    }
  }

  async resolve(shareId: string): Promise<GetShareResponse> {
    const record = await this.redis.get<ShareRecord>(`share:${shareId}`)

    if (!record) {
      throw new NotFoundError(`Share link ${shareId}`)
    }

    return {
      shareId: record.shareId,
      tripId: record.tripId,
      itinerary: record.itinerary,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    }
  }
}
