import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  // Relative base so the same build works on a GitHub Pages project site
  // (user.github.io/repo/), a user site, or any sub-path — no repo name baked in.
  // Safe because the app uses hash-based routing, so there are no server-side deep links.
  base: './',
  plugins: [react()],
  build: {
    // bwip-js is ~1 MB raw: it carries the encoder tables for every symbology it
    // supports and offers no per-symbology entry point. Splitting it out means an
    // app update does not invalidate it in the browser cache.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'barcode', test: /node_modules[\\/]bwip-js/ },
            { name: 'canvas', test: /node_modules[\\/]fabric/ },
          ],
        },
      },
    },
  },
  test: {
    projects: [
      {
        // Pure logic: geometry, packing, compression, protocol. Fast, no DOM.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        // Anything that touches a real canvas. Rasterising text and barcodes in
        // jsdom or node-canvas would test a different renderer than the one that
        // ships, which for scannability questions is worse than not testing at all.
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.browser.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
