import type { ItineraryData, ItineraryDay, ItineraryTransport, WeatherInfo } from '@/types/sharing'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderTransport(transport: ItineraryTransport[]): string {
  if (!transport || transport.length === 0) return ''
  return transport.map((t) => {
    const modeIcon = t.mode === 'flight' ? '✈' : t.mode === 'train' ? '🚆' : t.mode === 'bus' ? '🚌' : '🚗'
    const summary = t.displaySummary
      ? escapeHtml(t.displaySummary)
      : [
          `${modeIcon} ${escapeHtml(t.mode)}`,
          t.provider ? `(${escapeHtml(t.provider)})` : '',
          t.durationMinutes ? `${Math.floor(t.durationMinutes / 60)}h${t.durationMinutes % 60 > 0 ? `${t.durationMinutes % 60}m` : ''}` : '',
          t.priceEur ? `€${t.priceEur}/pp` : '',
        ].filter(Boolean).join(' · ')
    const times = t.departureTime && t.arrivalTime
      ? `<span class="transport-times">Departs ${escapeHtml(t.departureTime)} → Arrives ${escapeHtml(t.arrivalTime)}</span>`
      : ''
    return `
      <div class="transport-leg">
        <span class="transport-route"><strong>${escapeHtml(t.from)} → ${escapeHtml(t.to)}</strong></span>
        <span class="transport-summary"> ${summary}</span>
        ${times}
      </div>`
  }).join('\n')
}

function renderDay(day: ItineraryDay): string {
  const transportHtml = day.transport && day.transport.length > 0
    ? `<div class="transport-section"><h4>Travel</h4>${renderTransport(day.transport)}</div>`
    : ''

  const activitiesHtml = day.activities
    .map(
      (a) => `
      <li class="activity">
        <strong>${escapeHtml(a.name)}</strong>
        ${a.location ? `<span class="location"> — ${escapeHtml(a.location)}</span>` : ''}
        ${a.duration ? `<span class="duration">(${escapeHtml(a.duration)})</span>` : ''}
        ${a.notes ? `<p class="notes">${escapeHtml(a.notes)}</p>` : ''}
      </li>`,
    )
    .join('\n')

  const mealsHtml =
    day.meals && day.meals.length > 0
      ? `<div class="meals"><h4>Meals</h4><ul>${day.meals
          .map(
            (m) =>
              `<li>${escapeHtml(m.type)}: ${escapeHtml(m.name)}${m.location ? ` at ${escapeHtml(m.location)}` : ''}</li>`,
          )
          .join('')}</ul></div>`
      : ''

  return `
    <div class="day">
      <h3>Day ${day.day}${day.date ? ` — ${escapeHtml(day.date)}` : ''}</h3>
      ${transportHtml}
      <ul class="activities">${activitiesHtml}</ul>
      ${mealsHtml}
    </div>`
}

function renderWeather(weather: WeatherInfo): string {
  if (!weather.alerts.length && !weather.summary) return ''
  const alertsHtml = weather.alerts.length
    ? `<ul class="weather-alerts">${weather.alerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
    : ''
  const summaryHtml = weather.summary
    ? `<p class="weather-summary">${escapeHtml(weather.summary)}</p>`
    : ''
  return `<div class="weather-section"><h3>Weather Forecast</h3>${summaryHtml}${alertsHtml}</div>`
}

export function renderItineraryHtml(data: ItineraryData): string {
  const daysHtml = data.days.map(renderDay).join('\n')

  const dateRange =
    data.startDate && data.endDate
      ? `<p class="dates">${escapeHtml(data.startDate)} — ${escapeHtml(data.endDate)}</p>`
      : ''

  const budget = data.budgetTotal
    ? `<p class="budget">Budget: ${data.budgetTotal} ${escapeHtml(data.budgetCurrency ?? 'EUR')}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(data.tripName)} — Itinerary</title>
  <style>
    body { font-family: Arial, sans-serif; color: #222; margin: 0; padding: 0; }
    .header { background: #1a56db; color: #fff; padding: 24px 30px; }
    .header h1 { margin: 0 0 8px; font-size: 24px; }
    .dates, .budget { margin: 4px 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 24px 30px; }
    .day { margin-bottom: 32px; border-left: 4px solid #1a56db; padding-left: 16px; }
    .day h3 { margin: 0 0 12px; color: #1a56db; }
    .activities { list-style: none; padding: 0; margin: 0; }
    .activity { margin-bottom: 10px; }
    .location { color: #555; font-size: 13px; }
    .duration { color: #888; font-size: 12px; }
    .notes { color: #666; font-size: 13px; margin: 4px 0 0; }
    .meals { margin-top: 12px; background: #f9fafb; padding: 10px; border-radius: 4px; }
    .meals h4 { margin: 0 0 6px; font-size: 13px; color: #444; }
    .meals ul { margin: 0; padding-left: 18px; font-size: 13px; }
    .weather-section { margin: 24px 0; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 16px; }
    .weather-section h3 { margin: 0 0 8px; font-size: 14px; color: #1e40af; }
    .weather-summary { margin: 0 0 8px; font-size: 13px; color: #374151; }
    .weather-alerts { margin: 0; padding-left: 18px; font-size: 13px; color: #374151; }
    .weather-alerts li { margin-bottom: 4px; }
    .transport-section { margin-bottom: 12px; background: #f0f4ff; border: 1px solid #c7d7fd; border-radius: 4px; padding: 10px 12px; }
    .transport-section h4 { margin: 0 0 6px; font-size: 12px; color: #1e40af; text-transform: uppercase; letter-spacing: 0.05em; }
    .transport-leg { font-size: 13px; color: #1e3a8a; margin-bottom: 4px; }
    .transport-route { font-size: 14px; }
    .transport-summary { color: #374151; }
    .transport-times { display: block; font-size: 12px; color: #6b7280; margin-top: 2px; }
    .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(data.tripName)}</h1>
    ${dateRange}
    ${budget}
  </div>
  <div class="content">
    ${data.weather ? renderWeather(data.weather) : ''}
    ${daysHtml}
    <div class="footer">Generated by Itinera — your AI travel planner</div>
  </div>
</body>
</html>`
}
