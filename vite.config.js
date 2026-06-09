/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'es-toolkit/compat',
      'es-toolkit/compat/get',
      'es-toolkit/compat/range',
      'es-toolkit/compat/omit',
      'es-toolkit/compat/maxBy',
      'es-toolkit/compat/sumBy',
      'es-toolkit/compat/sortBy',
      'es-toolkit/compat/throttle',
      'es-toolkit/compat/last',
      'es-toolkit/compat/isPlainObject',
      'es-toolkit/compat/minBy',
      'es-toolkit/compat/uniqBy',
    ],
  },
  test: {
    exclude: ['tests/**', 'node_modules/**'],
    environment: 'jsdom',
    setupFiles: [],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 35,
        functions: 25,
        branches: 29,
        statements: 34,
      },
    },
  },
})
