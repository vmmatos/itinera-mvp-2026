<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import type { Trip } from '~/types/index'
import { useIdleTimeout } from '~/composables/useIdleTimeout'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const { t } = useI18n()
const authStore = useAuthStore()
const tripStore = useTripPlannerStore()
const walkthroughStore = useWalkthroughStore()

const hasNegotiating = computed(() =>
  tripStore.trips.some((t: Trip) => t.status === 'negotiating'),
)

// Mirrors backend MAX_TRIPS_PER_USER (services/orchestrator/src/config/index.ts).
// Temporary beta guardrail — remove alongside the backend check post-beta.
// No cheap way to read the backend's configured value without a new
// endpoint/field; hardcoded here and kept in sync manually.
const FRONTEND_TRIP_LIMIT = 3

const atTripLimit = computed(() =>
  tripStore.trips.filter((t: Trip) => t.status !== 'cancelled').length >= FRONTEND_TRIP_LIMIT,
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

let dashboardDriver: ReturnType<typeof driver> | null = null

const startDashboardTour = (): void => {
  if (!dashboardDriver) {
    dashboardDriver = driver({
      allowClose: false,
      onCloseClick: () => {
        void walkthroughStore.skip()
        dashboardDriver?.destroy()
      },
    })
  }
  dashboardDriver.setSteps([{
    element: '[data-testid="plan-trip-btn"]',
    popover: {
      title: t('walkthrough.dashboard.planTrip.title'),
      description: t('walkthrough.dashboard.planTrip.description'),
      side: 'bottom',
      align: 'end',
    },
  }])
  dashboardDriver.drive()
}

watch(() => walkthroughStore.active, (active) => { if (active) startDashboardTour() })

onMounted(async () => {
  if (walkthroughStore.active) startDashboardTour()

  await tripStore.fetchTrips()
  if (hasNegotiating.value) startPolling()
})

onUnmounted(() => {
  stopPolling()
  dashboardDriver?.destroy()
})

useIdleTimeout(() => { void authStore.logout() })

const statusColour: Record<Trip['status'], string> = {
  draft:       'var(--fg-3)',
  negotiating: 'var(--amber)',
  confirmed:   'var(--green)',
  completed:   'var(--green)',
  cancelled:   'var(--red)',
}

const AGENTS = [
  { id: 'alice', name: 'Alice', colour: 'var(--green)' },
  { id: 'bob', name: 'Bob', colour: 'var(--amber)' },
  { id: 'carlos', name: 'Carlos', colour: 'var(--blue)' },
  { id: 'diana', name: 'Diana', colour: 'var(--magenta)' },
] as const
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <!-- Header -->
    <AppHeader :email="authStore.user?.email" @sign-out="authStore.logout()">
      <template #links>
        <NuxtLink
          v-if="authStore.isAdmin"
          to="/admin"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--amber);border-color:var(--amber-line)"
        >{{ t('nav.debug') }}</NuxtLink>
      </template>
    </AppHeader>

    <!-- Main -->
    <main class="px-6 py-10">

      <!-- Dashboard header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-22 font-semibold" style="letter-spacing:-0.02em">
            {{ t('dashboard.welcome', { name: authStore.user?.name ?? t('dashboard.travellerFallback') }) }}
          </h2>
          <p class="text-fg-3 text-13 mt-1">{{ t('dashboard.subtitle') }}</p>
          <p v-if="atTripLimit" class="text-fg-3 text-12 mt-1" style="color:var(--amber)">
            {{ t('dashboard.tripLimitHint') }}
          </p>
        </div>
        <button
          class="btn btn-primary"
          data-testid="plan-trip-btn"
          :disabled="atTripLimit"
          @click="tripStore.clearLastInput(); navigateTo('/planner')"
        >
          {{ atTripLimit ? t('dashboard.tripLimitReached') : t('dashboard.planTrip') }} <span style="margin-left:4px">→</span>
        </button>
      </div>

      <!-- Dashboard two-column layout -->
      <div class="user-grid dash-grid">

        <!-- Left: trips -->
        <div class="user-left" style="padding-left:0;padding-top:0">
          <div class="sec-eyebrow" style="margin-bottom:var(--s-5)">{{ t('dashboard.yourTrips') }}</div>

          <!-- Loading -->
          <div v-if="tripStore.loading" class="card flex items-center justify-center py-12">
            <span class="helper pulse-green">{{ t('dashboard.loadingTrips') }}</span>
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
              class="card-sm"
              style="display:grid;grid-template-columns:1fr auto;gap:var(--s-3) var(--s-4);align-items:start"
            >
              <div>
                <p class="text-15 font-medium">{{ trip.name }}</p>
                <p class="text-fg-3 text-12 mt-1 font-mono">{{ trip.region }}</p>
                <p class="text-fg-3 text-12 font-mono" style="margin-top:2px">
                  {{ trip.startDate }} → {{ trip.endDate }}
                </p>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;padding-top:2px">
                <span
                  class="badge font-mono"
                  :style="`color:${statusColour[trip.status]};background:transparent;border-color:${statusColour[trip.status]}33`"
                >{{ trip.status }}</span>
                <NuxtLink
                  v-if="trip.status === 'confirmed' || trip.status === 'completed'"
                  :to="`/trips/${trip.id}`"
                  class="btn text-13"
                  style="padding:4px 12px;font-size:12px"
                >{{ t('dashboard.viewResults') }}</NuxtLink>
              </div>
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
              <p class="text-fg-1 text-15 font-medium">{{ t('dashboard.noTripsYet') }}</p>
              <p class="text-fg-3 text-13 mt-1">{{ t('dashboard.noTripsHint') }}</p>
            </div>
          </div>
        </div>

        <!-- Right: agent roster -->
        <div class="user-right">
          <div class="preview-head">
            <span class="ttl">{{ t('dashboard.meetYourAgents') }}</span>
            <span class="lz">{{ t('dashboard.activeAgents', { count: AGENTS.length }) }}</span>
          </div>

          <div
            v-for="agent in AGENTS"
            :key="agent.id"
            class="summary-card"
            style="margin-bottom:var(--s-4)"
          >
            <div class="sub" :style="`color:${agent.colour}`">{{ t(`dashboard.agents.${agent.id}.tag`) }}</div>
            <h3>{{ agent.name }}</h3>
            <p style="font-size:var(--t-13);color:var(--fg-2);margin:0;line-height:1.6">
              {{ t(`dashboard.agents.${agent.id}.description`) }}
            </p>
          </div>
        </div>

      </div>
    </main>
  </div>
</template>
