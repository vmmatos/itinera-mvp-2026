import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// All store/composable globals are shimmed by __tests__/setup.ts.
// Import the shared mocks so we can configure return values per test.
import {
  mockCreateTrip,
  mockFetchTrips,
  mockApiGet,
  mockApiPost,
  mockSetLastInput,
  tripStoreMock,
  authStoreMock,
  agentStreamMock,
} from '../setup'

import TripInputForm from '~/components/trip/TripInputForm.vue'
import TripItineraryStep from '~/components/trip/itinerary/ItineraryStep.vue'

const mountForm = () =>
  mount(TripInputForm, {
    global: {
      plugins: [createPinia()],
      stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true, TripItineraryStep: true },
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

    // The brief is sent once for the trip, never copied per traveller.
    expect(payload.preferences).toEqual({ pace: 'medium', mustHaves: [], avoids: [] })
    expect(payload.travellers[0].preferences).not.toHaveProperty('pace')
    expect(payload.travellers[0].preferences).not.toHaveProperty('mustHaves')
    expect(payload.travellers[0].preferences).not.toHaveProperty('avoids')

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

// ── Step 2: mobile input layout regressions ───────────────────────
// Guards against the inline `style="width:160px"` bug reappearing — inline
// styles beat any responsive CSS class/media-query for the same property,
// which is exactly what broke these fields on narrow viewports.

describe('TripInputForm — mobile input layout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('must-have input has no inline width style and uses the responsive txt-inline class', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    const input = wrapper.find('input[placeholder="+ add must-have"]')
    expect(input.attributes('style') ?? '').not.toContain('width')
    expect(input.classes()).toContain('txt-inline')
  })

  it('avoid input has no inline width style and uses the responsive txt-inline class', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    const input = wrapper.find('input[placeholder="+ add avoid"]')
    expect(input.attributes('style') ?? '').not.toContain('width')
    expect(input.classes()).toContain('txt-inline')
  })

  it('typing 200 chars into the must-have input and pressing Enter adds the full chip text without truncation', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    const longText = 'a'.repeat(200)
    const input = wrapper.find('input[placeholder="+ add must-have"]')
    await input.setValue(longText)
    await input.trigger('keydown.enter')

    const chips = wrapper.findAll('[data-testid="must-have-chip"]').map((c) => c.text())
    expect(chips.some((c) => c.includes(longText))).toBe(true)
  })

  it('the fixed-dates start/end inputs have no inline width style', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    expect(wrapper.find('[data-testid="start-date"]').attributes('style') ?? '').not.toContain('width')
    expect(wrapper.find('[data-testid="end-date"]').attributes('style') ?? '').not.toContain('width')
    expect(wrapper.find('[data-testid="start-date"]').classes()).toContain('date-range-input')
  })

  it('the preferred-month input accepts a value in flexible-dates mode', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    await wrapper.find('[data-testid="date-mode-flexible"]').trigger('click')
    const monthInput = wrapper.find('[data-testid="preferred-month"]')
    await monthInput.setValue('2026-09')

    expect((monthInput.element as HTMLInputElement).value).toBe('2026-09')
  })

  it('footer Voltar/Iniciar negociação buttons render as equal-stretch flex children', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    const backBtn = wrapper.find('.user-form-foot .btn:not(.btn-primary)')
    const submitBtn = wrapper.find('[data-testid="submit-btn"]')
    expect(backBtn.exists()).toBe(true)
    expect(submitBtn.exists()).toBe(true)
    expect(backBtn.element.parentElement).toBe(submitBtn.element.parentElement)
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
          avoids:       ['crowded tours'],
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

  it('pre-fills the brief from a trip-level lastInput', async () => {
    tripStoreMock.lastInput = {
      ...LAST_INPUT,
      preferences: { pace: 'low' as const, mustHaves: ['fado'], avoids: ['filas'] },
      travellers: [
        {
          ...LAST_INPUT.travellers[0],
          preferences: { persona: 'culture' as const, flexibility: 'high' as const, dietary: [], constraints: [] },
        },
      ],
    }

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="must-have-chip"]').map((c) => c.text()).join(' ')).toContain('fado')
    expect(wrapper.findAll('[data-testid="avoid-chip"]').map((c) => c.text()).join(' ')).toContain('filas')
  })

  it('legacy: pre-fills the pace, must-have and avoid chips from a per-traveller lastInput', async () => {
    tripStoreMock.lastInput = LAST_INPUT

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="must-have-chip"]').map((c) => c.text()).join(' ')).toContain('sunset views')
    expect(wrapper.findAll('[data-testid="avoid-chip"]').map((c) => c.text()).join(' ')).toContain('crowded tours')
  })

  it('still pre-fills avoids from the legacy dealBreakers key', async () => {
    const legacy = {
      ...LAST_INPUT,
      travellers: [
        {
          ...LAST_INPUT.travellers[0],
          preferences: { ...LAST_INPUT.travellers[0].preferences, avoids: [], dealBreakers: ['casinos'] },
        },
      ],
    }
    tripStoreMock.lastInput = legacy

    const wrapper = mountForm()
    await wrapper.vm.$nextTick()
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="avoid-chip"]').map((c) => c.text()).join(' ')).toContain('casinos')
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

// ── Step 4: TripItineraryStep wiring ──────────────────────────────

describe('TripInputForm — Step 4 (TripItineraryStep)', () => {
  const VALID_TRIP_UUID = '11111111-1111-1111-1111-111111111111'

  const mountAtStep4 = () =>
    mount(TripInputForm, {
      props: { viewTripId: VALID_TRIP_UUID },
      global: {
        plugins: [createPinia()],
        // Registering the real component (alongside the boolean stub below) lets
        // VTU's auto-stub introspect its actual props schema, so `.props()`
        // assertions on the stub work — otherwise it falls back to a schema-less
        // generic stub since TripItineraryStep is resolved by Nuxt auto-import,
        // which this plain vitest+@vitejs/plugin-vue setup doesn't replicate.
        components: { TripItineraryStep },
        stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true, TripItineraryStep: true },
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

  it('renders TripItineraryStep with the traveller count forwarded when on step 4', async () => {
    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.exists()).toBe(true)
    // The current user is always auto-added as the first traveller, regardless
    // of the viewTripId/lastInput path — a stable prop to assert wiring on.
    expect(step.props('travellers')).toBe(1)
  })

  const validatorProposal = (content: Record<string, unknown>, round = 2) => ({
    id: 'prop-validator', agent: 'validator', round, action: 'score', content,
    createdAt: '2026-07-01T10:00:00Z',
  })

  const mountWithProposals = async (proposals: unknown[]) => {
    mockApiGet.mockReset()
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({ data: { data: proposals } })
      .mockResolvedValue({ data: { data: { status: 'confirmed' } } })

    const wrapper = mountAtStep4()
    for (let i = 0; i < 4; i++) await wrapper.vm.$nextTick()
    return wrapper
  }

  it('reads the per-traveller rows from the validator proposal at whatever round it ran', async () => {
    const wrapper = await mountWithProposals([
      validatorProposal({
        scoring: {
          overallScore: 75,
          scores: [
            { travellerId: 't1', label: 'Ana', score: 100 },
            { travellerId: 't2', label: 'Bruno', score: 50, vetoedBy: [] },
          ],
        },
      }),
    ])

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.props('travellerScores')).toEqual([
      { travellerId: 't1', label: 'Ana', score: 100 },
      { travellerId: 't2', label: 'Bruno', score: 50, vetoedBy: [] },
    ])
  })

  it('returns no rows when there is no validator proposal', async () => {
    const wrapper = await mountWithProposals([])

    expect(wrapper.findComponent({ name: 'TripItineraryStep' }).props('travellerScores')).toEqual([])
  })

  it('returns no rows when the validator content has no scoring block', async () => {
    const wrapper = await mountWithProposals([validatorProposal({ fairness: { fairnessScore: 100 } })])

    expect(wrapper.findComponent({ name: 'TripItineraryStep' }).props('travellerScores')).toEqual([])
  })

  it('drops malformed rows and rows written before the traveller-keyed rename', async () => {
    const wrapper = await mountWithProposals([
      validatorProposal({
        scoring: {
          scores: [
            { travellerId: 't1', label: 'Ana', score: 100 },
            { userId: 'u1', score: 80 },
            { travellerId: 't2', label: 'Bruno', score: 'high' },
            null,
          ],
        },
      }),
    ])

    expect(wrapper.findComponent({ name: 'TripItineraryStep' }).props('travellerScores')).toEqual([
      { travellerId: 't1', label: 'Ana', score: 100 },
    ])
  })

  it('error: a scoring block whose scores is not an array yields no rows', async () => {
    const wrapper = await mountWithProposals([validatorProposal({ scoring: { scores: 'nope' } })])

    expect(wrapper.findComponent({ name: 'TripItineraryStep' }).props('travellerScores')).toEqual([])
  })

  it('emitting refine from TripItineraryStep calls setLastInput and returns to step 1', async () => {
    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.exists()).toBe(true)

    await step.vm.$emit('refine')
    await wrapper.vm.$nextTick()

    expect(mockSetLastInput).toHaveBeenCalledOnce()
    // After refine, should return to step 1 (Group composition)
    expect(wrapper.text()).toContain('Group composition')
  })

  // Preference agents populate `venue`, not `location`, on each activity
  // (SlotProposal.venue) — buildDays() must fall back to it so the address
  // line has something to render, matching pages/trips/[id].vue's extractItinerary().
  const orchestratorProposal = (activities: Record<string, unknown>[], round = 3) => ({
    id: 'prop-orchestrator', agent: 'orchestrator', round, action: 'propose',
    content: { itinerary: [{ day: 1, city: 'Braga', activities }] },
    createdAt: '2026-07-01T10:00:00Z',
  })

  it('falls back to venue for the activity location when location is absent', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{ name: 'Visit museum', venue: 'Museu de Arqueologia D. Diogo de Sousa', country: 'Portugal' }]),
    ])

    const activities = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities
    expect(activities[0].location).toBe('Museu de Arqueologia D. Diogo de Sousa')
  })

  it('keeps an explicit location over venue when both are present', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{ name: 'Visit museum', location: 'Praça Municipal', venue: 'Museu de Arqueologia D. Diogo de Sousa' }]),
    ])

    const activities = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities
    expect(activities[0].location).toBe('Praça Municipal')
  })

  it('error: leaves location undefined when neither location nor venue is present', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{ name: 'Free time' }]),
    ])

    const activities = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities
    expect(activities[0].location).toBeUndefined()
  })

  // buildDays() must mirror pages/trips/[id].vue's extractItinerary() field
  // for field: the merge LLM output only ever carries estimatedCostPerPerson
  // (never a plain `cost`), and durationMinutes/localTransport/dayTripTransport
  // are backend-attached post-merge — dropping any of them here silently
  // blanks the cost/duration badges and the getting-there line in Step 4.
  it('maps estimatedCostPerPerson, durationMinutes, localTransport and dayTripTransport onto the activity', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{
        name: 'Rice fields cycling', venue: 'Comporta Rice Fields',
        estimatedCostPerPerson: 18, durationMinutes: 120,
        localTransport: {
          selectedMode: 'drive', wasPreferenceHonored: true,
          selectedOption: { mode: 'drive', durationMinutes: 12, priceEur: 4, warnings: [] },
        },
      }]),
    ])

    const activity = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities[0]
    expect(activity.cost).toBe(18)
    expect(activity.durationMinutes).toBe(120)
    expect(activity.localTransport?.selectedOption.durationMinutes).toBe(12)
  })

  // Meals are injected post-merge by the logistics pricing overlay as named
  // restaurant picks ({ type, name, location, rating }). buildDays() must keep
  // location + rating so Step 4 / the PDF can render them.
  const orchestratorProposalWithMeals = (meals: Record<string, unknown>[]) => ({
    id: 'prop-orchestrator', agent: 'orchestrator', round: 3, action: 'propose',
    content: { itinerary: [{ day: 1, city: 'Lisbon', activities: [{ name: 'Free time' }], meals }] },
    createdAt: '2026-07-01T10:00:00Z',
  })

  it('parses named restaurant meals with their area and rating', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposalWithMeals([
        { type: 'Lunch', name: 'Cervejaria Ramiro', location: 'Intendente', rating: 4.6, estimatedCostPerPerson: 30 },
      ]),
    ])

    const meals = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].meals
    expect(meals[0]).toMatchObject({ type: 'Lunch', name: 'Cervejaria Ramiro', location: 'Intendente', rating: 4.6 })
  })

  it('leaves location and rating undefined for a bare cost-only meal line', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposalWithMeals([{ type: 'Meals', name: 'Local restaurants', estimatedCostPerPerson: 50 }]),
    ])

    const meals = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].meals
    expect(meals[0].location).toBeUndefined()
    expect(meals[0].rating).toBeUndefined()
  })

  it('includes meal area and rating in the PDF export payload', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
    mockApiPost.mockResolvedValueOnce({ data: new Blob(['%PDF']) })

    const wrapper = await mountWithProposals([
      orchestratorProposalWithMeals([
        { type: 'Lunch', name: 'Ramiro', location: 'Intendente', rating: 4.6, estimatedCostPerPerson: 30 },
      ]),
    ])

    await wrapper.findComponent({ name: 'TripItineraryStep' }).vm.$emit('export')
    await wrapper.vm.$nextTick()

    const pdfCall = mockApiPost.mock.calls.find(([url]) => url === '/api/share/api/v1/export/pdf')
    expect(pdfCall).toBeTruthy()
    const payload = pdfCall![1] as { itinerary: { days: Array<{ meals?: Array<Record<string, unknown>> }> } }
    expect(payload.itinerary.days[0].meals![0]).toMatchObject({
      type: 'Lunch', name: 'Ramiro', location: 'Intendente', rating: 4.6,
    })
  })

  it('maps dayTripTransport onto the activity for a far-venue round trip', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{
        name: 'Alcobaça monastery visit', venue: 'Mosteiro de Alcobaça',
        dayTripTransport: { mode: 'car', durationMinutes: 60, priceEur: 15, warnings: [] },
      }]),
    ])

    const activity = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities[0]
    expect(activity.dayTripTransport?.durationMinutes).toBe(60)
    expect(activity.dayTripTransport?.priceEur).toBe(15)
  })

  it('error: leaves cost, durationMinutes, localTransport and dayTripTransport undefined when absent', async () => {
    const wrapper = await mountWithProposals([
      orchestratorProposal([{ name: 'Free time' }]),
    ])

    const activity = wrapper.findComponent({ name: 'TripItineraryStep' }).props('timelineDays')[0].activities[0]
    expect(activity.cost).toBeUndefined()
    expect(activity.durationMinutes).toBeUndefined()
    expect(activity.localTransport).toBeUndefined()
    expect(activity.dayTripTransport).toBeUndefined()
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

describe('TripInputForm — Step 4 weatherAssessment forwarding', () => {
  const VALID_TRIP_UUID = '11111111-1111-1111-1111-111111111111'
  const FIXED_DATE_INPUT = { mode: 'fixed', startDate: '2026-08-10', endDate: '2026-08-12' }

  const mountAtStep4 = () =>
    mount(TripInputForm, {
      props: { viewTripId: VALID_TRIP_UUID },
      global: {
        plugins: [createPinia()],
        // Registering the real component (alongside the boolean stub below) lets
        // VTU's auto-stub introspect its actual props schema, so `.props()`
        // assertions on the stub work — otherwise it falls back to a schema-less
        // generic stub since TripItineraryStep is resolved by Nuxt auto-import,
        // which this plain vitest+@vitejs/plugin-vue setup doesn't replicate.
        components: { TripItineraryStep },
        stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true, TripItineraryStep: true },
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

  it('forwards the orchestrator proposal\'s weatherAssessment to TripItineraryStep', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed', dateInput: FIXED_DATE_INPUT } } })
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

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    const weatherAssessment = step.props('weatherAssessment') as Record<string, unknown> | null
    expect(weatherAssessment?.overallRisk).toBe('high')
    expect(weatherAssessment?.summary).toContain('Storms expected on day 1')
    expect(step.props('dateInput')).toEqual(FIXED_DATE_INPUT)
  })

  // The exact bug the persisted gate fixes: reopened from the dashboard, none
  // of the wizard's date refs are ever filled in, so dateMode still reads
  // 'fixed' and weather would show on a flexible trip.
  it('forwards the PERSISTED flexible dateInput when the trip is reopened from the dashboard', async () => {
    const flexible = { mode: 'flexible', days: 7, preferredMonth: '2026-09', window: 'moderate' }
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed', dateInput: flexible } } })
      .mockResolvedValueOnce({ data: { data: [] } })

    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.props('dateInput')).toEqual(flexible)
  })

  it('falls back to the wizard\'s own dateInput when the trip payload carries none (legacy trips)', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({ data: { data: [] } })

    const wrapper = mountAtStep4()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect((step.props('dateInput') as { mode: string }).mode).toBe('fixed')
  })

  it('forwards a null weatherAssessment when no orchestrator proposal carries one', async () => {
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

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.props('weatherAssessment')).toBeNull()
  })

  it('forwards the orchestrator proposal\'s restrictionWarnings to TripItineraryStep', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              tripId: VALID_TRIP_UUID, type: 'propose', agent: 'orchestrator', round: 1, timestamp: '',
              content: {
                itinerary: [{ day: 2, date: '2026-08-11', city: 'Braga', activities: [] }],
                restrictionWarnings: [
                  { day: 2, activityName: 'Pilgrimage climb', warningType: 'opening_hours', message: '⚠ "Pilgrimage climb and panoramic visit to Bom Jesus do Monte" opens 8:00 AM-7:00 PM but activity is scheduled at 09:00 on Friday. Check current hours before visiting.' },
                ],
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

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    const restrictionWarnings = step.props('restrictionWarnings') as Array<{ day: number; message: string }>
    expect(restrictionWarnings).toHaveLength(1)
    expect(restrictionWarnings[0]?.day).toBe(2)
    expect(restrictionWarnings[0]?.message).toContain('Check current hours before visiting.')
  })

  it('forwards an empty restrictionWarnings array when no orchestrator proposal carries one', async () => {
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

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    expect(step.props('restrictionWarnings')).toEqual([])
  })
})

// ── Step 5: send PDF by email ───────────────────────────────────

describe('TripInputForm — Step 5 (send PDF by email)', () => {
  const VALID_TRIP_UUID = '11111111-1111-1111-1111-111111111111'

  const mountAtStep5 = async () => {
    const wrapper = mount(TripInputForm, {
      props: { viewTripId: VALID_TRIP_UUID },
      global: {
        plugins: [createPinia()],
        components: { TripItineraryStep },
        stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true, TripItineraryStep: true },
      },
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const step = wrapper.findComponent({ name: 'TripItineraryStep' })
    await step.vm.$emit('accept')
    await wrapper.vm.$nextTick()

    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tripStoreMock.loading  = false
    tripStoreMock.error    = null
    tripStoreMock.lastInput = null
    agentStreamMock.events.value = []
    agentStreamMock.connected.value = false

    mockApiGet
      .mockResolvedValue({ data: { data: { status: 'confirmed' } } })
    mockApiGet
      .mockResolvedValueOnce({ data: { data: { status: 'confirmed' } } })
      .mockResolvedValueOnce({ data: { data: [] } })
  })

  it('pre-fills the email input with the authenticated user\'s email', async () => {
    const wrapper = await mountAtStep5()

    const input = wrapper.find('input[type="email"]')
    expect((input.element as HTMLInputElement).value).toBe(authStoreMock.user.email)
  })

  it('happy path: sends the export payload to the confirmed "to" address and shows success', async () => {
    mockApiPost.mockResolvedValueOnce({ data: { success: true, data: { sent: true } } })
    const wrapper = await mountAtStep5()

    const input = wrapper.find('input[type="email"]')
    await input.setValue('someone-else@example.com')

    const sendBtn = wrapper.findAll('button').find((b) => b.text().includes('Send'))
    expect(sendBtn).toBeTruthy()
    await sendBtn!.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/share/api/v1/export/email',
      expect.objectContaining({ to: 'someone-else@example.com' }),
    )
    expect(wrapper.text()).toContain('Sent to someone-else@example.com')
  })

  it('error path: shows an error message and does not crash when the request rejects', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('network error'))
    const wrapper = await mountAtStep5()

    const sendBtn = wrapper.findAll('button').find((b) => b.text().includes('Send'))
    await sendBtn!.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Failed to send email')
  })
})
