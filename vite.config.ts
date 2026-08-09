import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the same build works on a GitHub Pages project site
  // (user.github.io/repo/), a user site, or any sub-path — no repo name baked in.
  // Safe because the app uses HashRouter, so there are no server-side deep links.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
