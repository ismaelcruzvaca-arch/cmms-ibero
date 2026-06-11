/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // es-toolkit compat shims are patched to ESM via patch-package
  // (see patches/es-toolkit+1.47.0.patch)
  // dexie import-wrapper.mjs patched to use dist/dexie.mjs (ESM nativo)
  // en vez de dist/dexie.js (CJS/UMD que Rolldown no convierte bien).
  // (see patches/dexie+4.4.2.patch)
  // rxdb excluded: Rolldown CJS→ESM corrompe argumentos del constructor
  // RxReplicationState (collection: undefined). Los index.cjs de los
  // plugins ya fueron parcheados a ESM via patch-package previo.
  optimizeDeps: {
    exclude: ['rxdb'],
  },
  test: {
    exclude: ['tests/**', 'node_modules/**'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    testTimeout: 30000,
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
