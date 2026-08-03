<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { t } = useI18n()
const authStore = useAuthStore()

onMounted(() => {
  navigateTo(authStore.isAuthenticated ? '/dashboard' : '/auth/login', { replace: true })
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-fg-3 text-14">{{ t('index.loading') }}</div>
  </div>
</template>
