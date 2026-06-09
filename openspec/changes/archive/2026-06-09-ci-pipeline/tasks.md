# Tasks: CI/CD Pipeline

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350–450 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (all changes tightly coupled to pipeline) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Infrastructure + config + CI workflows + docs | Single PR | All changes are interdependent; splitting would create review overhead. Single PR with maintainer awareness of 400-line boundary. |

## Phase 1: Dependencies & Configuration

- [x] 1.1 **Install devDependencies**: `npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner @vitest/coverage-v8` — @vitest/coverage-v8 ya estaba instalado; se agregaron @stryker-mutator/core y @stryker-mutator/vitest-runner
- [x] 1.2 **Add npm scripts** in `package.json`: `"test:coverage": "vitest run --coverage"`, `"test:mutation": "stryker run"`
- [x] 1.3 **Configure Vitest coverage** in `vite.config.js`: add `test.coverage` with provider `v8`, thresholds (lines≥40%, functions≥30%, branches≥35%, statements≥40%), and `include: ["src/**"]`
- [x] 1.4 **Fix recharts CJS error** in `vite.config.js`: add `'es-toolkit/compat/uniqBy'` to `optimizeDeps.include`

## Phase 2: Mutation Testing

- [x] 2.1 **Create `stryker.config.json`**: configure `@stryker-mutator/vitest-runner`, mutate only `src/lib/pdf/**`, `src/hooks/useReport*.js`, `src/hooks/useWorkOrders*.js`, set mutation score threshold ≥50%

## Phase 3: CI Workflows

- [x] 3.1 **Create `.github/workflows/ci.yml`**: trigger on push (all branches) — checkout → Node 22 LTS → npm ci → ESLint → `vitest run` → `vite build`
- [x] 3.2 **Create `.github/workflows/ci-full.yml`**: trigger on PR to main — checkout → Node 22 LTS → npm ci → `vitest run --coverage` (thresholds block) → Playwright E2E (Chromium headless) → `stryker run` (core modules only) → upload coverage artifact

## Phase 4: Documentation

- [x] 4.1 **Create `RELEASE_CHECKLIST.md`**: pre-deploy checks (tests, coverage, lint, build, E2E) → version bump + changelog → Vercel deploy → smoke tests (login, dashboard, WOs, PDF, RxDB) → post-deploy monitoring (Sentry, Supabase Edge Functions, team notification) → git tag + push. Incluye paso de desactivar/reactivar auto-deploy de Vercel.
- [x] 4.2 **Add rollback section to `DEVELOPMENT.md`**: Vercel rollback (CLI + dashboard), Supabase migration revert (down-migration SQL), `git revert` with tag management
- [x] 4.3 **Verify optimizeDeps.include completeness**: grep all recharts imports for `es-toolkit/compat/` subpaths and ensure they're listed — CI build will fail if any are missing
