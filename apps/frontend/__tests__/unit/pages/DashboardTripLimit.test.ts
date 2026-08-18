import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { tripStoreMock, walkthroughStoreMock, mockFetchTrips } from '../../setup'

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

const tripsWithStatuses = (statuses: string[]): unknown[] =>
  statuses.map((status, i) => ({
    id: `trip-${i}`,
    name: `Trip ${i}`,
    region: 'europe',
    status,
    startDate: '2026-09-01',
    endDate: '2026-09-05',
  }))

describe('Dashboard — beta trip creation limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchTrips.mockResolvedValue(undefined)
    walkthroughStoreMock.active = false
  })

  it('disables the "Plan a trip" button when the user has 3 non-cancelled trips', () => {
    tripStoreMock.trips = tripsWithStatuses(['draft', 'negotiating', 'confirmed'])
    wrapper = mount(Dashboard)

    expect(wrapper.find('[data-testid="plan-trip-btn"]').attributes('disabled')).toBeDefined()
  })

  it('re-enables the button when a cancelled trip frees a slot', () => {
    tripStoreMock.trips = tripsWithStatuses(['draft', 'negotiating', 'cancelled'])
    wrapper = mount(Dashboard)

    expect(wrapper.find('[data-testid="plan-trip-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('stays enabled under the limit', () => {
    tripStoreMock.trips = tripsWithStatuses(['draft', 'negotiating'])
    wrapper = mount(Dashboard)

    expect(wrapper.find('[data-testid="plan-trip-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('shows the trip-limit hint only when at the limit', () => {
    tripStoreMock.trips = tripsWithStatuses(['draft', 'negotiating', 'confirmed'])
    wrapper = mount(Dashboard)

    expect(wrapper.text()).toContain("You've reached the trip limit during this beta.")
  })

  it('does not show the trip-limit hint under the limit', () => {
    tripStoreMock.trips = tripsWithStatuses(['draft'])
    wrapper = mount(Dashboard)

    expect(wrapper.text()).not.toContain("You've reached the trip limit during this beta.")
  })
})
