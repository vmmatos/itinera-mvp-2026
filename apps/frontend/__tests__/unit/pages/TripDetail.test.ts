import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TripDetail from '~/pages/trips/[id].vue'
import Timeline from '~/components/trip/Timeline.vue'
import { mockApiGet } from '~/__tests__/setup'
import type { WeatherAssessment } from '~/types/index'

// The page users actually land on from the dashboard. Until M130 it never
// passed any weather to TripTimeline, so a saved trip showed no forecast at
// all — testing the component alone cannot prove that wiring exists.

const TRIP_ID = '11111111-1111-1111-1111-111111111111'

const FIXED_DATE_INPUT = { mode: 'fixed' as const, startDate: '2026-06-01', endDate: '2026-06-02' }
const FLEXIBLE_DATE_INPUT = { mode: 'flexible' as const, days: 7, preferredMonth: '2026-09', window: 'moderate' as const }

function trip(dateInput: unknown) {
  return {
    id: TRIP_ID,
    name: 'Lisboa long weekend',
    status: 'confirmed',
    region: 'Lisboa',
    budgetTotal: 2000,
    budgetCurrency: 'EUR',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    dateInput,
  }
}

function proposals(dayAssessments: Array<Record<string, unknown>>) {
  return [
    {
      tripId: TRIP_ID,
      agent: 'orchestrator',
      round: 1,
      content: {
        itinerary: [
          { day: 1, date: '2026-06-01', city: 'Lisboa', activities: [{ activity: 'Castle visit', time: 'morning' }] },
          { day: 2, date: '2026-06-02', city: 'Lisboa', activities: [{ activity: 'Museum', time: 'morning' }] },
        ],
        weatherAssessment: { overallRisk: 'low', dayAssessments, timingIssues: [], summary: '' },
      },
    },
  ]
}

const WITH_TEMPS = [
  { day: 1, date: '2026-06-01', weatherRisk: 'low', tempHigh: 24, tempLow: 15, condition: 'Clear', precipitationProbability: 20, affectedActivities: [] },
  { day: 2, date: '2026-06-02', weatherRisk: 'low', tempHigh: 26, tempLow: 16, condition: 'Clouds', precipitationProbability: 5, affectedActivities: [] },
]

const WITHOUT_TEMPS = [
  { day: 1, date: '2026-12-01', weatherRisk: 'low', affectedActivities: [] },
  { day: 2, date: '2026-12-02', weatherRisk: 'low', affectedActivities: [] },
]

async function mountPage(dateInput: unknown, dayAssessments: Array<Record<string, unknown>>) {
  mockApiGet
    .mockResolvedValueOnce({ data: { data: trip(dateInput) } })
    .mockResolvedValueOnce({ data: { data: proposals(dayAssessments) } })

  const wrapper = mount(TripDetail, {
    global: {
      plugins: [createPinia()],
      // Real component registered so `.props()` introspection works against the
      // auto-stub, same trick as TripInputForm.test.ts.
      components: { TripTimeline: Timeline },
      stubs: { AppHeader: true, NuxtLink: true, TripBudgetBreakdown: true, TripTimeline: true },
    },
  })
  await flushPromises()
  return wrapper
}

describe('pages/trips/[id] — weather wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('passes the parsed weather assessment to TripTimeline for a confirmed fixed-date trip', async () => {
    const wrapper = await mountPage(FIXED_DATE_INPUT, WITH_TEMPS)

    const timeline = wrapper.findComponent({ name: 'TripTimeline' })
    const weather = timeline.props('weather') as WeatherAssessment | null
    expect(weather?.dayAssessments[0]?.tempHigh).toBe(24)
    expect(weather?.dayAssessments[1]?.tempHigh).toBe(26)
  })

  it('passes null weather for a flexible-date trip, even though the proposal carries temperatures', async () => {
    const wrapper = await mountPage(FLEXIBLE_DATE_INPUT, WITH_TEMPS)

    expect(wrapper.findComponent({ name: 'TripTimeline' }).props('weather')).toBeNull()
  })

  it('passes null weather when a fixed-date trip has assessments but no real temperatures', async () => {
    const wrapper = await mountPage(FIXED_DATE_INPUT, WITHOUT_TEMPS)

    expect(wrapper.findComponent({ name: 'TripTimeline' }).props('weather')).toBeNull()
  })

  it('no longer renders the suggested-window banner (never populated since weather went fixed-only)', async () => {
    const wrapper = await mountPage(FLEXIBLE_DATE_INPUT, WITH_TEMPS)

    expect(wrapper.text()).not.toContain('suggested window')
  })
})
