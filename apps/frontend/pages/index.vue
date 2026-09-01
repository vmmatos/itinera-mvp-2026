<script setup lang="ts">
// `plugins/auth.client.ts` has already resolved the silent refresh by the time
// this middleware runs, so `isAuthenticated` is correct even on a hard load with
// a valid refresh cookie — no more bouncing a real session to /auth/login.
definePageMeta({
  layout: 'default',
  middleware: () => {
    if (import.meta.server) return
    const authStore = useAuthStore()
    return navigateTo(authStore.isAuthenticated ? '/dashboard' : '/auth/login', { replace: true })
  },
})

const { t } = useI18n()
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-fg-3 text-14">{{ t('index.loading') }}</div>
  </div>
</template>
