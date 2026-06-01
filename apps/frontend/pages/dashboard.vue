<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'auth' })

const authStore = useAuthStore()

onMounted(() => {
  authStore.initFromStorage()
})
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <!-- Header -->
    <header class="border-b border-line-2 px-6 py-4 flex items-center justify-between">
      <h1 class="text-18 font-semibold tracking-tight" style="color: var(--green)">itinera</h1>
      <div class="flex items-center gap-4">
        <span class="text-fg-2 text-13">{{ authStore.user?.email }}</span>
        <button class="btn text-13" @click="authStore.logout()">Sign out</button>
      </div>
    </header>

    <!-- Main -->
    <main class="max-w-4xl mx-auto px-6 py-12">
      <div class="mb-8">
        <h2 class="text-28 font-bold">Welcome, {{ authStore.user?.name ?? 'Traveller' }}</h2>
        <p class="text-fg-3 text-14 mt-1">Plan your next group trip with AI agents.</p>
      </div>

      <!-- Placeholder -->
      <div class="card flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div class="w-12 h-12 rounded-full flex items-center justify-center" style="background: var(--bg-3)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--green)">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        </div>
        <div>
          <p class="text-fg-1 text-15 font-medium">No trips yet</p>
          <p class="text-fg-3 text-13 mt-1">Trip planning coming soon.</p>
        </div>
      </div>
    </main>
  </div>
</template>
