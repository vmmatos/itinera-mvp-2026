<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Trip } from '~/types/index'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const authStore = useAuthStore()
const api = useApi()

const trips = ref<Trip[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const fetchTrips = async (): Promise<void> => {
  loading.value = true
  error.value = null
  try {
    const res = await api.get<{ success: true; data: Trip[] }>('/api/v1/trips')
    trips.value = res.data.data ?? []
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load trips'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  authStore.initFromStorage()
  void fetchTrips()
})
</script>

<template>
  <div class="admin-index">
    <div class="admin-index-head">
      <span class="role">admin</span>
      <h1>debug dashboard</h1>
      <p class="sub">select a trip to inspect its negotiation internals</p>
    </div>

    <div v-if="loading" class="state">loading trips…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="trips.length === 0" class="state">no trips found</div>

    <div v-else class="trip-list">
      <NuxtLink
        v-for="trip in trips"
        :key="trip.id"
        :to="`/admin/${trip.id}`"
        class="trip-card"
      >
        <div class="trip-name">{{ trip.name }}</div>
        <div class="trip-meta">
          <span class="id helper">{{ trip.id.slice(0, 8) }}</span>
          <span
            :class="['badge', trip.status === 'negotiating' ? 'badge-green' : 'badge-blue']"
          >{{ trip.status }}</span>
          <span class="helper">{{ trip.region }}</span>
          <span class="helper">{{ trip.startDate }}</span>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.admin-index {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--s-10) var(--s-6);
}
.admin-index-head {
  margin-bottom: var(--s-8);
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}
.role {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--amber);
  border: 1px solid var(--amber-line);
  background: var(--amber-bg);
  padding: 3px 8px;
  text-transform: uppercase;
  letter-spacing: .08em;
  align-self: flex-start;
}
h1 {
  margin: 0;
  font-size: var(--t-28);
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--fg-0);
}
.sub {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--t-13);
  color: var(--fg-3);
}
.state {
  font-family: var(--mono);
  font-size: var(--t-13);
  color: var(--fg-3);
  padding: var(--s-6) 0;
}
.state.error { color: #ff5d5d; }
.trip-list { display: flex; flex-direction: column; gap: var(--s-2); }
.trip-card {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-4) var(--s-5);
  border: var(--hair);
  background: var(--bg-1);
  text-decoration: none;
  transition: background 0.12s;
}
.trip-card:hover { background: var(--bg-2); border-color: var(--line-3); }
.trip-name {
  font-size: var(--t-15);
  font-weight: 500;
  color: var(--fg-0);
}
.trip-meta {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-3);
}
</style>
