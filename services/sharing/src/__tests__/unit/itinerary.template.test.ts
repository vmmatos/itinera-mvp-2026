import { describe, it, expect } from 'vitest'
import { renderItineraryHtml } from '@/templates/itinerary'
import type { ItineraryData } from '@/types/sharing'

const baseItinerary: ItineraryData = {
  tripName: 'Paris Adventure',
  tripId: '123e4567-e89b-12d3-a456-426614174000',
  days: [
    {
      day: 1,
      activities: [
        { name: 'Eiffel Tower', location: 'Champ de Mars', duration: '2h' },
        { name: 'Louvre Museum' },
      ],
    },
    {
      day: 2,
      activities: [{ name: 'Versailles', notes: 'Book tickets in advance' }],
    },
  ],
}

describe('renderItineraryHtml()', () => {
  it('contains trip name', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Paris Adventure')
  })

  it('contains day numbers', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Day 1')
    expect(html).toContain('Day 2')
  })

  it('contains activity names', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Eiffel Tower')
    expect(html).toContain('Louvre Museum')
    expect(html).toContain('Versailles')
  })

  it('renders location when provided', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Champ de Mars')
  })

  it('renders notes when provided', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Book tickets in advance')
  })

  it('escapes < and > in tripName', () => {
    const html = renderItineraryHtml({ ...baseItinerary, tripName: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes & in activity name', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      days: [{ day: 1, activities: [{ name: 'Food & Wine Tour' }] }],
    })
    expect(html).toContain('Food &amp; Wine Tour')
    expect(html).not.toContain('Food & Wine Tour')
  })

  it('escapes " in trip name', () => {
    const html = renderItineraryHtml({ ...baseItinerary, tripName: 'Trip "Deluxe"' })
    expect(html).toContain('&quot;Deluxe&quot;')
  })

  it('includes dateRange when startDate and endDate provided', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      startDate: '2026-06-01',
      endDate: '2026-06-05',
    })
    expect(html).toContain('2026-06-01')
    expect(html).toContain('2026-06-05')
  })

  it('omits dateRange when startDate or endDate missing', () => {
    const html = renderItineraryHtml({ ...baseItinerary, startDate: '2026-06-01' })
    expect(html).not.toContain('class="dates"')
  })

  it('includes budget when budgetTotal provided', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      budgetTotal: 2500,
      budgetCurrency: 'EUR',
    })
    expect(html).toContain('2500')
    expect(html).toContain('EUR')
  })

  it('omits budget block when budgetTotal not provided', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).not.toContain('class="budget"')
  })

  it('defaults budget currency to EUR when not provided', () => {
    const html = renderItineraryHtml({ ...baseItinerary, budgetTotal: 1000 })
    expect(html).toContain('EUR')
  })

  it('renders meals section when day has meals', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      days: [
        {
          day: 1,
          activities: [{ name: 'Eiffel Tower' }],
          meals: [
            { type: 'Lunch', name: 'Café de Flore', location: 'Saint-Germain' },
            { type: 'Dinner', name: 'Le Procope' },
          ],
        },
      ],
    })
    expect(html).toContain('Meals')
    expect(html).toContain('Lunch')
    expect(html).toContain('Café de Flore')
    expect(html).toContain('Saint-Germain')
  })

  it('omits meals section when day has no meals', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).not.toContain('class="meals"')
  })

  it('renders the restaurant rating when present', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      days: [
        {
          day: 1,
          activities: [{ name: 'Eiffel Tower' }],
          meals: [{ type: 'Lunch', name: 'Cervejaria Ramiro', location: 'Intendente', rating: 4.6 }],
        },
      ],
    })
    expect(html).toContain('<span class="meal-rating">')
    expect(html).toContain('★ 4.6')
  })

  it('omits the rating span when a meal has no rating', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      days: [{ day: 1, activities: [{ name: 'X' }], meals: [{ type: 'Lunch', name: 'Tasca' }] }],
    })
    expect(html).not.toContain('<span class="meal-rating">')
  })

  it('escapes HTML in meal name and location', () => {
    const html = renderItineraryHtml({
      ...baseItinerary,
      days: [
        {
          day: 1,
          activities: [{ name: 'X' }],
          meals: [{ type: 'Dinner', name: 'Ben & Jerry <bistro>', location: 'A & B' }],
        },
      ],
    })
    expect(html).toContain('Ben &amp; Jerry &lt;bistro&gt;')
    expect(html).toContain('A &amp; B')
  })

  it('includes the Itinera footer', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('Generated by Itinera')
  })

  it('is valid HTML with correct structure', () => {
    const html = renderItineraryHtml(baseItinerary)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('</html>')
  })
})
