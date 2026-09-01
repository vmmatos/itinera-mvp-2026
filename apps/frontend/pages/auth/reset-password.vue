<script setup lang="ts">
import { computed, onBeforeMount, reactive } from 'vue'

definePageMeta({ layout: 'auth' })

// Stop the reset token leaking to third parties via the Referer header on any
// sub-resource request or outbound navigation from this page.
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const route = useRoute()
const authStore = useAuthStore()

const token = computed(() => {
  const t = route.query['token']
  return typeof t === 'string' && t.length > 0 ? t : null
})

const form = reactive({ password: '', confirm: '' })

// Clear any error left in the store singleton by a previous auth page.
onBeforeMount(() => authStore.clearError())

const handleSubmit = async (): Promise<void> => {
  authStore.clearError()
  if (form.password.length < 8) {
    authStore.error = 'Password must be at least 8 characters.'
    return
  }
  if (form.password !== form.confirm) {
    authStore.error = 'Passwords do not match.'
    return
  }
  if (!token.value) return
  try {
    await authStore.resetPassword(token.value, form.password)
    await navigateTo('/auth/login?reset=success')
  } catch {
    /* error surfaced via authStore.error */
  }
}
</script>

<template>
  <div class="auth-card-wrap">

    <!-- Wordmark -->
    <div class="auth-wordmark text-center mb-8">
      <AppLogo :size="28" />
      <p class="text-fg-3 text-13">AI-powered group travel planner</p>
    </div>

    <!-- Card -->
    <div class="card">

      <template v-if="!token">
        <h1 class="text-16 font-medium text-fg-0 mb-1">Invalid reset link</h1>
        <p class="text-fg-3 text-13 mb-5">
          This link is missing its token. Request a new password reset link to continue.
        </p>
        <NuxtLink to="/auth/forgot-password" class="btn btn-primary w-full justify-center">
          Request a new link
        </NuxtLink>
      </template>

      <template v-else>
        <h1 class="text-16 font-medium text-fg-0 mb-1">Choose a new password</h1>
        <p class="text-fg-3 text-13 mb-5">Enter a new password for your account.</p>

        <!-- Error banner -->
        <Transition name="fade">
          <div
            v-if="authStore.error"
            class="badge badge-red mb-4 w-full justify-start text-13"
            style="padding: var(--s-2) var(--s-3)"
          >
            {{ authStore.error }}
          </div>
        </Transition>

        <form class="space-y-4" novalidate @submit.prevent="handleSubmit">
          <div>
            <label class="label">New password</label>
            <input
              v-model="form.password"
              type="password"
              class="input"
              placeholder="••••••••"
              autocomplete="new-password"
              maxlength="128"
            />
            <p class="text-fg-3 text-13 mt-1">Minimum 8 characters</p>
          </div>

          <div>
            <label class="label">Confirm new password</label>
            <input
              v-model="form.confirm"
              type="password"
              class="input"
              placeholder="••••••••"
              autocomplete="new-password"
              maxlength="128"
            />
          </div>

          <button
            type="submit"
            class="btn btn-primary w-full justify-center"
            :disabled="authStore.loading"
            style="margin-top: var(--s-5)"
          >
            <svg
              v-if="authStore.loading"
              class="animate-spin"
              width="14" height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>Update password</span>
          </button>
        </form>
      </template>

      <div class="divider my-5" />

      <NuxtLink to="/auth/login" class="text-13 text-green hover:underline">
        Back to sign in
      </NuxtLink>

    </div>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
