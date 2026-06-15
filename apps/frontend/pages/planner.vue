<script setup lang="ts">
definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const router = useRouter()
</script>

<template>
  <div class="min-h-screen bg-bg-0">
    <TripInputForm
      @success="router.push('/dashboard')"
      @cancel="router.push('/dashboard')"
    />
  </div>
</template>
