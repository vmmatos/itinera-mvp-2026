import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { formatLocation } from '~/utils/itinerary'
import ActivityCard from '~/components/trip/ActivityCard.vue'
import type { ActivityCardProps } from '~/components/trip/ActivityCard.vue'

describe('formatLocation', () => {
  // ── Happy path ──────────────────────────────────────────────

  it('returns venue · city when both present', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo', city: 'Lisboa' }))
      .toBe('Museu do Azulejo · Lisboa')
  })

  it('returns venue only when city is absent', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo' }))
      .toBe('Museu do Azulejo')
  })

  it('returns city, country when venue is absent', () => {
    expect(formatLocation({ city: 'Lisboa', country: 'Portugal' }))
      .toBe('Lisboa, Portugal')
  })

  it('returns city only when venue and country are absent', () => {
    expect(formatLocation({ city: 'Lisboa' }))
      .toBe('Lisboa')
  })

  it('returns legacy location string as final fallback', () => {
    expect(formatLocation({ location: 'Rua da Madre de Deus 4' }))
      .toBe('Rua da Madre de Deus 4')
  })

  it('prefers venue over legacy location', () => {
    expect(formatLocation({ venue: 'Museu do Azulejo', location: 'old location' }))
      .toBe('Museu do Azulejo')
  })

  it('prefers city + country over legacy location when venue absent', () => {
    expect(formatLocation({ city: 'Sintra', country: 'Portugal', location: 'old' }))
      .toBe('Sintra, Portugal')
  })

  // ── Error / edge cases ───────────────────────────────────────

  it('returns empty string when all fields are undefined', () => {
    expect(formatLocation({})).toBe('')
  })

  it('returns empty string when all fields are empty strings', () => {
    expect(formatLocation({ venue: '', city: '', country: '', location: '' }))
      .toBe('')
  })

  it('treats empty string venue as absent, falls back to city', () => {
    expect(formatLocation({ venue: '', city: 'Lisboa', country: 'Portugal' }))
      .toBe('Lisboa, Portugal')
  })

  it('treats whitespace-only venue as absent', () => {
    expect(formatLocation({ venue: '   ', city: 'Lisboa' }))
      .toBe('Lisboa')
  })

  it('treats empty string city as absent when combined with country', () => {
    expect(formatLocation({ city: '', country: 'Portugal', location: 'fallback' }))
      .toBe('fallback')
  })
})

function activity(overrides: Partial<ActivityCardProps> = {}): ActivityCardProps {
  return { name: 'Museu Picasso', cost: 12, durationMinutes: 90, ownerAgent: 'alice', ...overrides }
}

describe('ActivityCard — standard activity card', () => {
  it('renders cost, duration and "proposed by" badges without needing isDebug', () => {
    const wrapper = mount(ActivityCard, { props: { activity: activity() } })
    expect(wrapper.text()).toContain('€12')
    expect(wrapper.text()).toContain('1h 30m')
    expect(wrapper.text()).toContain('proposed by')
    expect(wrapper.text()).toContain('alice')
  })

  it('still renders the "proposed by" badge when isDebug is explicitly false', () => {
    const wrapper = mount(ActivityCard, { props: { activity: activity(), isDebug: false } })
    expect(wrapper.find('.badge-agent').exists()).toBe(true)
  })

  it('does not render cost, duration or agent badges when absent', () => {
    const wrapper = mount(ActivityCard, {
      props: { activity: activity({ cost: undefined, durationMinutes: undefined, ownerAgent: undefined }) },
    })
    expect(wrapper.find('.badge-cost').exists()).toBe(false)
    expect(wrapper.find('.badge-duration').exists()).toBe(false)
    expect(wrapper.find('.badge-agent').exists()).toBe(false)
  })
})
