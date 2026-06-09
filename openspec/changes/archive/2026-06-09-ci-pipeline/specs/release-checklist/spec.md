# Release Checklist Specification

## Purpose

Define the mandatory steps for releasing CMMS Ibero to production: pre-deploy verification, deploy execution, post-deploy monitoring, and version tagging.

## Requirements

### Requirement: Pre-Deploy Verification

Before any production deploy, all quality gates MUST pass.

#### Scenario: All checks pass pre-deploy

- GIVEN the release candidate is ready on `main`
- WHEN pre-deploy checks run
- THEN `npm test` MUST pass (540+ tests)
- AND `npm run test:coverage` MUST meet thresholds (lines≥60%, functions≥60%, branches≥50%)
- AND `npm run lint` MUST report zero errors
- AND `npm run build` MUST produce a valid `dist/`
- AND E2E tests MUST pass: `npm run test:e2e`

#### Scenario: Changelog updated

- GIVEN a new release is being prepared
- WHEN reviewing `RELEASE_CHECKLIST.md`
- THEN the changelog MUST reflect changes since last release
- AND `package.json` version MUST follow semver bump

### Requirement: Deploy Execution

Deploy to production MUST follow documented steps with verification.

#### Scenario: Merge and deploy

- GIVEN all pre-deploy checks pass
- WHEN the release branch merges to `main`
- THEN Vercel auto-deploy MUST complete successfully (from `main`)
- AND Sentry MUST show no new errors within 15 minutes of deploy
- AND the deploy status MUST be confirmed via Vercel dashboard or CLI

#### Scenario: Production smoke tests

- GIVEN the deploy completes
- WHEN running smoke tests in production
- THEN login MUST work
- AND the main dashboard MUST load
- AND Work Orders page MUST render
- AND PDF exports MUST generate
- AND RxDB offline sync MUST initialize

### Requirement: Post-Deploy Monitoring

After deploy, the team MUST monitor for regressions.

#### Scenario: Post-deploy observation window

- GIVEN the deploy is live
- WHEN monitoring the first 24 hours
- THEN Sentry MUST be checked for new issues
- AND Supabase Edge Functions MUST be verified healthy
- AND the team MUST be notified of the release

### Requirement: Version Tagging

Every release MUST be tagged in Git with a semver tag.

#### Scenario: Tag on release

- GIVEN the deploy is confirmed successful
- WHEN creating the release tag
- THEN `git tag v<major>.<minor>.<patch>` MUST be created
- AND `git push origin v<major>.<minor>.<patch>` MUST be executed
