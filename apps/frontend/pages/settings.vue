<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const { t, locale } = useI18n()
const authStore = useAuthStore()

const saving = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)

const SUPPORTED_LANGUAGES = ['en', 'pt'] as const

const onLanguageChange = async (event: Event): Promise<void> => {
  const language = (event.target as HTMLSelectElement).value
  saving.value = true
  saved.value = false
  error.value = null
  try {
    await authStore.updateLanguage(language)
    saved.value = true
  } catch {
    error.value = t('settings.saveError')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <header class="border-b border-line-2 px-6 py-4 flex items-center justify-between">
      <AppLogo :size="20" />
      <NuxtLink to="/dashboard" class="btn text-13">Back</NuxtLink>
    </header>

    <main class="px-6 py-10 max-w-md mx-auto">
      <h2 class="text-22 font-semibold mb-6" style="letter-spacing:-0.02em">{{ t('settings.title') }}</h2>

      <div class="card">
        <label for="language-select" class="text-13 font-medium text-fg-1">{{ t('settings.language') }}</label>
        <p class="text-fg-3 text-12 mt-1 mb-3">{{ t('settings.languageHint') }}</p>

        <select
          id="language-select"
          data-testid="language-select"
          class="btn text-13 w-full"
          :value="authStore.user?.language ?? locale"
          :disabled="saving"
          @change="onLanguageChange"
        >
          <option v-for="lang in SUPPORTED_LANGUAGES" :key="lang" :value="lang">
            {{ t(`languages.${lang}`) }}
          </option>
        </select>

        <p v-if="saved" class="text-13 mt-3" style="color:var(--green)" data-testid="settings-saved">
          {{ t('settings.saved') }}
        </p>
        <p v-if="error" class="text-danger text-13 mt-3" data-testid="settings-error">
          {{ error }}
        </p>
      </div>
    </main>
  </div>
</template>
