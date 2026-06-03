<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Trip } from '~/types/index'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const authStore = useAuthStore()
const tripStore = useTripPlannerStore()

const showForm = ref(false)

const hasNegotiating = computed(() =>
  tripStore.trips.some((t: Trip) => t.status === 'negotiating'),
)

let pollTimer: ReturnType<typeof setInterval> | null = null

const startPolling = (): void => {
  if (pollTimer !== null) return
  pollTimer = setInterval(() => {
    if (hasNegotiating.value) void tripStore.fetchTrips()
    else stopPolling()
  }, 10_000)
}

const stopPolling = (): void => {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null }
}

const onTripCreated = (_tripId: string): void => {
  showForm.value = false
  void tripStore.fetchTrips()
  startPolling()
}

onMounted(async () => {
  authStore.initFromStorage()
  await tripStore.fetchTrips()
  if (hasNegotiating.value) startPolling()
})

onUnmounted(() => stopPolling())

const statusColour: Record<Trip['status'], string> = {
  draft:       'var(--fg-3)',
  negotiating: 'var(--amber)',
  confirmed:   'var(--green)',
  completed:   'var(--green)',
  cancelled:   'var(--red)',
}
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
    <main class="max-w-5xl mx-auto px-6 py-10">

      <!-- Trip input form (inline) -->
      <TripInputForm
        v-if="showForm"
        class="mb-8"
        @success="onTripCreated"
        @cancel="showForm = false; void tripStore.fetchTrips()"
      />

      <!-- Dashboard header + CTA -->
      <div v-if="!showForm" class="flex items-start justify-between mb-8">
        <div>
          <h2 class="text-28 font-bold">
            Welcome, {{ authStore.user?.name ?? 'Traveller' }}
          </h2>
          <p class="text-fg-3 text-14 mt-1">Plan your next group trip with AI agents.</p>
        </div>
        <button class="btn btn-primary" data-testid="plan-trip-btn" @click="showForm = true">
          Plan a trip <span style="margin-left:4px">→</span>
        </button>
      </div>

      <!-- Trips list -->
      <template v-if="!showForm">
        <!-- Loading -->
        <div v-if="tripStore.loading" class="card flex items-center justify-center py-12">
          <span class="helper pulse-green">Loading trips…</span>
        </div>

        <!-- Error -->
        <div v-else-if="tripStore.error" class="card" style="border-color:rgba(255,93,93,0.32)">
          <p class="text-danger text-13">{{ tripStore.error }}</p>
        </div>

        <!-- Trip rows -->
        <div v-else-if="tripStore.trips.length > 0" class="flex flex-col gap-2">
          <div
            v-for="trip in tripStore.trips"
            :key="trip.id"
            class="card-sm flex items-center justify-between"
          >
            <div>
              <p class="text-15 font-medium">{{ trip.name }}</p>
              <p class="text-fg-3 text-13 mt-1 font-mono">
                {{ trip.region }} · {{ trip.startDate }} → {{ trip.endDate }}
              </p>
            </div>
            <span
              class="badge font-mono"
              :style="`color:${statusColour[trip.status]};background:transparent;border-color:${statusColour[trip.status]}33`"
            >
              {{ trip.status }}
            </span>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="card flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div class="w-12 h-12 rounded-full flex items-center justify-center" style="background: var(--bg-3)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--green)">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <div>
            <p class="text-fg-1 text-15 font-medium">No trips yet</p>
            <p class="text-fg-3 text-13 mt-1">Click "Plan a trip" to get started.</p>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>
