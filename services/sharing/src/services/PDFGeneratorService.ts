import puppeteer from 'puppeteer-core'
import { createLogger } from '@itinera/shared'
import { renderItineraryHtml } from '@/templates/itinerary'
import { config } from '@/config'
import type { ItineraryData } from '@/types/sharing'

export class PDFGeneratorService {
  private readonly logger = createLogger('pdf-generator')
  private readonly executablePath =
    config.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser'

  async generate(itinerary: ItineraryData): Promise<Buffer> {
    this.logger.info('Generating PDF', { tripId: itinerary.tripId })

    const html = renderItineraryHtml(itinerary)

    const browser = await puppeteer.launch({
      executablePath: this.executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
    })

    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      })
      this.logger.info('PDF generated', { tripId: itinerary.tripId, bytes: pdf.length })
      return Buffer.from(pdf)
    } finally {
      await browser.close()
    }
  }
}
