import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { walkthroughStoreMock, mockCompleteWalkthroughFlow } from '../../../setup'
import type { ItineraryDay } from '~/types/index'

const mockDriverInstance = {
  setSteps: vi.fn().mockReturnThis(),
  drive: vi.fn(),
  destroy: vi.fn(),
}
const mockDriverFactory = vi.fn(() => mockDriverInstance)

vi.mock('driver.js', () => ({
  driver: (...args: unknown[]) => mockDriverFactory(...args),
}))

import ItineraryStep from '~/components/trip/itinerary/ItineraryStep.vue'

function baseProps(overrides: Record<string, unknown> = {}) {
  const timelineDays: ItineraryDay[] = [
    { day: 1, date: 'Sat 12 Jul', city: 'Mértola', activities: [{ name: 'Castle visit', time: 'morning', cost: 18, ownerAgent: 'alice' }] },
  ]
  return {
    tripName: 'Alentejo', region: 'Alentejo', startDate: '2026-07-12', endDate: '2026-07-19',
    dateMode: 'fixed' as const, preferredMonth: '', travellers: 2,
    timelineDays, budgetBreakdown: null, accommodation: [],
    weatherAssessment: null,
    dateInput: { mode: 'fixed' as const, startDate: '2026-07-12', endDate: '2026-07-19' },
    validatorSummary: null,
    travellerScores: [], agentNames: ['alice'],
    exportLoading: false, shareLoading: false, shareCopied: false, exportError: null, shareError: null,
    ...overrides,
  }
}

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ItineraryStep — product walkthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDriverInstance.setSteps.mockReturnThis()
    walkthroughStoreMock.active = false
  })

  it('shows the step-4 explainer anchored to the review header when the walkthrough is active', () => {
    walkthroughStoreMock.active = true
    wrapper = mount(ItineraryStep, { props: baseProps() })

    expect(mockDriverFactory).toHaveBeenCalledWith(expect.objectContaining({ allowClose: false }))
    expect(mockDriverInstance.setSteps).toHaveBeenCalledWith([
      expect.objectContaining({ element: '[data-testid="itinerary-review-header"]' }),
    ])
    expect(mockDriverInstance.drive).toHaveBeenCalledTimes(1)
  })

  it('does not show the explainer when the walkthrough is inactive', () => {
    walkthroughStoreMock.active = false
    wrapper = mount(ItineraryStep, { props: baseProps() })

    expect(mockDriverFactory).not.toHaveBeenCalled()
  })

  it('marks the walkthrough complete when the explainer tour is destroyed, however it closes', () => {
    walkthroughStoreMock.active = true
    wrapper = mount(ItineraryStep, { props: baseProps() })

    const config = mockDriverFactory.mock.calls[0]?.[0] as { onDestroyed: () => void }
    config.onDestroyed()

    expect(mockCompleteWalkthroughFlow).toHaveBeenCalledTimes(1)
  })
})
