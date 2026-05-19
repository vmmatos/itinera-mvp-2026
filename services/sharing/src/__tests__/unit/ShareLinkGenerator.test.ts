import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockIsConnected = vi.fn().mockReturnValue(true)

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }
})

vi.mock('@/config', () => ({
  config: {
    SHARE_LINK_TTL_SECONDS: 604800,
    SHARING_BASE_URL: 'http://localhost:3008',
  },
  getRedisUrl: () => 'redis://localhost:6379',
}))

vi.mock('@/services/RedisService', () => ({
  RedisService: vi.fn().mockImplementation(() => ({
    get: mockGet,
    set: mockSet,
    isConnected: mockIsConnected,
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { ShareLinkGenerator } from '@/services/ShareLinkGenerator'
import { RedisService } from '@/services/RedisService'
import { NotFoundError } from '@itinera/shared'
import type { ShareRecord, ItineraryData } from '@/types/sharing'

const sampleItinerary: ItineraryData = {
  tripName: 'Paris Trip',
  tripId: '123e4567-e89b-12d3-a456-426614174000',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  days: [
    {
      day: 1,
      activities: [{ name: 'Eiffel Tower', location: 'Paris' }],
    },
  ],
}

describe('ShareLinkGenerator', () => {
  let generator: ShareLinkGenerator
  let redis: RedisService

  beforeEach(() => {
    vi.clearAllMocks()
    redis = new RedisService()
    generator = new ShareLinkGenerator(redis)
  })

  describe('generate()', () => {
    it('stores share record in Redis with correct key prefix and TTL', async () => {
      mockSet.mockResolvedValue(undefined)

      await generator.generate(sampleItinerary.tripId, sampleItinerary, 'user-123')

      expect(mockSet).toHaveBeenCalledOnce()
      const [key, record, ttl] = mockSet.mock.calls[0] as [string, ShareRecord, number]
      expect(key).toMatch(/^share:[0-9a-f-]{36}$/)
      expect(record.tripId).toBe(sampleItinerary.tripId)
      expect(record.createdBy).toBe('user-123')
      expect(ttl).toBe(604800)
    })

    it('returns shareId, shareUrl containing shareId, and ISO expiresAt', async () => {
      mockSet.mockResolvedValue(undefined)

      const result = await generator.generate(sampleItinerary.tripId, sampleItinerary, 'user-123')

      expect(result.shareId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.shareUrl).toContain(result.shareId)
      expect(result.shareUrl).toContain('http://localhost:3008')
      expect(() => new Date(result.expiresAt)).not.toThrow()
    })

    it('sets expiresAt ~7 days in the future', async () => {
      mockSet.mockResolvedValue(undefined)
      const before = Date.now()

      const result = await generator.generate(sampleItinerary.tripId, sampleItinerary, 'user-abc')

      const expiresMs = new Date(result.expiresAt).getTime()
      const sevenDaysMs = 604800 * 1000
      expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000)
      expect(expiresMs).toBeLessThanOrEqual(before + sevenDaysMs + 1000)
    })

    it('stores itinerary in Redis record', async () => {
      mockSet.mockResolvedValue(undefined)

      await generator.generate(sampleItinerary.tripId, sampleItinerary, 'user-123')

      const [, record] = mockSet.mock.calls[0] as [string, ShareRecord, number]
      expect(record.itinerary).toEqual(sampleItinerary)
    })

    it('propagates Redis errors', async () => {
      mockSet.mockRejectedValue(new Error('Redis connection lost'))

      await expect(
        generator.generate(sampleItinerary.tripId, sampleItinerary, 'user-123'),
      ).rejects.toThrow('Redis connection lost')
    })
  })

  describe('resolve()', () => {
    const shareId = '550e8400-e29b-41d4-a716-446655440000'

    const storedRecord: ShareRecord = {
      shareId,
      tripId: sampleItinerary.tripId,
      createdBy: 'user-123',
      itinerary: sampleItinerary,
      createdAt: '2026-05-19T10:00:00.000Z',
      expiresAt: '2026-05-26T10:00:00.000Z',
    }

    it('queries Redis with key share:{id}', async () => {
      mockGet.mockResolvedValue(storedRecord)

      await generator.resolve(shareId)

      expect(mockGet).toHaveBeenCalledWith(`share:${shareId}`)
    })

    it('returns share data when found', async () => {
      mockGet.mockResolvedValue(storedRecord)

      const result = await generator.resolve(shareId)

      expect(result.shareId).toBe(shareId)
      expect(result.tripId).toBe(sampleItinerary.tripId)
      expect(result.itinerary).toEqual(sampleItinerary)
      expect(result.createdAt).toBe(storedRecord.createdAt)
      expect(result.expiresAt).toBe(storedRecord.expiresAt)
    })

    it('throws NotFoundError when Redis returns null', async () => {
      mockGet.mockResolvedValue(null)

      await expect(generator.resolve(shareId)).rejects.toThrow(NotFoundError)
    })

    it('propagates Redis errors', async () => {
      mockGet.mockRejectedValue(new Error('Redis unavailable'))

      await expect(generator.resolve(shareId)).rejects.toThrow('Redis unavailable')
    })
  })
})
