<script setup lang="ts">
definePageMeta({ layout: 'default' })

const authStore = useAuthStore()

onMounted(() => {
  authStore.initFromStorage()
  navigateTo(authStore.isAuthenticated ? '/dashboard' : '/auth/login', { replace: true })
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-fg-3 text-14">Loading...</div>
  </div>
</template>
