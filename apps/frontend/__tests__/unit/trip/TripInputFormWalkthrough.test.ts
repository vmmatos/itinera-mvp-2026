import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { walkthroughStoreMock, mockSkipWalkthrough } from '../../setup'

const mockDriverInstance = {
  setSteps: vi.fn().mockReturnThis(),
  drive: vi.fn(),
  destroy: vi.fn(),
  isActive: vi.fn(),
}
const mockDriverFactory = vi.fn(() => mockDriverInstance)

vi.mock('driver.js', () => ({
  driver: (...args: unknown[]) => mockDriverFactory(...args),
}))

import TripInputForm from '~/components/trip/TripInputForm.vue'

const mountForm = () =>
  mount(TripInputForm, {
    global: {
      plugins: [createPinia()],
      stubs: { transition: true, TripTimeline: true, TripActivityCard: true, TripBudgetBreakdown: true, AppLogo: true, TripNegotiateStepV2: true, TripItineraryStep: true },
    },
  })

describe('TripInputForm — product walkthrough', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockDriverInstance.setSteps.mockReturnThis()
    walkthroughStoreMock.active = false
  })

  it('starts the step-1 coach-mark tour on mount when the walkthrough is active', async () => {
    walkthroughStoreMock.active = true
    mountForm()
    await new Promise((r) => setTimeout(r, 0))

    expect(mockDriverFactory).toHaveBeenCalledWith(expect.objectContaining({ allowClose: false }))
    expect(mockDriverInstance.setSteps).toHaveBeenCalledWith([
      expect.objectContaining({ element: '[data-testid="traveller-card"]' }),
      expect.objectContaining({ element: '.persona-card' }),
      expect.objectContaining({ element: '.chip' }),
      expect.objectContaining({ element: '[data-testid="add-traveller"]' }),
    ])
    expect(mockDriverInstance.drive).toHaveBeenCalledTimes(1)
  })

  it('does not start any tour when the walkthrough is inactive (returning user)', async () => {
    walkthroughStoreMock.active = false
    mountForm()
    await new Promise((r) => setTimeout(r, 0))

    expect(mockDriverFactory).not.toHaveBeenCalled()
    expect(mockDriverInstance.drive).not.toHaveBeenCalled()
  })

  it('advancing to step 2 re-drives the tour with step-2 anchors', async () => {
    walkthroughStoreMock.active = true
    const wrapper = mountForm()
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findAll('.persona-card')[0].trigger('click')
    await wrapper.find('[class*="btn-primary"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(mockDriverInstance.setSteps).toHaveBeenLastCalledWith([
      expect.objectContaining({ element: '[data-testid="trip-name"]' }),
      expect.objectContaining({ element: '[data-testid="region"]' }),
      expect.objectContaining({ element: '[data-testid="date-mode-fixed"]' }),
      expect.objectContaining({ element: '[data-testid="budget-slider"]' }),
      expect.objectContaining({ element: '[data-testid="transport-flight"]' }),
      expect.objectContaining({ element: '[data-testid="submit-btn"]' }),
    ])
    expect(mockDriverInstance.drive).toHaveBeenCalledTimes(2)
  })

  it('the × close callback skips the walkthrough and destroys the tour', async () => {
    walkthroughStoreMock.active = true
    mountForm()
    await new Promise((r) => setTimeout(r, 0))

    const config = mockDriverFactory.mock.calls[0]?.[0] as { onCloseClick: () => void }
    config.onCloseClick()

    expect(mockSkipWalkthrough).toHaveBeenCalledTimes(1)
    expect(mockDriverInstance.destroy).toHaveBeenCalledTimes(1)
  })
})
