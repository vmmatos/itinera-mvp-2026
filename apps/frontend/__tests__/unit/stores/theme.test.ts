import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useThemeStore } from '~/stores/theme'

const LS_KEY = 'itn-theme'

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  // ── happy path ──────────────────────────────────────────────

  it('defaults to dark with empty localStorage', () => {
    const store = useThemeStore()

    expect(store.mode).toBe('dark')
    expect(store.isLight).toBe(false)
  })

  it('toggle() flips to light and persists it', async () => {
    const store = useThemeStore()
    store.toggle()
    await nextTick()

    expect(store.mode).toBe('light')
    expect(store.isLight).toBe(true)
    expect(localStorage.getItem(LS_KEY)).toBe('light')
  })

  it('toggle() twice flips back to dark and persists it', async () => {
    const store = useThemeStore()
    store.toggle()
    await nextTick()
    store.toggle()
    await nextTick()

    expect(store.mode).toBe('dark')
    expect(store.isLight).toBe(false)
    expect(localStorage.getItem(LS_KEY)).toBe('dark')
  })

  it('reflects the mode on the <html> data-theme attribute', async () => {
    const store = useThemeStore()
    store.toggle()
    await nextTick()

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  // ── setMode (used by the auth store to apply a server-sourced pref) ──

  it('setMode() applies a colour mode and persists it', async () => {
    const store = useThemeStore()
    store.setMode('light')
    await nextTick()

    expect(store.mode).toBe('light')
    expect(localStorage.getItem(LS_KEY)).toBe('light')
  })

  it('setMode() ignores a value that is neither dark nor light', async () => {
    const store = useThemeStore()
    store.setMode('sepia' as unknown as 'dark' | 'light')
    await nextTick()

    expect(store.mode).toBe('dark')
  })

  // ── persistence / edge cases ────────────────────────────────

  it('honors a previously persisted light choice on store init', () => {
    localStorage.setItem(LS_KEY, 'light')

    const store = useThemeStore()

    expect(store.mode).toBe('light')
    expect(store.isLight).toBe(true)
  })

  it('falls back to dark when localStorage holds a malformed value', () => {
    localStorage.setItem(LS_KEY, 'purple')

    const store = useThemeStore()

    expect(store.mode).toBe('dark')
    expect(store.isLight).toBe(false)
  })
})
