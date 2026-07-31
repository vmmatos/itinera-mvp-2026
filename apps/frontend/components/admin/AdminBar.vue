<script setup lang="ts">
import type { TripDebugData } from '~/types/index'

const { t } = useI18n()

const props = defineProps<{
  trip: TripDebugData | null
  paused: boolean
  connected: boolean
}>()

const emit = defineEmits<{
  togglePause: []
  snapshot: []
}>()

const sessionId = computed(() =>
  props.trip ? `itn_${props.trip.id.slice(0, 6)}` : '—',
)
</script>

<template>
  <div class="admin-bar">
    <div class="lhs">
      <span class="role">{{ t('admin.adminBar.role') }}</span>
      <span class="session">
        <b>{{ trip?.name ?? t('admin.adminBar.selectTrip') }}</b>
        <span class="sep">·</span>
        {{ t('admin.adminBar.session') }} {{ sessionId }}
        <span class="sep">·</span>
        <span :style="{ color: trip?.status === 'negotiating' ? 'var(--green)' : 'var(--fg-3)' }">
          {{ trip?.status ?? '—' }}
        </span>
      </span>
    </div>
    <div class="controls">
      <span
        :class="['ctl', { on: connected }]"
        :title="t('admin.adminBar.sseTitle')"
      >
        {{ connected ? t('admin.adminBar.live') : t('admin.adminBar.idle') }}
      </span>
      <button
        :class="['ctl', { on: paused }]"
        type="button"
        @click="emit('togglePause')"
      >
        {{ paused ? t('admin.adminBar.resume') : t('admin.adminBar.pause') }}
      </button>
      <button class="ctl" type="button" @click="emit('snapshot')">
        {{ t('admin.adminBar.snapshot') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.admin-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--s-6);
  height: 48px;
  border-bottom: var(--hair);
  background: var(--bg-1);
}
.lhs { display: flex; gap: var(--s-6); align-items: center; }
.role {
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--amber);
  border: 1px solid var(--amber-line);
  background: var(--amber-bg);
  padding: 3px 8px;
  text-transform: uppercase;
  letter-spacing: .08em;
}
.session { font-family: var(--mono); font-size: var(--t-13); color: var(--fg-2); }
.session b { color: var(--fg-0); font-weight: 500; }
.sep { color: var(--fg-4); margin: 0 8px; }
.controls {
  display: flex;
  gap: 6px;
  align-items: center;
  font-family: var(--mono);
  font-size: var(--t-12);
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: .08em;
}
.ctl {
  padding: 5px 9px;
  border: var(--hair);
  color: var(--fg-1);
  background: var(--bg-2);
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--t-12);
  text-transform: uppercase;
  letter-spacing: .08em;
}
.ctl.on { border-color: var(--green-line); color: var(--green); background: var(--green-bg); }
</style>
