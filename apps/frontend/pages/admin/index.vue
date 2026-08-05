<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Trip } from '~/types/index'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const { t } = useI18n()
const authStore = useAuthStore()
const api = useApi()

const trips = ref<Trip[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')

const filteredTrips = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return trips.value
  return trips.value.filter((t) => {
    const name = (t.ownerName ?? '').toLowerCase()
    const email = (t.ownerEmail ?? '').toLowerCase()
    return name.includes(q) || email.includes(q)
  })
})

const STATUS_BADGE: Record<Trip['status'], string> = {
  draft:       'badge-blue',
  negotiating: 'badge-amber',
  confirmed:   'badge-green',
  completed:   'badge-green',
  cancelled:   'badge-red',
}

const fetchTrips = async (): Promise<void> => {
  loading.value = true
  error.value = null
  try {
    const res = await api.get<{ success: true; data: Trip[] }>('/api/v1/trips?view=admin')
    trips.value = res.data.data ?? []
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('admin.index.loadTripsFailed')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void fetchTrips()
})
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
  <AppHeader :email="authStore.user?.email" @sign-out="authStore.logout()">
      <template #links>
        <NuxtLink
          to="/dashboard"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--amber);border-color:var(--amber-line)">
          {{ t('admin.index.backToDashboard') }}
        </NuxtLink>
      </template>
    </AppHeader>

  <div class="admin-index">
    <div class="admin-index-head">
      <span class="role">{{ t('admin.adminBar.role') }}</span>
      <h1>{{ t('admin.index.debugDashboard') }}</h1>
      <p class="sub">{{ t('admin.index.selectTripHint') }}</p>
    </div>

    <div v-if="loading" class="state">{{ t('admin.index.loadingTrips') }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>

    <template v-else>
      <div class="search-row">
        <input
          v-model="search"
          type="text"
          class="search-input"
          :placeholder="t('admin.index.searchPlaceholder')"
          autocomplete="off"
          maxlength="200"
        />
        <span class="search-count helper">
          {{ t('admin.index.tripsCount', { filtered: filteredTrips.length, total: trips.length }) }}
        </span>
      </div>

      <div v-if="filteredTrips.length === 0" class="state">{{ t('admin.index.noTripsFound') }}</div>

      <div v-else class="trip-list">
        <NuxtLink
          v-for="trip in filteredTrips"
          :key="trip.id"
          :to="`/admin/${trip.id}`"
          class="trip-card"
        >
          <div class="trip-card-top">
            <span class="trip-name">{{ trip.name }}</span>
            <span v-if="trip.ownerName || trip.ownerEmail" class="trip-owner">
              {{ trip.ownerName ?? '' }}<template v-if="trip.ownerName && trip.ownerEmail"> · </template>{{ trip.ownerEmail ?? '' }}
            </span>
          </div>
          <div class="trip-meta">
            <span class="id helper">{{ trip.id.slice(0, 8) }}</span>
            <span
              :class="['badge', STATUS_BADGE[trip.status] ?? 'badge-blue']"
            >{{ trip.status }}</span>
            <span class="helper">{{ trip.region }}</span>
            <span class="helper">{{ trip.startDate }}</span>
          </div>
        </NuxtLink>
      </div>
    </template>
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
.search-row {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  margin-bottom: var(--s-4);
}
.search-input {
  flex: 1;
  background: var(--bg-1);
  border: var(--hair);
  color: var(--fg-0);
  font-family: var(--mono);
  font-size: var(--t-13);
  padding: var(--s-2) var(--s-3);
  outline: none;
  transition: border-color 0.12s;
}
.search-input:focus { border-color: var(--line-3); }
.search-input::placeholder { color: var(--fg-3); }
.search-count {
  white-space: nowrap;
  font-size: var(--t-12);
}
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
.trip-card-top {
  display: flex;
  align-items: baseline;
  gap: var(--s-3);
}
.trip-name {
  font-size: var(--t-15);
  font-weight: 500;
  color: var(--fg-0);
}
.trip-owner {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--amber);
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
