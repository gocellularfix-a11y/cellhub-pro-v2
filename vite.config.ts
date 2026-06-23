import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

// R-PRODUCTION-B6.1: single source of truth for the displayed app version —
// pulled from package.json at build time so the About/Diagnostics screen always
// reflects the real build (no hardcoded version string in the UI).
const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

export default defineConfig(({ mode }) => {
  const isWeb = mode === 'web';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'repair-status.html'],
        manifest: {
          name: 'CellHub Pro',
          short_name: 'CellHub',
          description: 'Professional POS System for Cell Phone Repair Shops',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Cache strategy: app shell cached, Firebase API always fresh
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/repair-status/],
          runtimeCaching: [
            {
              // Firestore — network first, fall back to cache when offline
              urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'firestore-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              // jsDelivr CDN (JsBarcode) — cache first
              urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cdn-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: {
          enabled: false, // don't register SW in dev to avoid cache headaches
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Web build (Netlify/Vercel) → '/', Electron build → './' for file://
    base: isWeb ? '/' : './',
    build: {
      // Web build goes to dist/, Electron build goes to dist-renderer/
      outDir: isWeb ? 'dist' : 'dist-renderer',
      emptyOutDir: true,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/firestore'],
            i18n: ['./src/config/i18n.ts'],
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
