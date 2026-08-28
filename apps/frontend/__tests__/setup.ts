import { vi } from 'vitest'
import { reactive } from 'vue'
import en from '../i18n/locales/en.json'

// Stub Nuxt auto-imports for all tests.
// Stores/composables use these as globals in Nuxt runtime; tests shim them here.

// ── API mock (overridable per test via mockApiGet/mockApiPost/mockApiPatch) ─
export const mockApiGet   = vi.fn()
export const mockApiPost  = vi.fn()
export const mockApiPatch = vi.fn()

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
export const mockUpdateLanguage = vi.fn()
export const mockUpdateTheme = vi.fn()
export const mockCompleteWalkthrough = vi.fn()
export const authStoreMock = {
  user: { id: 'user-1', name: 'Test User', email: 'test@test.com', role: 'user', language: 'en', theme: 'dark', hasSeenWalkthrough: false },
  token: 'mock-token',
  isAuthenticated: true,
  tryRefresh: vi.fn().mockResolvedValue(true),
  clearSession: vi.fn(),
  updateToken: vi.fn(),
  logout: vi.fn(),
  updateLanguage: mockUpdateLanguage,
  updateTheme: mockUpdateTheme,
  completeWalkthrough: mockCompleteWalkthrough,
}

// ── i18n mock — real lookup against en.json, no vue-i18n instance ─
// Resolves dot-path keys (e.g. "dashboard.title") against the actual English
// dictionary, so component tests asserting rendered English text keep
// passing unchanged once templates switch from literals to t('...') calls.
const lookup = (key: string, params?: Record<string, unknown>): string => {
  const value = key.split('.').reduce<unknown>((obj, part) => {
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[part] : undefined
  }, en)
  const message = typeof value === 'string' ? value : key
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
}
export const mockSetLocale = vi.fn()
export const i18nMock = {
  t: lookup,
  locale: { value: 'en' },
  setLocale: mockSetLocale,
}
// @ts-expect-error global shim
globalThis.useI18n = vi.fn(() => i18nMock)
// @ts-expect-error global shim
globalThis.useNuxtApp = vi.fn(() => ({ $i18n: i18nMock }))

// ── Global shims ───────────────────────────────────────────────
// @ts-expect-error global shim — mirrors apps/frontend/utils/validation.ts
globalThis.isValidUUID = (v: string | null | undefined): boolean =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
// @ts-expect-error global shim
globalThis.useApi = vi.fn(() => ({ get: mockApiGet, post: mockApiPost, patch: mockApiPatch }))
// @ts-expect-error global shim
globalThis.useRuntimeConfig = vi.fn(() => ({ public: { apiBase: 'http://localhost' } }))
export const mockNavigateTo = vi.fn()
// @ts-expect-error global shim
globalThis.navigateTo = mockNavigateTo
// @ts-expect-error global shim
globalThis.useAuthStore = vi.fn(() => authStoreMock)
// @ts-expect-error global shim
globalThis.useTripPlannerStore = vi.fn(() => tripStoreMock)
// @ts-expect-error global shim — page components call this; a no-op is enough under vitest
globalThis.definePageMeta = vi.fn()
// @ts-expect-error global shim — page components read their route params
globalThis.useRoute = vi.fn(() => ({ params: { id: '11111111-1111-1111-1111-111111111111' } }))

// ── useAgentStream shim (returns empty/disconnected by default) ─
export const agentStreamMock = { events: { value: [] }, connected: { value: false } }
// @ts-expect-error global shim
globalThis.useAgentStream = vi.fn(() => agentStreamMock)

// ── matchMedia stub ─────────────────────────────────────────────
// happy-dom has no matchMedia implementation; VueUse's useColorMode
// references it internally even though our store only uses the
// 'dark'/'light' modes (no 'auto'), so it must exist to avoid a throw.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

// ── Theme store mock (overridable per test) ─────────────────────
export const mockToggleTheme = vi.fn()
export const mockSetThemeMode = vi.fn()
export const themeStoreMock = {
  mode: 'dark' as 'dark' | 'light',
  isLight: false,
  setMode: mockSetThemeMode,
  toggle: mockToggleTheme,
}
// @ts-expect-error global shim
globalThis.useThemeStore = vi.fn(() => themeStoreMock)

// ── Walkthrough store mock (overridable per test) ────────────────
export const mockSkipWalkthrough = vi.fn()
export const mockCompleteWalkthroughFlow = vi.fn()
export const mockRestartWalkthrough = vi.fn()
// reactive() so components that `watch(() => walkthroughStore.active, ...)`
// (e.g. dashboard.vue, to re-drive the tour on a same-route replay) actually
// react to a test mutating this after mount, matching real Pinia reactivity.
export const walkthroughStoreMock = reactive({
  active: false,
  skip: mockSkipWalkthrough,
  complete: mockCompleteWalkthroughFlow,
  restart: mockRestartWalkthrough,
})
// @ts-expect-error global shim
globalThis.useWalkthroughStore = vi.fn(() => walkthroughStoreMock)
