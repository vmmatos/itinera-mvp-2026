<script setup lang="ts">
definePageMeta({ layout: 'auth' })

type Mode = 'login' | 'register'

const route = useRoute()
const authStore = useAuthStore()

const mode = ref<Mode>('login')
const form = reactive({
  email: '',
  password: '',
  name: ''
})

const oauthError = computed(() => {
  const err = route.query['error']
  if (err === 'oauth_failed') return 'Google sign-in failed. Please try again.'
  return null
})

const resetSuccess = computed(() => route.query['reset'] === 'success')

watch(mode, () => {
  authStore.clearError()
  form.password = ''
})

const handleSubmit = async (): Promise<void> => {
  authStore.clearError()
  if (mode.value === 'register' && !form.name.trim()) {
    authStore.error = 'Name is required.'
    return
  }
  if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    authStore.error = 'Enter a valid email address.'
    return
  }
  if (!form.password) {
    authStore.error = 'Password is required.'
    return
  }
  if (mode.value === 'register' && form.password.length < 8) {
    authStore.error = 'Password must be at least 8 characters.'
    return
  }
  if (mode.value === 'login') {
    await authStore.login(form.email, form.password)
  } else {
    await authStore.register(form.email, form.password, form.name)
  }
}

const errorMessage = computed(() => oauthError.value ?? authStore.error)
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

      <!-- Mode tabs -->
      <div class="flex mb-5" style="border-bottom: var(--hair)">
        <button
          class="flex-1 pb-3 text-14 font-medium transition-colors"
          :class="mode === 'login' ? 'text-fg-0' : 'text-fg-3 hover:text-fg-1'"
          :style="mode === 'login' ? 'border-bottom: 2px solid var(--green); margin-bottom: -1px' : ''"
          @click="mode = 'login'"
        >
          Sign in
        </button>
        <button
          class="flex-1 pb-3 text-14 font-medium transition-colors"
          :class="mode === 'register' ? 'text-fg-0' : 'text-fg-3 hover:text-fg-1'"
          :style="mode === 'register' ? 'border-bottom: 2px solid var(--green); margin-bottom: -1px' : ''"
          @click="mode = 'register'"
        >
          Register
        </button>
      </div>

      <!-- Password-reset success banner -->
      <Transition name="fade">
        <div
          v-if="resetSuccess && !errorMessage"
          class="badge badge-green mb-4 w-full justify-start text-13"
          style="padding: var(--s-2) var(--s-3)"
        >
          Password updated — please sign in.
        </div>
      </Transition>

      <!-- Error banner -->
      <Transition name="fade">
        <div
          v-if="errorMessage"
          class="badge badge-red mb-4 w-full justify-start text-13"
          style="padding: var(--s-2) var(--s-3)"
        >
          {{ errorMessage }}
        </div>
      </Transition>

      <!-- Form -->
      <form class="space-y-4" novalidate @submit.prevent="handleSubmit">

        <!-- Name — register only -->
        <Transition name="fade">
          <div v-if="mode === 'register'">
            <label class="label">Name</label>
            <input
              v-model="form.name"
              type="text"
              class="input"
              placeholder="Your name"
              autocomplete="name"
              maxlength="255"
            />
          </div>
        </Transition>

        <!-- Email -->
        <div>
          <label class="label">Email</label>
          <input
            v-model="form.email"
            type="email"
            class="input"
            placeholder="you@example.com"
            autocomplete="email"
            maxlength="254"
          />
        </div>

        <!-- Password -->
        <div>
          <label class="label">Password</label>
          <input
            v-model="form.password"
            type="password"
            class="input"
            placeholder="••••••••"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            maxlength="128"
          />
          <p v-if="mode === 'register'" class="text-fg-3 text-13 mt-1">Minimum 8 characters</p>
          <div v-else class="text-right mt-1">
            <NuxtLink to="/auth/forgot-password" class="text-13 text-fg-3 hover:text-fg-1">
              Forgot password?
            </NuxtLink>
          </div>
        </div>

        <!-- Submit -->
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
          <span>{{ mode === 'login' ? 'Sign in' : 'Create account' }}</span>
        </button>

      </form>

      <!-- Divider -->
      <div class="relative my-5">
        <hr class="divider" style="margin: 0" />
        <span class="absolute inset-0 flex items-center justify-center">
          <span class="px-3 text-fg-3 text-13" style="background: var(--bg-2)">or</span>
        </span>
      </div>

      <!-- Google OAuth2 -->
      <button
        class="btn w-full justify-center gap-2"
        @click="authStore.loginWithGoogle()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

    </div>

    <!-- Footer -->
    <p class="text-center text-fg-3 text-13 mt-5">
      Multi-agent AI travel planning
    </p>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
