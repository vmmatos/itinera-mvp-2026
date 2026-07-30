import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useColorMode } from '@vueuse/core'

type ThemeMode = 'dark' | 'light'

export const useThemeStore = defineStore('theme', () => {
  // Default is always dark, regardless of OS preference — light is opt-in
  // only, reached via toggle() and then persisted under 'itn-theme'.
  const mode = useColorMode<ThemeMode>({
    attribute: 'data-theme',
    storageKey: 'itn-theme',
    initialValue: 'dark',
    modes: { dark: 'dark', light: 'light' },
  })

  // Guard against a malformed/garbage persisted value (e.g. hand-edited
  // localStorage) rather than trusting it blindly.
  if (mode.value !== 'dark' && mode.value !== 'light') {
    mode.value = 'dark'
  }

  const isLight = computed(() => mode.value === 'light')

  const toggle = (): void => {
    mode.value = mode.value === 'light' ? 'dark' : 'light'
  }

  return { mode, isLight, toggle }
})
