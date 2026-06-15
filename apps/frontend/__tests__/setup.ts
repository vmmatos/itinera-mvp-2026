import { vi } from 'vitest'

// Stub Nuxt auto-imports for all tests.
// Stores/composables use these as globals in Nuxt runtime; tests shim them here.

// ── API mock (overridable per test via mockApiGet/mockApiPost) ─
export const mockApiGet  = vi.fn()
export const mockApiPost = vi.fn()

// ── Trip planner store mock (overridable per test) ─────────────
export const mockCreateTrip    = vi.fn()
export const mockFetchTrips    = vi.fn()
export const mockClearError    = vi.fn()
export const mockSetCurrentTrip = vi.fn()
export const mockSetLastInput  = vi.fn()
export const mockClearLastInput = vi.fn()

export const tripStoreMock = {
  loading: false,
  error: null as string | null,
  trips: [] as unknown[],
  currentTrip: null,
  lastInput: null as unknown,
  createTrip: mockCreateTrip,
  fetchTrips: mockFetchTrips,
  clearError: mockClearError,
  setCurrentTrip: mockSetCurrentTrip,
  setLastInput: mockSetLastInput,
  clearLastInput: mockClearLastInput,
}

// ── Auth store mock ────────────────────────────────────────────
export const authStoreMock = {
  user: { id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user' },
  token: 'mock-token',
  isAuthenticated: true,
  tryRefresh: vi.fn().mockResolvedValue(true),
  clearSession: vi.fn(),
  updateToken: vi.fn(),
  logout: vi.fn(),
}

// ── Global shims ───────────────────────────────────────────────
// @ts-expect-error global shim — mirrors apps/frontend/utils/validation.ts
globalThis.isValidUUID = (v: string | null | undefined): boolean =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
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

// ── useAgentStream shim (returns empty/disconnected by default) ─
export const agentStreamMock = { events: { value: [] }, connected: { value: false } }
// @ts-expect-error global shim
globalThis.useAgentStream = vi.fn(() => agentStreamMock)
