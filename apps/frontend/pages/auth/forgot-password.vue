<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({ layout: 'auth' })

const authStore = useAuthStore()

const email = ref('')
const submitted = ref(false)

const handleSubmit = async (): Promise<void> => {
  authStore.clearError()
  if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    authStore.error = 'Enter a valid email address.'
    return
  }
  try {
    await authStore.requestPasswordReset(email.value.trim())
    submitted.value = true
  } catch {
    /* error surfaced via authStore.error */
  }
}
</script>

<template>
  <div class="w-full max-w-[400px]">

    <!-- Wordmark -->
    <div class="text-center mb-8" style="display:flex;flex-direction:column;align-items:center;gap:6px">
      <AppLogo :size="28" />
      <p class="text-fg-3 text-13">AI-powered group travel planner</p>
    </div>

    <!-- Card -->
    <div class="card">

      <template v-if="!submitted">
        <h1 class="text-16 font-medium text-fg-0 mb-1">Reset your password</h1>
        <p class="text-fg-3 text-13 mb-5">
          Enter your email and we'll send you a link to choose a new password.
        </p>

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
            <label class="label">Email</label>
            <input
              v-model="email"
              type="email"
              class="input"
              placeholder="you@example.com"
              autocomplete="email"
              maxlength="254"
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
            <span>Send reset link</span>
          </button>
        </form>
      </template>

      <template v-else>
        <h1 class="text-16 font-medium text-fg-0 mb-1">Check your inbox</h1>
        <p class="text-fg-3 text-13">
          If an account exists for <strong class="text-fg-1">{{ email }}</strong>, a password
          reset link is on its way. The link expires in 30 minutes.
        </p>
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
