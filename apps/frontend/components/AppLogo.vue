<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<template>
  <div class="logo">
    <svg :width="size ?? 18" :height="size ?? 18" viewBox="0 0 28 28" fill="none">
      <circle cx="6"  cy="14" r="2.4" stroke="var(--green)" stroke-width="1.2"/>
      <circle cx="14" cy="6"  r="2.4" stroke="var(--fg-0)" stroke-width="1.2"/>
      <circle cx="22" cy="14" r="2.4" stroke="var(--fg-0)" stroke-width="1.2"/>
      <circle cx="14" cy="22" r="2.4" stroke="var(--fg-0)" stroke-width="1.2"/>
      <path d="M8 13 L21 15" stroke="var(--green)" stroke-width="1.2"/>
    </svg>
    <span class="word">itinera</span>
  </div>
</template>
