import type { RenderedEmail } from './welcome'

export interface BookingReminderData {
  firstName: string
  tripName: string
  daysUntilTrip: number
  checklistUrl?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderBookingReminder(data: BookingReminderData): RenderedEmail {
  const { firstName, tripName, daysUntilTrip, checklistUrl = 'https://itinera.app/checklist' } =
    data
  const dayWord = daysUntilTrip === 1 ? 'day' : 'days'
  return {
    subject: `${daysUntilTrip} ${dayWord} until your trip: ${tripName}`,
    html: `<h1>Hi ${escapeHtml(firstName)},</h1>
<p>Your trip <strong>${escapeHtml(tripName)}</strong> is in <strong>${daysUntilTrip} ${dayWord}</strong>.</p>
<p><a href="${escapeHtml(checklistUrl)}">View pre-trip checklist</a></p>`,
    text: `Hi ${firstName},\n\nYour trip "${tripName}" is in ${daysUntilTrip} ${dayWord}.\nChecklist: ${checklistUrl}`,
  }
}
