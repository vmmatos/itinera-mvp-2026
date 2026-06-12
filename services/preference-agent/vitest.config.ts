import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@itinera/shared': resolve(__dirname, '../shared/src'),
    },
  },
});
