<script setup lang="ts">
const theme = useThemeStore()
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="theme.isLight ? 'Switch to dark mode' : 'Switch to light mode'"
    :title="theme.isLight ? 'Switch to dark mode' : 'Switch to light mode'"
    @click="theme.toggle()"
  >
    <svg v-if="theme.isLight" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.5 12H2M22 12h-2.5M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </svg>
    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: var(--hair);
  background: var(--bg-1);
  color: var(--fg-2);
  cursor: pointer;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
  flex-shrink: 0;
}

.theme-toggle:hover {
  background: var(--bg-2);
  color: var(--fg-0);
  border-color: var(--line-3);
}
</style>
