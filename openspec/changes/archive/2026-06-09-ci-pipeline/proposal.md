# Proposal: CI/CD Pipeline

## Intent

CMMS Ibero no tiene CI pipeline, coverage, mutation testing, release checklist ni rollback procedure. Cada push se deploya sin verificación. Formalizar calidad con validación automatizada.

## Scope

### In Scope
- GitHub Actions: workflow rápido (lint+build+test) en push; completo (coverage+E2E+mutation) en PRs a main
- Coverage config (Vitest v8) con thresholds
- Stryker mutation testing en módulos core (pdf engine, work orders hooks)
- Scripts npm: `test:coverage`, `test:mutation`
- Release checklist (RELEASE_CHECKLIST.md)
- Rollback procedure documentado
- Fix permanente de recharts/es-toolkit (ya aplicado, verificar en CI)

### Out of Scope
- Deploy automático a Vercel, TypeScript migration, Docker/Supabase local, preview deployments, chunk optimization

## Capabilities

### New Capabilities
- `ci-pipeline`: Workflows GitHub Actions para lint, test, build, coverage, E2E, y mutation testing
- `release-checklist`: Pasos pre-release, deploy, y post-release
- `rollback-procedure`: Procedimientos documentados para Vercel, Supabase, y git

### Modified Capabilities
None

## Approach

1. Crear `.github/workflows/ci.yml` (lint+build+test) y `ci-full.yml` (coverage+E2E+mutation)
2. Instalar `@vitest/coverage-v8`, configurar en `vite.config.js`
3. Agregar scripts `test:coverage`, `test:mutation` en `package.json`
4. Configurar Stryker (mutar `src/pdf-engine/**` y `src/hooks/workOrders/**`)
5. Verificar fix recharts funciona en CI (optimizeDeps.include)
6. Crear `RELEASE_CHECKLIST.md` (modelo Producción Ibarra)
7. Documentar rollback en `DEVELOPMENT.md`

## Affected Areas

| Area | Impact |
|------|--------|
| `.github/workflows/ci.yml` | New |
| `.github/workflows/ci-full.yml` | New |
| `vite.config.js` | Modified |
| `package.json` | Modified |
| `stryker.config.mjs` | New |
| `RELEASE_CHECKLIST.md` | New |
| `DEVELOPMENT.md` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stryker excede minutos GitHub Free | Medium | Solo en push a main; mutar solo core |
| Playwright webServer timeout en CI | Low | Timeout 120s, tests rápidos (~30s) |
| Tests Supabase requieren secrets | High | Configurar SUPABASE_URL y SERVICE_ROLE_KEY en GitHub Secrets |
| Node 22 vs 25 local | Low | CI usa LTS, scripts no dependen de features específicas |

## Rollback Plan

- `git revert` commits de workflows/configs; push a main
- Si recharts fix falla, agregar subpaths faltantes a `optimizeDeps.include`
- `npm uninstall @stryker-mutator/core @stryker-mutator/vitest-runner @vitest/coverage-v8` y revertir configs

## Dependencies

- `npm install --save-dev @vitest/coverage-v8 @stryker-mutator/core @stryker-mutator/vitest-runner`
- GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Playwright browsers en CI (automático con `npx playwright install chromium --with-deps`)

## Success Criteria

- [ ] CI pasa en PR: lint, build, 540 tests en <15 min
- [ ] Coverage thresholds: lines≥60%, functions≥60%, branches≥50%
- [ ] Stryker corre en módulos core sin errores
- [ ] E2E tests pasan en CI con Playwright
- [ ] Release checklist cubre pre-release, deploy, post-release
- [ ] Rollback documentado para Vercel, Supabase, git
- [ ] Sin regresiones del fix de recharts en CI
