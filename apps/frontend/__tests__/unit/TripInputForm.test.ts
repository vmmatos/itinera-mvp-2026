import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// All store/composable globals are shimmed by __tests__/setup.ts.
// Import the shared mocks so we can configure return values per test.
import {
  mockCreateTrip,
  mockFetchTrips,
  tripStoreMock,
  authStoreMock,
} from '../setup'

import TripInputForm from '~/components/trip/TripInputForm.vue'

const mountForm = () =>
  mount(TripInputForm, {
    global: {
      plugins: [createPinia()],
      stubs: { transition: true },
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

  it('step 1 Next button is disabled before persona is selected', () => {
    const wrapper = mountForm()
    const btn = wrapper.find('[class*="btn-primary"]')
    expect(btn.attributes('disabled')).toBeDefined()
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

  it('submit button is disabled when required fields are empty', async () => {
    const wrapper = mountForm()
    await goToStep2(wrapper)

    const submitBtn = wrapper.find('[data-testid="submit-btn"]')
    expect(submitBtn.attributes('disabled')).toBeDefined()
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
    expect(wrapper.text()).toContain('$5,000 ceiling')
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
    expect(payload.startDate).toBe('2026-08-01')
    expect(payload.endDate).toBe('2026-08-08')
    expect(payload.budgetCurrency).toBe('EUR')
    expect(payload.travellers[0].preferences.persona).toBe('culture')

    // submit → step 3 (negotiate); success is emitted later via goToDashboard
    expect(wrapper.text()).toContain('Agents are building your itinerary')
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
