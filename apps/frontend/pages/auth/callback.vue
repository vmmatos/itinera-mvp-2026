<script setup lang="ts">
import { onMounted } from 'vue'

definePageMeta({ layout: 'auth' })

const route = useRoute()
const authStore = useAuthStore()
const config = useRuntimeConfig()

interface ExchangeUser {
  id: string
  email: string
  name: string
  role: string
  language: string
  theme: string
  hasSeenWalkthrough: boolean
}

onMounted(async () => {
  const code = route.query['code'] as string | undefined
  if (!code) {
    await navigateTo('/auth/login?error=oauth_failed', { replace: true })
    return
  }

  try {
    const resp = await $fetch<{ success: boolean; data: { token: string; user: ExchangeUser } }>(
      `${config.public.apiBase}/api/auth/exchange`,
      { method: 'POST', body: { code } },
    )
    // The exchange response carries the full user (language, theme, walkthrough
    // flag) — the access-token claims do not, so never reconstruct it from the JWT.
    authStore.setFromOAuth({ token: resp.data.token, user: resp.data.user })
    await navigateTo('/', { replace: true })
  } catch {
    await navigateTo('/auth/login?error=oauth_failed', { replace: true })
  }
})
</script>

<template>
  <!-- Centring comes from the auth layout's `.auth-shell`. -->
  <p class="text-fg-3 text-14">Signing you in...</p>
</template>
