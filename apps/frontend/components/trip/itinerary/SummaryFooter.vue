<script setup lang="ts">
const props = defineProps<{
  exportLoading: boolean
  shareLoading: boolean
  shareCopied: boolean
  exportError: string | null
  shareError: string | null
}>()

defineEmits<{ export: []; share: [] }>()
</script>

<template>
  <div class="sum-foot">
    <button class="btn btn-primary" style="justify-content:center;height:42px" :disabled="props.exportLoading" data-testid="export-btn" @click="$emit('export')">
      {{ props.exportLoading ? 'Generating…' : '↓ Export PDF' }}
    </button>
    <button class="btn" style="justify-content:center" :disabled="props.shareLoading" data-testid="share-btn" @click="$emit('share')">
      {{ props.shareCopied ? '✓ Copied!' : props.shareLoading ? 'Generating…' : '⤴ Share link' }}
    </button>
    <p v-if="props.exportError || props.shareError" class="err">{{ props.exportError ?? props.shareError }}</p>
  </div>
</template>

<style scoped>
.sum-foot { padding: var(--s-5); display: flex; flex-direction: column; gap: var(--s-2); }
.err { margin: 0; font-size: var(--t-12); color: var(--red); }
</style>
