/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'

const base = process.env.BASE_PATH ?? '/'

const manifest: Partial<ManifestOptions> = {
  name: 'Tallyo',
  short_name: 'Spending',
  description: 'Personal finance tracker',
  theme_color: '#f2faf9',
  background_color: '#f2faf9',
  display: 'standalone',
  scope: base,
  start_url: base,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// ponytail: demo mode (GitHub Pages) runs MSW's service worker instead of workbox — they'd fight over the same scope —
// so it gets the install manifest only, without the offline precache.
function demoManifest(): Plugin {
  return {
    name: 'demo-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify({ ...manifest, name: 'Tallyo Demo', short_name: 'Tallyo Demo' }) })
    },
    transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' }],
  }
}

export default defineConfig(({ mode }) => ({
  base,
  cacheDir: 'node_modules/.vite',
  plugins: [
    react(),
    mode === 'demo' ? demoManifest() : VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'apple-touch-icon-teal.png',
        'apple-touch-icon-indigo.png',
        'apple-touch-icon-orange.png',
        'apple-touch-icon-azure.png',
        'apple-touch-icon-maroon.png',
      ],
      manifest,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/authorize/, /^\/auth\//, /^\/token/, /^\/register/, /^\/.well-known/],
        runtimeCaching: [
          {
            // Never cache API calls — financial data must always be fresh
            urlPattern: ({ url }) => url.pathname.endsWith('/query') || url.pathname.includes('/transactions'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/query': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/transactions/import': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/transactions/export': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/auth': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/.well-known': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/register': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/authorize': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
      '/token': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8082', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          charts: ['recharts'],
          graphql: ['@urql/core', 'urql', 'graphql'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    globals: true,
    css: true,
    // CI runs on a shared, often-busy host; give tests headroom above the
    // vitest default (5000ms) so transient contention doesn't flake them.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/mocks/**',
        'src/test/**',
        'src/types/**',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
      thresholds: {
        statements: 81,
        branches: 80,
        functions: 80,
        lines: 81,
      },
    },
  },
}))
