import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPdf, mockSetContent, mockClose, mockNewPage, mockLaunch } = vi.hoisted(() => ({
  mockPdf: vi.fn(),
  mockSetContent: vi.fn(),
  mockClose: vi.fn(),
  mockNewPage: vi.fn(),
  mockLaunch: vi.fn(),
}))

vi.mock('puppeteer-core', () => ({
  default: {
    launch: mockLaunch,
  },
}))

vi.mock('@itinera/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itinera/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }
})

vi.mock('@/config', () => ({
  config: {
    PUPPETEER_EXECUTABLE_PATH: undefined,
    JWT_SECRET: 'test-secret',
    SHARING_BASE_URL: 'http://localhost:3008',
    SHARE_LINK_TTL_SECONDS: 604800,
  },
  getRedisUrl: () => 'redis://localhost:6379',
}))

vi.mock('@/templates/itinerary', () => ({
  renderItineraryHtml: vi.fn().mockReturnValue('<html><body>Paris Trip</body></html>'),
}))

import { PDFGeneratorService } from '@/services/PDFGeneratorService'
import type { ItineraryData } from '@/types/sharing'

const sampleItinerary: ItineraryData = {
  tripName: 'Paris Trip',
  tripId: '123e4567-e89b-12d3-a456-426614174000',
  days: [{ day: 1, activities: [{ name: 'Eiffel Tower' }] }],
}

describe('PDFGeneratorService', () => {
  let service: PDFGeneratorService
  let mockPage: { setContent: typeof mockSetContent; pdf: typeof mockPdf }
  let mockBrowser: { newPage: typeof mockNewPage; close: typeof mockClose }

  beforeEach(() => {
    vi.clearAllMocks()

    mockPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    mockSetContent.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)

    mockPage = { setContent: mockSetContent, pdf: mockPdf }
    mockNewPage.mockResolvedValue(mockPage)
    mockBrowser = { newPage: mockNewPage, close: mockClose }
    mockLaunch.mockResolvedValue(mockBrowser)

    service = new PDFGeneratorService()
  })

  it('launches Chromium with --no-sandbox arg', async () => {
    await service.generate(sampleItinerary)

    expect(mockLaunch).toHaveBeenCalledOnce()
    const launchArgs = mockLaunch.mock.calls[0][0] as { args: string[] }
    expect(launchArgs.args).toContain('--no-sandbox')
  })

  it('launches Chromium with --disable-setuid-sandbox arg', async () => {
    await service.generate(sampleItinerary)

    const launchArgs = mockLaunch.mock.calls[0][0] as { args: string[] }
    expect(launchArgs.args).toContain('--disable-setuid-sandbox')
  })

  it('sets page content with rendered HTML', async () => {
    await service.generate(sampleItinerary)

    expect(mockSetContent).toHaveBeenCalledOnce()
    const [html] = mockSetContent.mock.calls[0] as [string]
    expect(html).toContain('Paris Trip')
  })

  it('generates PDF with A4 format', async () => {
    await service.generate(sampleItinerary)

    expect(mockPdf).toHaveBeenCalledOnce()
    const pdfOptions = mockPdf.mock.calls[0][0] as { format: string }
    expect(pdfOptions.format).toBe('A4')
  })

  it('returns a Buffer', async () => {
    const result = await service.generate(sampleItinerary)

    expect(Buffer.isBuffer(result)).toBe(true)
  })

  it('closes browser after successful PDF generation', async () => {
    await service.generate(sampleItinerary)

    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('closes browser even when page.pdf throws', async () => {
    mockPdf.mockRejectedValue(new Error('PDF generation failed'))

    await expect(service.generate(sampleItinerary)).rejects.toThrow('PDF generation failed')

    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('closes browser even when page.setContent throws', async () => {
    mockSetContent.mockRejectedValue(new Error('Content load failed'))

    await expect(service.generate(sampleItinerary)).rejects.toThrow('Content load failed')

    expect(mockClose).toHaveBeenCalledOnce()
  })
})
