<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const route = useRoute()
const authStore = useAuthStore()

const tripId = computed(() => route.params.tripId as string)
const tripIdRef = computed(() => tripId.value)

const { data: debugData, loading, error, refresh } = useAdminDebug(tripIdRef)
const { events: liveEvents, connected } = useAgentStream(tripIdRef)

const paused = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

const visibleEvents = computed(() =>
  paused.value ? [] : liveEvents.value,
)

const proposals = computed(() => debugData.value?.proposals ?? [])
const agentLogs = computed(() => debugData.value?.agentLogs ?? [])
const metrics = computed(() => debugData.value?.metrics ?? [])
const scores = computed(() => debugData.value?.scores ?? [])
const trip = computed(() => debugData.value ?? null)

const isNegotiating = computed(() => debugData.value?.status === 'negotiating')

const handleTogglePause = (): void => {
  paused.value = !paused.value
}

const handleSnapshot = (): void => {
  if (!debugData.value) return
  const blob = new Blob([JSON.stringify(debugData.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `debug-${tripId.value.slice(0, 8)}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const startPolling = (): void => {
  if (pollTimer.value !== null) return
  pollTimer.value = setInterval(() => {
    if (isNegotiating.value) void refresh()
    else stopPolling()
  }, 5_000)
}

const stopPolling = (): void => {
  if (pollTimer.value !== null) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

onMounted(() => {
  authStore.initFromStorage()
  if (isNegotiating.value) startPolling()
})

onUnmounted(() => { stopPolling() })
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <header class="border-b border-line-2 px-6 py-4 flex items-center justify-between">
      <AppLogo :size="20" />
      <div class="flex items-center gap-4">
        <span class="text-fg-2 text-13">{{ authStore.user?.email }}</span>
        <NuxtLink
          to="/admin"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--green);border-color:var(--green-line)">
          ← All trips
        </NuxtLink>
        <NuxtLink
          to="/dashboard"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--amber);border-color:var(--amber-line)">
          ← Dashboard
        </NuxtLink>
        <button class="btn text-13" @click="authStore.logout()">Sign out</button>
      </div>
    </header>

  <div class="view on admin">
    <AdminBar
      :trip="trip"
      :paused="paused"
      :connected="connected"
      @toggle-pause="handleTogglePause"
      @snapshot="handleSnapshot"
    />

    <div v-if="loading && !debugData" class="center-state">
      <span class="helper">loading debug data…</span>
    </div>

    <div v-else-if="error" class="center-state">
      <span class="helper" style="color:#ff5d5d">{{ error }}</span>
      <button class="btn" style="margin-top: var(--s-4);" @click="refresh">retry</button>
    </div>

    <template v-else>
      <div class="admin-cols">
        <AdminNegotiationPanel
          :proposals="proposals"
          :live-events="visibleEvents"
          :paused="paused"
        />

        <AdminTimelinePanel
          :proposals="proposals"
          :agent-logs="agentLogs"
          :trip-name="debugData?.name ?? ''"
        />

        <AdminMetricsPanel
          :metrics="metrics"
          :scores="scores"
          :agent-logs="agentLogs"
          :trip-id="tripId"
        />
      </div>

      <AdminAgentActivityLog
        :agent-logs="agentLogs"
        :live-events="visibleEvents"
      />
    </template>
  </div>
  </div>
</template>

<style scoped>
.view.on.admin {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: calc(100vh - 44px);
  min-height: 900px;
}
.admin-cols {
  display: grid;
  grid-template-columns: 340px 1fr 360px;
  grid-template-rows: 1fr;
  min-height: 0;
  overflow: hidden;
}
.center-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: var(--s-10);
}
</style>
