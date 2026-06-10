/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // es-toolkit compat shims are patched to ESM via patch-package
  // (see patches/es-toolkit+1.47.0.patch)
  // rxdb excluded from pre-bundling: Rolldown CJS→ESM corrompe
  // argumentos del constructor RxReplicationState (collection: undefined)
  optimizeDeps: {
    exclude: ['rxdb'],
  },
  resolve: {
    // Forzar ESM para rxdb plugins (el CJS shim causa errores con esbuild)
    alias: {
      'rxdb/plugins/replication': 'rxdb/plugins/replication/index.mjs',
      'rxdb/plugins/storage-dexie': 'rxdb/plugins/storage-dexie/index.mjs',
      'rxdb/plugins/migration-schema': 'rxdb/plugins/migration-schema/index.mjs',
    },
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
