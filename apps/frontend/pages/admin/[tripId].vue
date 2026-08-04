<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

definePageMeta({
  layout: 'default',
  middleware: 'auth',
})

const { t } = useI18n()
const route = useRoute()
const authStore = useAuthStore()

const tripId = computed(() => route.params.tripId as string)
const tripIdRef = computed(() => tripId.value)

const { data: debugData, loading, error, refresh } = useAdminDebug(tripIdRef)
const { events: liveEvents, connected } = useAgentStream(tripIdRef, 'admin')

const paused = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

const visibleEvents = computed(() =>
  paused.value ? [] : liveEvents.value,
)

const proposals = computed(() => debugData.value?.proposals ?? [])
const agentLogs = computed(() => debugData.value?.agentLogs ?? [])
const metrics = computed(() => debugData.value?.metrics ?? [])
const scores = computed(() => debugData.value?.scores ?? [])
const commits = computed(() => debugData.value?.commits ?? [])
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
  if (isNegotiating.value) startPolling()
})

onUnmounted(() => { stopPolling() })
</script>

<template>
  <div class="min-h-screen bg-bg-0 text-fg-0">
    <AppHeader :email="authStore.user?.email" @sign-out="authStore.logout()">
      <template #links>
        <NuxtLink
          to="/admin"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--green);border-color:var(--green-line)">
          {{ t('admin.tripId.allTrips') }}
        </NuxtLink>
        <NuxtLink
          to="/dashboard"
          class="btn text-13"
          style="font-family:var(--mono);color:var(--amber);border-color:var(--amber-line)">
          {{ t('admin.index.backToDashboard') }}
        </NuxtLink>
      </template>
    </AppHeader>

  <div class="view on admin">
    <AdminBar
      :trip="trip"
      :paused="paused"
      :connected="connected"
      @toggle-pause="handleTogglePause"
      @snapshot="handleSnapshot"
    />

    <div v-if="loading && !debugData" class="center-state">
      <span class="helper">{{ t('admin.tripId.loadingDebugData') }}</span>
    </div>

    <div v-else-if="error" class="center-state">
      <span class="helper" style="color:#ff5d5d">{{ error }}</span>
      <button class="btn" style="margin-top: var(--s-4);" @click="refresh">{{ t('admin.tripId.retry') }}</button>
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
          :commits="commits"
          :trip-name="debugData?.name ?? ''"
        />

        <AdminMetricsPanel
          :metrics="metrics"
          :scores="scores"
          :agent-logs="agentLogs"
          :trip-id="tripId"
        />
      </div>

      <!-- Workflow Engine v2 panel — only shown when workflowState is present -->
      <div
        v-if="debugData?.workflowState"
        style="padding:var(--s-4) var(--s-6);border-top:var(--hair);background:var(--bg-1)"
      >
        <div class="helper" style="margin-bottom:var(--s-3);font-family:var(--mono)">{{ t('admin.tripId.workflowEngineV2') }}</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--s-4) var(--s-8);font-size:var(--t-13)">
          <div>
            <span class="helper">{{ t('admin.tripId.state') }}</span>
            <span style="margin-left:var(--s-2);font-family:var(--mono);color:var(--green)">{{ debugData.workflowState }}</span>
          </div>
          <div v-if="debugData.workflowState === 'FINISH'">
            <span style="color:var(--green);font-family:var(--mono)">✓ {{ t('admin.tripId.finished') }}</span>
          </div>
          <div v-if="debugData.workflowState === 'ASK_REFINEMENT'">
            <span style="color:var(--amber);font-family:var(--mono)">⚠ {{ t('admin.tripId.needsRefinement') }}</span>
          </div>
          <div>
            <span class="helper">{{ t('admin.tripId.proposals') }}</span>
            <span style="margin-left:var(--s-2);font-family:var(--mono)">{{ proposals.length }}</span>
          </div>
          <div v-if="proposals.some(p => p.agent === 'logistics')">
            <span style="color:var(--blue);font-family:var(--mono);font-size:10px">✓ {{ t('admin.tripId.routeGraph') }}</span>
          </div>
          <div v-if="proposals.some(p => p.agent === 'finance' && typeof p.content === 'object' && p.content !== null && 'perBlock' in p.content)">
            <span style="color:var(--amber);font-family:var(--mono);font-size:10px">✓ {{ t('admin.tripId.budgetPlan') }}</span>
          </div>
          <div v-if="proposals.some(p => p.agent === 'alice' || p.agent === 'bob' || p.agent === 'carlos' || p.agent === 'diana')">
            <span style="color:var(--green);font-family:var(--mono);font-size:10px">✓ {{ t('admin.tripId.touristProposals') }}</span>
          </div>
          <div v-if="proposals.some(p => p.agent === 'orchestrator' && typeof p.content === 'object' && p.content !== null && 'itinerary' in p.content)">
            <span style="color:var(--fg-0);font-family:var(--mono);font-size:10px">✓ {{ t('admin.tripId.mergedItinerary') }}</span>
          </div>
        </div>
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
