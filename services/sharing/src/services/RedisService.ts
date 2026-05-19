import { RedisService as SharedRedisService } from '@itinera/shared'
import { getRedisUrl } from '@/config'

export class RedisService extends SharedRedisService {
  constructor() {
    super(getRedisUrl())
  }
}
