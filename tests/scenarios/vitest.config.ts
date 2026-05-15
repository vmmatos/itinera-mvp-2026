import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../services/orchestrator-agent/src'),
      '@itinera/shared': resolve(__dirname, '../../services/shared/src'),
    },
  },
});
