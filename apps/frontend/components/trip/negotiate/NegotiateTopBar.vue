<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const { t } = useI18n()

const props = defineProps<{
  status: 'negotiating' | 'complete'
  startedAt: number | null
  lastEventAt: number | null
}>()

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (ticker !== null) clearInterval(ticker)
})

function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const s = String(totalSec % 60).padStart(2, '0')
  return `${m}:${s}`
}

const elapsed = computed(() => (props.startedAt ? fmt(now.value - props.startedAt) : '00:00'))
const lastEventSeconds = computed(() => (props.lastEventAt ? Math.max(0, Math.floor((now.value - props.lastEventAt) / 1000)) : 0))
const stateLabel = computed(() => (props.status === 'complete' ? t('trip.negotiate.topBar.complete') : t('trip.negotiate.topBar.systemActive')))
</script>

<template>
  <div style="display:flex;align-items:center;gap:10px;font-size:11px;color:var(--fg-2);text-transform:uppercase;letter-spacing:.08em" class="mono">
    <span style="width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 10px var(--lime)" class="pulse-green" />
    <span data-testid="hb-state">{{ stateLabel }}</span>
    <span style="color:var(--fg-3)">
      · {{ t('trip.negotiate.topBar.lastEvent') }} <b data-testid="hb-last-event" style="color:var(--fg-1);font-weight:500">{{ lastEventSeconds }}s</b> {{ t('trip.negotiate.topBar.ago') }}
      · {{ t('trip.negotiate.topBar.elapsed') }} <b data-testid="hb-elapsed" style="color:var(--fg-1);font-weight:500">{{ elapsed }}</b>
    </span>
  </div>
</template>
