import { vi } from 'vitest'

// Stub Nuxt auto-imports for all tests.
// Stores/composables use these as globals in Nuxt runtime; tests shim them here.

// ── API mock (overridable per test via mockApiGet/mockApiPost) ─
export const mockApiGet  = vi.fn()
export const mockApiPost = vi.fn()

// ── Trip planner store mock (overridable per test) ─────────────
export const mockCreateTrip = vi.fn()
export const mockFetchTrips = vi.fn()
export const mockClearError = vi.fn()
export const mockSetCurrentTrip = vi.fn()

export const tripStoreMock = {
  loading: false,
  error: null as string | null,
  trips: [] as unknown[],
  currentTrip: null,
  createTrip: mockCreateTrip,
  fetchTrips: mockFetchTrips,
  clearError: mockClearError,
  setCurrentTrip: mockSetCurrentTrip,
}

// ── Auth store mock ────────────────────────────────────────────
export const authStoreMock = {
  user: { id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user' },
  isAuthenticated: true,
  initFromStorage: vi.fn(),
  logout: vi.fn(),
}

// ── Global shims ───────────────────────────────────────────────
// @ts-expect-error global shim
globalThis.useApi = vi.fn(() => ({ get: mockApiGet, post: mockApiPost }))
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))
// @ts-expect-error global shim
globalThis.navigateTo = vi.fn()
// @ts-expect-error global shim
globalThis.useAuthStore = vi.fn(() => authStoreMock)
// @ts-expect-error global shim
globalThis.useTripPlannerStore = vi.fn(() => tripStoreMock)
