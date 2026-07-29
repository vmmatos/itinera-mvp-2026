import type { RenderedEmail } from './welcome'

export interface ItineraryPdfData {
  firstName: string
  tripName: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderItineraryPdf(data: ItineraryPdfData): RenderedEmail {
  const { firstName, tripName } = data
  return {
    subject: `Your itinerary PDF for "${tripName}"`,
    html: `<h1>Hi ${escapeHtml(firstName)},</h1>
<p>Here is your itinerary PDF for <strong>${escapeHtml(tripName)}</strong>, attached to this email.</p>`,
    text: `Hi ${firstName},\n\nHere is your itinerary PDF for "${tripName}", attached to this email.`,
  }
}
