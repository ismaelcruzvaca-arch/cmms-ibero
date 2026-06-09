# CI Pipeline Specification

## Purpose

Define the continuous integration pipeline for CMMS Ibero: GitHub Actions workflows for automated quality validation, coverage thresholds, mutation testing on core modules, E2E in CI, and verification of the recharts/es-toolkit CJS compatibility fix.

## Requirements

### Requirement: Fast CI on Push

The system MUST run lint, build, and unit tests on every push to `main` and every pull request to `main`, completing in under 15 minutes.

#### Scenario: Push triggers CI

- GIVEN a push to `main`
- WHEN the CI workflow triggers
- THEN `npm run lint` MUST pass with zero errors
- AND `npm run build` MUST produce a valid `dist/` directory
- AND `npm test` MUST pass all 540+ tests

#### Scenario: PR triggers CI

- GIVEN a pull request opened against `main`
- WHEN the CI workflow triggers
- THEN all push requirements MUST be met
- AND coverage MUST NOT regress below thresholds
- AND E2E tests MUST pass

### Requirement: Full Coverage Thresholds

The system MUST enforce minimum coverage levels using Vitest v8 coverage provider.

#### Scenario: Coverage meets thresholds

- GIVEN `npm run test:coverage` executes
- WHEN the coverage report completes
- THEN lines coverage MUST be ≥60%
- AND functions coverage MUST be ≥60%
- AND branches coverage MUST be ≥50%
- AND statements coverage MUST be ≥60%

#### Scenario: Coverage below threshold

- GIVEN a change that reduces coverage below any threshold
- WHEN `npm run test:coverage` executes
- THEN the command MUST exit non-zero
- AND the CI workflow MUST fail

### Requirement: Stryker Mutation Testing on Core Modules

The system MUST run Stryker mutation testing on `src/pdf-engine/**` and `src/hooks/workOrders/**` on push to `main`.

#### Scenario: Mutation score acceptable

- GIVEN a push to `main`
- WHEN Stryker runs on core modules
- THEN the mutation score MUST be ≥60% (low threshold)
- AND a HTML report MUST be generated in `reports/mutation/`

#### Scenario: Mutants survive in non-core code

- GIVEN Stryker runs
- WHEN mutating files outside `src/pdf-engine/**` and `src/hooks/workOrders/**`
- THEN those files MUST be excluded from mutation

### Requirement: Playwright E2E in CI

The system MUST run Playwright E2E tests in CI with Chromium headless.

#### Scenario: E2E passes in CI

- GIVEN the CI runner has Playwright browsers installed via `npx playwright install chromium --with-deps`
- WHEN `npm run test:e2e` executes
- THEN all E2E specs in `tests/` MUST pass
- AND the webServer (Vite dev) MUST start within 120s

#### Scenario: E2E failure in CI

- GIVEN a failing E2E test in CI
- WHEN the test run completes
- THEN Playwright artifacts MUST be uploaded as `playwright-report`
- AND the CI workflow MUST fail

### Requirement: Recharts / es-toolkit Fix Verification

The system MUST verify that `optimizeDeps.include` for `es-toolkit/compat/*` subpaths is present in `vite.config.js` and resolves correctly.

#### Scenario: Fix present in config

- GIVEN the CI workflow checks out the repository
- WHEN the build step runs
- THEN `vite build` MUST NOT produce `require_isUnsafeProperty` errors
- AND `vite dev` MUST start without CJS compatibility errors

#### Scenario: Missing subpath

- GIVEN a future version of recharts adds new `es-toolkit/compat/` imports
- WHEN `vite build` runs
- AND a CJS compatibility error occurs
- THEN the CI MUST fail
- AND the error MUST point to the missing subpath in `optimizeDeps.include`

### Requirement: NPM Scripts

The project MUST expose `test:coverage` and `test:mutation` scripts in `package.json`.

#### Scenario: Coverage script exists

- GIVEN `package.json` is read
- WHEN checking the `scripts` field
- THEN `"test:coverage": "vitest run --coverage"` MUST exist

#### Scenario: Mutation script exists

- GIVEN `package.json` is read
- WHEN checking the `scripts` field
- THEN `"test:mutation": "stryker run"` MUST exist
