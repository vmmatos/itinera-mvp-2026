import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// All store/composable globals are shimmed by __tests__/setup.ts.
// Import the shared mocks so we can configure return values per test.
import {
  mockCreateTrip,
  mockFetchTrips,
  mockApiGet,
  mockSetLastInput,
  tripStoreMock,
  authStoreMock,
  agentStreamMock,
} from '../setup'

import TripInputForm from '~/components/trip/TripInputForm.vue'

const mountForm = () =>
  mount(TripInputForm, {
    global: {
      plugins: [createPinia()],
      stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true },
    },
  })

// Helper: navigate to step 2 by picking culture persona for the auto-added user
const goToStep2 = async (wrapper: ReturnType<typeof mountForm>) => {
  await wrapper.findAll('.persona-card')[0].trigger('click')
  await wrapper.find('[class*="btn-primary"]').trigger('click')
}

describe('TripInputForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tripStoreMock.loading = false
    tripStoreMock.error = null
  })

  // ── Rendering ────────────────────────────────────────────────

  it('renders step 1 (Group) by default', () => {
    const wrapper = mountForm()
    expect(wrapper.text()).toContain('Group composition')
    expect(wrapper.text()).toContain("Who's joining the trip?")
  })

  it('shows current user (from authStore) as first traveller', () => {
    authStoreMock.user.name = 'Test User'
    const wrapper = mountForm()
    expect(wrapper.text()).toContain('Test User')
    expect(wrapper.text()).toContain('organiser')
  })

  it('clicking Next without selecting persona stays on step 1', async () => {
    const wrapper = mountForm()
    const btn = wrapper.find('[class*="btn-primary"]')
    await btn.trigger('click')
    // Validation fires on click — form does not advance to step 2
    expect(wrapper.text()).toContain('Group composition')
  })

  // ── Step 1: traveller management ─────────────────────────────

  it('adds a traveller card when "invite traveller" is clicked', async () => {
    const wrapper = mountForm()
    const before = wrapper.findAll('[data-testid="traveller-card"]').length
    expect(before).toBe(1)

    await wrapper.find('[data-testid="add-traveller"]').trigger('click')

    expect(wrapper.findAll('[data-testid="traveller-card"]').length).toBe(2)
  })

  it('does not show add-traveller button when 4 travellers exist', async () => {
    const wrapper = mountForm()
    // Start with 1; add 3 more
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-testid="add-traveller"]').trigger('click')
    }
    expect(wrapper.find('[data-testid="add-traveller"]').exists()).toBe(false)
  })

  it('removes an added traveller when × is clicked', async () => {
    const wrapper = mountForm()
    await wrapper.find('[data-testid="add-traveller"]').trigger('click')
    expect(wrapper.findAll('[data-testid="traveller-card"]').length).toBe(2)

    // Find the × button on the second (removable) traveller
    const removeBtn = wrapper.findAll('.gx')[0]
    await removeBtn.trigger('click')

    expect(wrapper.findAll('[data-testid="traveller-card"]').length).toBe(1)
  })

  it('enables Next button after current user selects a persona', async () => {
    const wrapper = mountForm()
    await wrapper.findAll('.persona-card')[0].trigger('click') // culture

    const btn = wrapper.find('[class*="btn-primary"]')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  // ── Step navigation ──────────────────────────────────────────

  it('advances to step 2 when Next is clicked with valid step 1', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    expect(wrapper.text()).toContain('Trip brief')
    expect(wrapper.text()).toContain("Describe what you're optimising for.")
  })

  it('goes back to step 1 when Back is clicked on step 2', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    // Back button (non-primary btn)
    const backBtn = wrapper.find('.user-form-foot .btn:not(.btn-primary)')
    await backBtn.trigger('click')

    expect(wrapper.text()).toContain('Group composition')
  })

  // ── Step 2: validation ───────────────────────────────────────

  it('clicking submit with empty fields does not call createTrip', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    // Submit button is only disabled when store.loading; validation fires on click
    const submitBtn = wrapper.find('[data-testid="submit-btn"]')
    await submitBtn.trigger('click')

    expect(mockCreateTrip).not.toHaveBeenCalled()
  })

  it('submit button is enabled when all required step-2 fields are filled', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    await wrapper.find('[data-testid="trip-name"]').setValue('Cusco run')
    await wrapper.find('[data-testid="region"]').setValue('Peru')
    await wrapper.find('[data-testid="start-date"]').setValue('2026-06-12')
    await wrapper.find('[data-testid="end-date"]').setValue('2026-06-19')

    const submitBtn = wrapper.find('[data-testid="submit-btn"]')
    expect(submitBtn.attributes('disabled')).toBeUndefined()
  })

  // ── Budget slider ────────────────────────────────────────────

  it('budget slider updates the displayed ceiling value', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    await wrapper.find('[data-testid="budget-slider"]').setValue(5000)
    // Default currency is EUR
    expect(wrapper.text()).toContain('€5,000 ceiling')
  })

  // ── Submit: happy path ───────────────────────────────────────

  it('calls createTrip with correct payload and advances to step 3', async () => {
    mockCreateTrip.mockResolvedValueOnce('new-trip-42')

    const wrapper = mountForm()
    await goToStep2(wrapper)

    await wrapper.find('[data-testid="trip-name"]').setValue('Test trip')
    await wrapper.find('[data-testid="region"]').setValue('Spain')
    await wrapper.find('[data-testid="start-date"]').setValue('2026-08-01')
    await wrapper.find('[data-testid="end-date"]').setValue('2026-08-08')

    await wrapper.find('[data-testid="submit-btn"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(mockCreateTrip).toHaveBeenCalledOnce()
    const payload = mockCreateTrip.mock.calls[0][0]
    expect(payload.name).toBe('Test trip')
    expect(payload.region).toBe('Spain')
    expect(payload.dateInput?.startDate).toBe('2026-08-01')
    expect(payload.dateInput?.endDate).toBe('2026-08-08')
    expect(payload.budgetCurrency).toBe('EUR')
    expect(payload.travellers[0].preferences.persona).toBe('culture')

    // submit → step 3 (negotiate); success is emitted later via goToDashboard
    expect(wrapper.findComponent({ name: 'TripNegotiateStepV2' }).exists()).toBe(true)
  })

  // ── Submit: error path ───────────────────────────────────────

  it('does not emit success when createTrip rejects', async () => {
    mockCreateTrip.mockRejectedValueOnce(new Error('Server error'))

    const wrapper = mountForm()
    await goToStep2(wrapper)

    await wrapper.find('[data-testid="trip-name"]').setValue('Test trip')
    await wrapper.find('[data-testid="region"]').setValue('Spain')
    await wrapper.find('[data-testid="start-date"]').setValue('2026-08-01')
    await wrapper.find('[data-testid="end-date"]').setValue('2026-08-08')

    await wrapper.find('[data-testid="submit-btn"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('success')).toBeFalsy()
  })
})

// ── Pre-fill from lastInput ───────────────────────────────────────

describe('TripInputForm — pre-fill from lastInput', () => {
  const LAST_INPUT = {
    name:           'Refine test trip',
    region:         'Portugal',
    startDate:      '2026-09-01',
    endDate:        '2026-09-08',
    budgetTotal:    6000,
    budgetCurrency: 'EUR' as const,
    travellers: [
      {
        userId:  'user-1',
        name:    'Test User',
        preferences: {
          persona:      'culture' as const,
          flexibility:  'high' as const,
          pace:         'high' as const,
          dietary:      [],
          constraints:  [],
          mustHaves:    ['sunset views'],
          dealBreakers: ['crowded tours'],
        },
      },
    ],
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tripStoreMock.loading  = false
    tripStoreMock.error    = null
    tripStoreMock.lastInput = null
    agentStreamMock.events.value = []
    agentStreamMock.connected.value = false
  })

  it('pre-fills trip name and region from lastInput on mount', async () => {
    tripStoreMock.lastInput = LAST_INPUT

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()

    // persona is pre-selected from lastInput — advance to step 2 without re-clicking it
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await wrapper.vm.$nextTick()

    const nameInput = wrapper.find('[data-testid="trip-name"]')
    const regionInput = wrapper.find('[data-testid="region"]')
    expect((nameInput.element as HTMLInputElement).value).toBe('Refine test trip')
    expect((regionInput.element as HTMLInputElement).value).toBe('Portugal')
  })

  it('pre-fills traveller persona from lastInput on mount', async () => {
    tripStoreMock.lastInput = LAST_INPUT

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()

    // persona-card for index 0 = culture; should be pre-selected (no manual click needed)
    const cards = wrapper.findAll('.persona-card')
    const cultureCard = cards.find((c) => c.text().includes('Culture'))
    expect(cultureCard?.classes().some((c) => c.startsWith('selected-'))).toBe(true)
  })

  it('does not pre-fill when lastInput is null', async () => {
    tripStoreMock.lastInput = null

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.persona-card')[0].trigger('click')
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await wrapper.vm.$nextTick()

    const nameInput = wrapper.find('[data-testid="trip-name"]')
    expect((nameInput.element as HTMLInputElement).value).toBe('')
  })
})

// ── Refine trip button (step 4) ───────────────────────────────────

describe('TripInputForm — Refine trip (step 4)', () => {
  const VALID_TRIP_UUID = '11111111-1111-1111-1111-111111111111'

  const mountAtStep4 = () =>
    mount(TripInputForm, {
      props: { viewTripId: VALID_TRIP_UUID },
      global: {
        plugins: [createPinia()],
        stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true },
      },
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    tripStoreMock.loading  = false
    tripStoreMock.error    = null
    tripStoreMock.lastInput = null
    agentStreamMock.events.value = []
    agentStreamMock.connected.value = false

    // Polling response when form opens at step 4 with viewTripId
    mockApiGet
      .mockResolvedValue({ data: { data: { status: 'confirmed' } } })
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({ data: { data: [] } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the Refine trip button when on step 4', async () => {
    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="refine-trip-btn"]').exists()).toBe(true)
  })

  it('clicking Refine trip calls setLastInput and returns to step 1', async () => {
    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const refineBtn = wrapper.find('[data-testid="refine-trip-btn"]')
    expect(refineBtn.exists()).toBe(true)

    await refineBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(mockSetLastInput).toHaveBeenCalledOnce()
    // After refine, should return to step 1 (Group composition)
    expect(wrapper.text()).toContain('Group composition')
  })
})

// ── wizardRootStyle: step 3 v2 needs a bounded flex column so its 3
// negotiate columns scroll internally instead of growing the whole page ──

describe('TripInputForm — wizardRootStyle (step 3 layout)', () => {
  const goToStep3 = async () => {
    mockCreateTrip.mockResolvedValueOnce('trip-v2')
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'negotiating' } } })
      .mockResolvedValueOnce({ data: { data: [] } })

    const wrapper = mountForm()
    await goToStep2(wrapper)
    await wrapper.find('[data-testid="trip-name"]').setValue('Porto trip')
    await wrapper.find('[data-testid="region"]').setValue('Portugal')
    await wrapper.find('[data-testid="start-date"]').setValue('2026-09-01')
    await wrapper.find('[data-testid="end-date"]').setValue('2026-09-08')
    await wrapper.find('[data-testid="submit-btn"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tripStoreMock.loading = false
    tripStoreMock.error = null
    agentStreamMock.events.value = []
    agentStreamMock.connected.value = false
  })

  it('happy path: bounds the root to viewport height on step 3', async () => {
    const wrapper = await goToStep3()
    const style = wrapper.find('.fade-in').attributes('style')
    expect(style).toContain('height: 100vh')
    expect(style).toContain('overflow: hidden')
    expect(style).toContain('display: flex')
  })

  it('does not bound the root on step 1', async () => {
    const wrapper = mountForm()
    const style = wrapper.find('.fade-in').attributes('style')
    expect(style).not.toContain('height: 100vh')
    expect(style).not.toContain('overflow: hidden')
  })
})

describe('TripInputForm — Step 4 weather forecast (not-show-meteo)', () => {
  const VALID_TRIP_UUID = '11111111-1111-1111-1111-111111111111'

  const mountAtStep4 = () =>
    mount(TripInputForm, {
      props: { viewTripId: VALID_TRIP_UUID },
      global: {
        plugins: [createPinia()],
        stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true },
      },
    })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    tripStoreMock.loading  = false
    tripStoreMock.error    = null
    tripStoreMock.lastInput = null
    agentStreamMock.events.value = []
    agentStreamMock.connected.value = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the weather forecast card from the orchestrator proposal\'s weatherAssessment', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              tripId: VALID_TRIP_UUID, type: 'propose', agent: 'orchestrator', round: 1, timestamp: '',
              content: {
                itinerary: [{ day: 1, date: '2026-08-10', city: 'Lisbon', activities: [] }],
                weatherAssessment: {
                  overallRisk: 'high',
                  dayAssessments: [{ day: 1, date: '2026-08-10', weatherRisk: 'high', affectedActivities: [] }],
                  timingIssues: [],
                  summary: 'Storms expected on day 1 — consider indoor alternatives.',
                },
              },
            },
          ],
        },
      })

    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Weather forecast')
    expect(wrapper.text()).toContain('Storms expected on day 1')
  })

  it('hides the weather forecast card when no orchestrator proposal carries a weatherAssessment', async () => {
    // Regression guard for the bug this fixes: the 'logistics' proposal is
    // the /plan route-graph and must NOT be read as a weather source.
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              tripId: VALID_TRIP_UUID, type: 'propose', agent: 'logistics', round: 1, timestamp: '',
              content: { orderedLegs: [], cityStays: [] },
            },
          ],
        },
      })

    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Weather forecast')
  })
})
