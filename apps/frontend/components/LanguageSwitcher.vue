<script setup lang="ts">
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'pt', flag: '🇵🇹', name: 'Português' },
] as const

const { t } = useI18n()
const authStore = useAuthStore()

const open = ref(false)
const error = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)

const current = () =>
  LANGUAGES.find((l) => l.code === authStore.user?.language) ?? LANGUAGES[0]

const select = async (code: string): Promise<void> => {
  open.value = false
  if (code === authStore.user?.language) return
  error.value = null
  try {
    await authStore.updateLanguage(code)
  } catch {
    error.value = t('languageSwitcher.error')
  }
}

onClickOutside(root, () => { open.value = false })
</script>

<template>
  <div ref="root" class="lang-switcher">
    <button
      type="button"
      class="lang-toggle"
      :aria-label="t('languageSwitcher.label')"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
      @keydown.escape="open = false"
    >
      <span aria-hidden="true">{{ current().flag }}</span>
    </button>

    <ul v-if="open" class="lang-menu" role="listbox">
      <li v-for="lang in LANGUAGES" :key="lang.code" role="option" :aria-selected="lang.code === authStore.user?.language">
        <button
          type="button"
          class="lang-option"
          :class="{ active: lang.code === authStore.user?.language }"
          @click="select(lang.code)"
        >
          <span aria-hidden="true">{{ lang.flag }}</span>
          <span>{{ lang.name }}</span>
        </button>
      </li>
    </ul>

    <p v-if="error" class="lang-error" data-testid="lang-switcher-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.lang-switcher {
  position: relative;
  flex-shrink: 0;
}

.lang-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: var(--hair);
  background: var(--bg-1);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background 0.1s, border-color 0.1s;
}

.lang-toggle:hover {
  background: var(--bg-2);
  border-color: var(--line-3);
}

.lang-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 148px;
  padding: 4px;
  border-radius: 10px;
  border: var(--hair);
  background: var(--bg-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  list-style: none;
}

.lang-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--fg-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.lang-option:hover {
  background: var(--bg-2);
  color: var(--fg-0);
}

.lang-option.active {
  color: var(--green);
}

.lang-error {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  white-space: nowrap;
  font-size: 12px;
  color: var(--red);
}
</style>
