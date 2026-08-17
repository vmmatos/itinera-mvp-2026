import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { walkthroughStoreMock, mockSkipWalkthrough, mockFetchTrips } from '../../setup'

const mockDriverInstance = {
  setSteps: vi.fn().mockReturnThis(),
  drive: vi.fn(),
  destroy: vi.fn(),
}
const mockDriverFactory = vi.fn(() => mockDriverInstance)

vi.mock('driver.js', () => ({
  driver: (...args: unknown[]) => mockDriverFactory(...args),
}))

import Dashboard from '~/pages/dashboard.vue'

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('Dashboard — product walkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchTrips.mockResolvedValue(undefined)
    mockDriverInstance.setSteps.mockReturnThis()
    walkthroughStoreMock.active = false
  })

  it('highlights the "Plan a trip" button when the walkthrough is active on mount', () => {
    walkthroughStoreMock.active = true
    wrapper = mount(Dashboard)

    expect(mockDriverFactory).toHaveBeenCalledWith(expect.objectContaining({ allowClose: false }))
    expect(mockDriverInstance.setSteps).toHaveBeenCalledWith([
      expect.objectContaining({ element: '[data-testid="plan-trip-btn"]' }),
    ])
    expect(mockDriverInstance.drive).toHaveBeenCalledTimes(1)
  })

  it('does not highlight anything when the walkthrough is inactive', () => {
    walkthroughStoreMock.active = false
    wrapper = mount(Dashboard)

    expect(mockDriverFactory).not.toHaveBeenCalled()
  })

  it('re-drives the highlight if the walkthrough is restarted while already mounted', async () => {
    walkthroughStoreMock.active = false
    wrapper = mount(Dashboard)
    expect(mockDriverFactory).not.toHaveBeenCalled()

    walkthroughStoreMock.active = true
    await wrapper.vm.$nextTick()

    expect(mockDriverInstance.drive).toHaveBeenCalledTimes(1)
  })

  it('the × close callback skips the walkthrough and destroys the tour', () => {
    walkthroughStoreMock.active = true
    wrapper = mount(Dashboard)

    const config = mockDriverFactory.mock.calls[0]?.[0] as { onCloseClick: () => void }
    config.onCloseClick()

    expect(mockSkipWalkthrough).toHaveBeenCalledTimes(1)
    expect(mockDriverInstance.destroy).toHaveBeenCalledTimes(1)
  })
})
