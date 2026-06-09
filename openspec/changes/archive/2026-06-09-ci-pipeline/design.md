# Design: CI/CD Pipeline

## Technical Approach

Dos workflows GitHub Actions orquestan calidad en distintos triggers: **ci.yml** (push a cualquier branch, rápido: lint+build+test) y **ci-full.yml** (PR a main, completo: coverage+E2E+mutation). Coverage con Vitest v8 provider + thresholds. Stryker solo en módulos core. Fix definitivo de recharts agregando subpath faltante (`uniqBy`). Release checklist y rollback documentados en `DEVELOPMENT.md`.

## Architecture Decisions

| # | Decision | Options | Tradeoff | Elección |
|---|----------|---------|----------|----------|
| 1 | **Workflow split** | 1 workflow vs 2 | 1 reduce duplicación pero mezcla tiempos. 2 aísla responsabilidades | **2 workflows** — `ci.yml` rápido (~3 min), `ci-full.yml` completo (~10 min). PR triggers full; push triggers rápido |
| 2 | **Coverage thresholds** | 80 (líneas) vs 60 | Spec dice 60%; task description sugiere 80. 80 es aspiracional pero puede bloquear PRs hoy | **Spec: 60% líneas, 60% funciones, 50% branches, 60% statements**. Se puede subir después |
| 3 | **Stryker scope** | Mutar todo `src/` vs solo core | Mutar todo gasta minutos gratis de GH Actions (~2000/mes) y da poco valor en UI boilerplate | **Solo `src/lib/pdf/`, `src/hooks/useReport*.js`, `src/hooks/useWorkOrders*.js`** — donde hay lógica de negocio real |
| 4 | **Rollback location** | `RELEASE_CHECKLIST.md` vs `DEVELOPMENT.md` | Task description sugiere checklist; spec dice DEVELOPMENT.md | **`DEVELOPMENT.md`** (spec manda). `RELEASE_CHECKLIST.md` cubre pre/post-deploy, sin rollback |
| 5 | **Recharts fix strategy** | optimizeDeps.include manual vs auto-detection | Manual requiere mantener lista. auto no existe en Vite 8 sin plugin externo | **Lista explícita en optimizeDeps.include** + CI build falla si falta algún subpath. Agregar `uniqBy` que estaba omitido |
| 6 | **Stryker config format** | `.mjs` (proposal) vs `.json` | Proposal dice stryker.config.mjs, pero Stryker Vitest runner funciona out-of-box con `.json` o `stryker.conf.js` | **`stryker.config.json`** — más simple, sin necesidad de ESM wrapper. Compatible con `@stryker-mutator/vitest-runner` |

## Data Flow

```mermaid
flowchart LR
    A[Push any branch] --> B[ci.yml]
    B --> C[npm ci]
    C --> D[ESLint]
    D --> E[vitest run]
    E --> F[vite build]

    G[PR to main] --> H[ci-full.yml]
    H --> I[npm ci]
    I --> J[vitest run --coverage]
    J --> K{thresholds?}
    K -- no --> L[❌ fail]
    K -- yes --> M[Playwright E2E]
    M --> N[Stryker mutation (core)]
    N --> O[✅ pass]
```

## File Changes

| File | Acción | Descripción |
|------|--------|-------------|
| `.github/workflows/ci.yml` | Crear | Push: checkout → Node 22 LTS → npm ci → lint → test → build |
| `.github/workflows/ci-full.yml` | Crear | PR a main: coverage thresholds → Playwright E2E → Stryker core |
| `vite.config.js` | Modificar | Agregar `test.coverage` (provider v8, thresholds, include src/) + `uniqBy` a optimizeDeps |
| `package.json` | Modificar | Agregar scripts `test:coverage` y `test:mutation` |
| `stryker.config.json` | Crear | Mutación en `src/lib/pdf/**`, `src/hooks/useReport*.js`, `src/hooks/useWorkOrders*.js` |
| `playwright.config.js` | Modificar | Ajustar webServer timeout a 120s (ya correcto) |
| `RELEASE_CHECKLIST.md` | Crear | Pre-deploy checks → deploy → post-deploy → version tagging |
| `DEVELOPMENT.md` | Modificar | Agregar sección Rollback: Vercel CLI/dashboard, Supabase migration revert, git revert, tag management |

## Interfaces / Contracts

### optimizeDeps.include (cambio focal)
El fix actual omite `es-toolkit/compat/uniqBy`, usado por `recharts/es6/util/payload/getUniqPayload.js`:

```js
// vite.config.js — agregar a optimizeDeps.include:
'es-toolkit/compat/uniqBy',
```

### Scripts npm
```json
"test:coverage": "vitest run --coverage",
"test:mutation": "stryker run"
```

### Stryker config shape
```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "npm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "mutate": [
    "src/lib/pdf/**",
    "src/hooks/useReport*.js",
    "src/hooks/useWorkOrders*.js"
  ],
  "ignorePatterns": ["src/**/__tests__/**", "src/**/*.test.*"]
}
```

## Testing Strategy

| Layer | Qué probar | Cómo |
|-------|-----------|------|
| Unit (coverage) | Thresholds: líneas≥60%, funciones≥60%, branches≥50%, statements≥60% | `vitest run --coverage` con provider v8 |
| Mutation | Mutantes sobreviven en módulos no-core? Stryker solo muta scope definido | `stryker run` con `ignorePatterns` para tests |
| E2E CI | Playwright en Chromium headless, webServer Vite | `npx playwright install chromium --with-deps` + `npm run test:e2e` |
| Verificación CI | build sin errores CJS de recharts/es-toolkit | CI build step — si falta subpath en optimizeDeps, vite build falla |

## Migration / Rollout

No migration requerida. Orden de implementación sugerido:
1. `package.json` scripts + `vite.config.js` (coverage + recharts fix)
2. `stryker.config.json`
3. `playwright.config.js` (verificar webServer timeout)
4. `.github/workflows/ci.yml` y `ci-full.yml`
5. `RELEASE_CHECKLIST.md`
6. `DEVELOPMENT.md` (rollback section)

## Open Questions

- [ ] **Threshold discrepancia**: task description dice `lines: 80`, spec dice 60. Se implementa spec (60). OK o se sube a 80?
- [ ] **Stryker score threshold**: spec dice ≥60%, pero no hay flag de `--thresholds` en Stryker CLI. Se omite threshold en CI full? O se implementa con `--thresholds` en stryker.config.json?
- [ ] **Vercel auto-deploy**: RELEASE_CHECKLIST.md asume Vercel deploy desde main. Confirmar que el proyecto está conectado a Vercel y deploy automático está habilitado.
