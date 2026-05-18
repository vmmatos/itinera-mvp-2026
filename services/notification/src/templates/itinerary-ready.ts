import type { RenderedEmail } from './welcome'

export interface ItineraryReadyData {
  firstName: string
  tripName: string
  tripId: string
  viewUrl?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderItineraryReady(data: ItineraryReadyData): RenderedEmail {
  const { firstName, tripName, tripId, viewUrl = `https://itinera.app/trips/${tripId}` } = data
  return {
    subject: `Your itinerary for "${tripName}" is ready!`,
    html: `<h1>Hi ${escapeHtml(firstName)},</h1>
<p>Your AI agents have finished negotiating your itinerary for <strong>${escapeHtml(tripName)}</strong>.</p>
<p><a href="${escapeHtml(viewUrl)}">View your itinerary</a></p>`,
    text: `Hi ${firstName},\n\nYour itinerary for "${tripName}" is ready.\nView it: ${viewUrl}`,
  }
}
