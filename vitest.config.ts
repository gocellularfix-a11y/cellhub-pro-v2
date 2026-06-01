import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// r-stabilize-1 T2: dedicated test config so the suite doesn't pull in the
// VitePWA / React plugins from vite.config.ts. Pure logic tests run in node.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
