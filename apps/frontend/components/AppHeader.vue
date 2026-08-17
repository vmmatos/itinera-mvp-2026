<script setup lang="ts">
import AppLogo from '~/components/AppLogo.vue'
import ThemeToggle from '~/components/ThemeToggle.vue'
import LanguageSwitcher from '~/components/LanguageSwitcher.vue'

withDefaults(
  defineProps<{
    email?: string | null
    showSignOut?: boolean
  }>(),
  { email: null, showSignOut: true },
)

const emit = defineEmits<{ signOut: [] }>()

const { t } = useI18n()
const walkthroughStore = useWalkthroughStore()
const tripStore = useTripPlannerStore()

const restartWalkthrough = (): void => {
  walkthroughStore.restart()
  tripStore.clearLastInput()
  navigateTo('/planner')
}
</script>

<template>
  <header class="border-b border-line-2 px-6 py-4 flex items-center justify-between flex-wrap gap-y-3">
    <AppLogo :size="20" />
    <div class="app-header-right flex items-center gap-3 flex-wrap justify-end">
      <ThemeToggle />
      <LanguageSwitcher />
      <button
        data-testid="how-it-works-btn"
        class="btn text-13"
        @click="restartWalkthrough"
      >{{ t('nav.howItWorks') }}</button>
      <slot name="links" />
      <span
        v-if="email"
        class="text-fg-2 text-13 truncate max-w-[160px] max-[480px]:max-w-[110px]"
      >{{ email }}</span>
      <button
        v-if="showSignOut"
        data-testid="sign-out-btn"
        class="btn text-13"
        @click="emit('signOut')"
      >{{ t('nav.signOut') }}</button>
    </div>
  </header>
</template>
