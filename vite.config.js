/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // es-toolkit compat shims are patched to ESM via patch-package
  // (see patches/es-toolkit+1.47.0.patch)
  // rxdb excluded: Rolldown CJS→ESM corrompe argumentos de
  // RxReplicationState (collection: undefined).
  // dexie included: fuerza pre-bundling correcto (Rolldown) en vez
  // de la conversion on-the-fly de esbuild que no genera default export.
  optimizeDeps: {
    exclude: ['rxdb'],
    include: ['dexie'],
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
