# Exploration: CI/CD Pipeline para CMMS Ibero

**Date**: 2026-06-09
**Project**: cmms-ibero
**Mode**: hybrid (openspec + engram)
**Skill Resolution**: none — no registry search needed (single-agent explore)

---

## 1. Estado Actual del Proyecto

### Scripts Disponibles (package.json)

| Script | Comando | ¿Existe? |
|--------|---------|----------|
| `dev` | `vite` | ✅ |
| `build` | `vite build` | ✅ |
| `prebuild` | `node scripts/pre-build-check.js` | ✅ |
| `lint` | `eslint .` | ✅ |
| `preview` | `vite preview` | ✅ |
| `test` | `vitest run` | ✅ |
| `test:watch` | `vitest` | ✅ |
| `test:e2e` | `playwright test` | ✅ |
| `test:e2e:ui` | `playwright test --ui` | ✅ |
| `test:e2e:headed` | `playwright test --headed` | ✅ |

**Ausencias notables**:
- ❌ No hay script `test:coverage`
- ❌ No hay script `test:mutation`
- ❌ No hay script `ci` o `test:ci`

### GitHub

- **No existe directorio `.github/`** — cero workflows, cero templates
- **Remote**: `origin → https://github.com/ismaelcruzvaca-arch/cmms-ibero.git`
- **Rama principal**: `main` (monorepo, sin `develop`)
- **Branches remotas existentes**:
  - `main` (default)
  - `feat/mechanic-work-order-list`
  - `feat/pm-rcm-core-schema`
  - `fmea-wizard`
  - `review/pm-rcm-core-schema`
  - `frontend` (legacy)

### Vercel

- **Proyecto vinculado**: `cmms-ibero` (ID: `prj_SBbv9KTO1tRPHMpBaitCIhz2QNta`)
- **Org ID**: `team_zFB2wG8CgvmVjx1fosClWiK8`
- **No existe `vercel.json`** — se usa auto-detection de Vite (framework preset)
- **Auto-deploy desde `main`**: activo por defecto al linkear
- **Preview Deployments**: no configurados explícitamente
- **Edge Functions**: 7 funciones en `supabase/functions/` (Deno)
  - `compute-hi`, `epicor-webhook`, `generate-pdf`, `ingest-condition`, `ingest-events`, `oee-trigger`, `send-report`

### Build

- **Comando**: `npm run build` → `vite build`
- **Duración**: ~15 segundos
- **Output**: `dist/` (Vite 8 con Rolldown como bundler)
- **Advertencias actuales**:
  - Chunks >500KB (principal: 2MB gzip: 596KB)
  - Dynamic import ineficaz en `useConditionCapture.js`
  - Tiempo elevado en plugin `vite-resolve` (84% del build time)

### Tests

#### Unitarios / Integración (Vitest)
- **Runner**: Vitest v4.1.8
- **Entorno**: jsdom (v29)
- **Setup files**: `[]` (vacío)
- **Exclude**: `tests/**` (E2E)
- **Resultados**: ✅ 37 suites, 540 tests, todos PASS
- **Duración total**: ~435s (7.3 min) — pero el tiempo de import (1788s reportado) sugiere overhead de pool workers)
- **Archivos de test**: 45 archivos `*.test.*` en `src/`

#### E2E (Playwright)
- **Runner**: Playwright v1.59.1
- **Browser**: Solo Chromium (Desktop Chrome)
- **TestDir**: `tests/`
- **Archivos**: 2 specs (`home.spec.js`, `work-orders-schema.spec.js`)
- **WebServer**: `npm run dev` → `http://localhost:5173`
- **Timeouts**: 30s por test, 120s para webServer

### Linter

- **Tool**: ESLint v10.2.1
- **Config**: `eslint.config.js` (flat config)
- **Plugins**: `react-hooks`, `react-refresh`
- **Globals**: browser
- **Ignora**: `dist/`

---

## 2. Recharts / es-toolkit CJS Error — Root Cause & Fix

### Root Cause

```
recharts@3.8.1
  └── es-toolkit@^1.39.3 → 1.47.0 installada
```

recharts 3.x reemplazó lodash por es-toolkit como utility library. Utiliza deep subpath imports como:

```js
import get from 'es-toolkit/compat/get'
import range from 'es-toolkit/compat/range'
```

El `package.json` de es-toolkit@1.47.0 exporta:

```json
"./compat/*": {
  "default": {
    "types": "./compat/*.d.ts",
    "default": "./compat/*.js"
  }
}
```

Estos `./compat/*.js` son archivos CJS (CommonJS). Vite en dev mode intenta servir módulos ESM directamente. Cuando encuentra un subpath CJS profundo que no está pre-bundled, el módulo entra sin transformar al graph de Vite, causando el error:

> `Uncaught TypeError: require_isUnsafeProperty is not a function`

### Fix Aplicado (commit 87bbc69)

```js
// vite.config.js
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
  ],
}
```

Forzar el pre-bundling de cada subpath que recharts necesita resuelve el problema.

### Alternative Fixes

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **Actual**: `optimizeDeps.include` explícito | Ya funciona, probado | Mantenimiento manual si recharts agrega imports | ✅ Bajo |
| `optimizeDeps.include: ['es-toolkit/compat/*']` | Glob matchea todos | No soportado por Vite 8 | Bajo (no funciona) |
| Downgrade recharts a 2.x | Elimina dependencia de es-toolkit | Pierde features, breaking changes | Alto |
| Patch recharts con pnpm patch | Sin tocar config Vite | Fragil, se pierde en reinstall | Medio |

**Recomendación**: Mantener el fix actual. Si en CI se reproduce, el `optimizeDeps.include` aplica tanto en dev como en test, así que no debería fallar.

---

## 3. GitHub Actions — Propuesta de Workflow

### Estado actual
❌ No existe `.github/workflows/` — todo por crear.

### Runners necesarios
- **`ubuntu-latest`** suficiente para: Vite, Vitest, Playwright, ESLint
- No necesita Windows (el dev es Windows pero CI corre Linux)
- No necesita self-hosted (gh hosted es suficiente)

### Workflows propuestos

| Workflow | Trigger | Jobs | Tiempo estimado |
|----------|---------|------|-----------------|
| **CI** | `push` a `main`, `pull_request` a `main` | lint, build, test (unit+e2e) | ~10-15 min |
| **Coverage** | `push` a `main` | test --coverage, upload artifact | ~10-15 min |
| **Mutation** | manual / schedule semanal | stryker run | ~30-60 min |

### CI Workflow (recomendado)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --reporter=junit --outputFile=results.xml
      - uses: dorny/test-reporter@v1
        if: success() || failure()
        with:
          name: Vitest Results
          path: results.xml
          reporter: java-junit

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: test-results/
```

---

## 4. Stryker Mutation Testing

### Estado
❌ No instalado — `@stryker-mutator/core` y `@stryker-mutator/vitest-runner` no están en el proyecto.

### Últimas versiones disponibles
- `@stryker-mutator/core@9.6.1`
- `@stryker-mutator/vitest-runner@9.6.1`

### Configuración necesaria

Archivo: `stryker.config.mjs`

```js
// @ts-check
/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  packageManager: 'npm',
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.js' },
  mutate: ['src/**/*.{js,jsx}', '!src/**/__tests__/**'],
  reporters: ['progress', 'html', 'dashboard'],
  htmlReporter: { baseDir: 'reports/mutation' },
  thresholds: { high: 80, low: 60 },
  concurrency: 4,  // Ajustar según CI cores
};
```

### Estimación de tiempo

| Factor | Valor |
|--------|-------|
| Archivos fuente | 93 archivos, ~23,573 líneas |
| Tests existentes | 540 (37 suites) |
| Mutantes estimados | ~3,000–5,000 (aprox 15-20% de líneas generan mutantes) |
| Tiempo estimado (local) | 15-30 min |
| Tiempo estimado (CI 4-core) | 30-60 min |

**Riesgo**: Stryker es lento. Para un proyecto de este tamaño, se recomienda:
1. Ejecutar solo en `push` a `main` (no en cada PR)
2. Usar `--mutate` con paths específicos si se quiere feedback rápido
3. Considerar ejecución semanal programada en vez de por PR

### Dependencias a instalar
```
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
```

---

## 5. Coverage con Vitest

### Estado
❌ `@vitest/coverage-v8` no instalado. No hay configuración de coverage.

### Proveedores disponibles

| Proveedor | Package | Velocidad | Precisión |
|-----------|---------|-----------|-----------|
| **v8** | `@vitest/coverage-v8@4.1.8` | 🔥 Rápido (nativo V8) | Buena |
| **istanbul** | `@vitest/coverage-istanbul@4.1.8` | 🐢 Más lento | Mejor (babel transform) |

### Configuración necesaria

En `vite.config.js`:

```js
test: {
  // ...existing config...
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html', 'lcov'],
    reportsDirectory: './coverage',
    include: ['src/**/*.{js,jsx}'],
    exclude: [
      'src/**/__tests__/**',
      'src/**/*.test.*',
      'src/main.jsx',
    ],
    thresholds: {
      lines: 60,
      functions: 60,
      branches: 50,
      statements: 60,
    },
  },
}
```

### Dependencias a instalar
```
npm install --save-dev @vitest/coverage-v8
```

### Script sugerido
```json
"test:coverage": "vitest run --coverage"
```

### Estimación de tiempo
- **Local**: ~8-10 min (los 540 tests + transform coverage)
- **CI**: similar, quizás más rápido por más cores

---

## 6. Playwright en CI

### Estado actual
- Playwright v1.59.1 instalado como devDependency
- Config: solo Chromium, headless por defecto
- Ya usa `webServer` que arranca Vite dev server automáticamente
- Base URL: `http://localhost:5173`

### Requerimientos para CI

1. **Instalar browsers**: `npx playwright install chromium --with-deps`
   - `--with-deps` instala system dependencies de Linux (libgtk, libnss, etc.)
2. **Headless**: Chromium corre headless por defecto ✅ (no hay `--headed` en CI)
3. **WebServer**: El `webServer` en la config arranca `npm run dev` → `localhost:5173`
   - En CI el puerto 5173 debe estar libre ✅
   - Timeout de 120s suficiente ✅
4. **Reportes**: Subir `test-results/` como artifact si falla

### Workflow fragment
```yaml
- run: npx playwright install chromium --with-deps
- run: npm run test:e2e
- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: playwright-report
    path: test-results/
```

### Tiempo estimado
- Install browsers: ~30-60s (cached después del primer run)
- E2E tests actuales (2 specs): ~30-60s
- **Total job**: ~3-5 min (incluye setup + build)

---

## 7. Release Checklist

**Estado**: ❌ No existe `RELEASE_CHECKLIST.md` ni documento similar.

Basado en el modelo Producción Ibarra, la checklist debería cubrir:

### Pre-Release
- [ ] Todos los tests pasan: `npm test`
- [ ] Coverage mínimo cumple threshold: `npm run test:coverage`
- [ ] Linter sin errores: `npm run lint`
- [ ] Build exitoso: `npm run build`
- [ ] E2E tests pasan: `npm run test:e2e`
- [ ] Changelog actualizado
- [ ] Versión bump en `package.json` (semver)

### Deploy
- [ ] Merge a `main`
- [ ] CI pasa en `main` (último commit)
- [ ] Vercel deploy exitoso (auto-deploy desde `main`)
- [ ] Smoke test en producción:
  - [ ] Login funciona
  - [ ] Página principal carga
  - [ ] Work Orders se listan
  - [ ] PDF exports funcionales
  - [ ] Sincronización RxDB funcional
- [ ] Sentry verifica que no hay nuevos errores

### Post-Release
- [ ] Monitorear Sentry las primeras 24h
- [ ] Verificar Edge Functions (Supabase)
- [ ] Notificar al equipo (si aplica)

---

## 8. Rollback Procedure

**Estado**: ❌ No documentado.

### Vercel Rollback

```bash
# CLI
vercel rollback <deployment-url>
# o desde dashboard: Deployments → ⋮ → Rollback to this deployment

# También se puede redeployar un deployment anterior:
vercel deploy --prod --regenerate
```

**Tiempo estimado**: ~2 minutos.

### Supabase Rollback (DB)

```bash
# 1. Identificar última migración estable
supabase migration list

# 2. Si hay migración específica a revertir:
supabase db restore --version <version>

# 3. O ejecutar SQL manual de reversión
```

⚠️ **Riesgo**: Supabase no tiene point-in-time recovery en el tier actual. Las migraciones son forward-only. Para rollback real de datos se necesita:
- Backup antes del deploy (manual o programado)
- Script de reversión por cada migración (`down` migration)

### Git Rollback

```bash
# Revertir commit (sin reescribir historial)
git revert HEAD
git push origin main

# O reset hard + force push (peligroso en main compartida)
git reset --hard HEAD~1
git push --force origin main  # ❌ Solo si es necesario y comunicado
```

**Recomendación para el proyecto**:
- Usar `git revert` siempre en `main`
- Documentar cada migración con su script de reversión (`down` migration)
- Configurar backup automático de Supabase (point-in-time recovery)

---

## 9. Resumen de Acciones Necesarias

| # | Aspecto | Acción | Dependencias | Prioridad |
|---|---------|--------|-------------|-----------|
| 1 | **CI Pipeline** | Crear `.github/workflows/ci.yml` | — | 🔴 Alta |
| 2 | **Coverage** | Instalar `@vitest/coverage-v8`, configurar, agregar script | CI pipeline | 🔴 Alta |
| 3 | **E2E en CI** | Agregar job de Playwright al workflow | CI pipeline | 🟡 Media |
| 4 | **Stryker** | Instalar, configurar, agregar workflow semanal | CI pipeline, coverage | 🟢 Baja |
| 5 | **Release Checklist** | Crear `RELEASE_CHECKLIST.md` | — | 🟡 Media |
| 6 | **Rollback Doc** | Documentar procedimiento en `DEVELOPMENT.md` | — | 🟡 Media |
| 7 | **Vercel Config** | Considerar `vercel.json` para preview deployments | — | 🟢 Baja |
| 8 | **Recharts fix** | Ya aplicado, verificar en CI | — | ✅ Hecho |

---

## Approaches & Recomendaciones

### CI Pipeline

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **A: Single workflow (lint+build+test+e2e)** | Fácil, rápido de implementar, 1 archivo | Todo en secuencia, menos paralelismo | Bajo |
| **B: Matrix workflow (separar por job)** | Paralelo, feedback rápido por etapa | Más complejo, más YAML | Medio |
| **C: Reusable workflows (DRY)** | Reutilizable, modular | Overkill para proyecto pequeño | Alto |

**Recomendación**: B — 3 jobs paralelos (quality, test, e2e). Es el balance óptimo entre velocidad y simplicidad.

### Coverage

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **v8 provider** | Rápido, nativo | No soporta instrumentación de código transformado | Bajo |
| **istanbul provider** | Más preciso | ~2x más lento | Bajo |

**Recomendación**: v8 provider. Para JSX sin TypeScript es suficiente.

### Stryker

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **En cada PR** | Feedback inmediato | Lento (~30-60 min), blockers | Alto |
| **Solo en push a main** | Protege main sin bloquear PRs | Feedback diferido | Medio |
| **Schedule semanal** | No impacta desarrollo | Mucho feedback diferido | Medio |

**Recomendación**: Solo en push a `main` (o schedule semanal si el projecto crece).

---

## Riesgos

1. **Stryker timeout en CI gratuito**: Los runners de GitHub Actions tienen 6h de timeout, suficientes, pero si Stryker excede los límites de GitHub Free (2000 min/mes), puede ser un problema. Estimar ~60 min por ejecución.
2. **Playwright webServer en CI**: El `npm run dev` en CI necesita que Vite arranque y sirva. Si el build tarda más del timeout (120s), fallará. Verificar.
3. **Tests de integración Supabase**: `pdfEngine.supabase.test.js` requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno. En CI hay que configurar secrets.
4. **Node version**: Local es Node 25. En CI usar Node 22 LTS para estabilidad. Asegurar compatibilidad.
5. **Chunk size**: El build advierte chunks >500KB. No es blocker para CI pero debería optimizarse eventualmente.

---

## Ready for Proposal

✅ **Sí**. La exploración está completa. El orchestrator puede proceder a la fase de **Proposal** para formalizar el alcance del cambio `ci-pipeline`.

**Next phase recomendada**: `sdd-propose`

---

### Anexo: Test Suite Count

| Layer | Files | Tests | Status |
|-------|-------|-------|--------|
| Unit (Vitest) | 45 | 540 | ✅ All pass |
| E2E (Playwright) | 2 | ~10-20 | ✅ All pass |

### Anexo: Dependencias por instalar

```bash
npm install --save-dev @vitest/coverage-v8 @stryker-mutator/core @stryker-mutator/vitest-runner
```

Total: 3 packages nuevas.
