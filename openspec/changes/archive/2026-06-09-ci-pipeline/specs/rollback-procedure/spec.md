# Rollback Procedure Specification

## Purpose

Define documented rollback procedures for CMMS Ibero's three deployment layers: Vercel (frontend), Supabase (database migrations), and Git (version control).

## Requirements

### Requirement: Vercel Deployment Rollback

The team MUST be able to revert the production frontend to a previous deployment.

#### Scenario: Rollback via Vercel CLI

- GIVEN a faulty deployment is live on Vercel
- WHEN executing `vercel rollback <deployment-url>`
- THEN the previous stable deployment MUST be restored
- AND the rollback MUST complete within 5 minutes

#### Scenario: Rollback via Vercel Dashboard

- GIVEN a faulty deployment is live
- WHEN navigating to Vercel Dashboard → Deployments → target deployment → "Rollback to this deployment"
- THEN that deployment MUST become the production version
- AND a confirmation MUST be displayed

### Requirement: Supabase Migration Rollback

Database migrations MUST be idempotent and revertible.

#### Scenario: Revert last migration

- GIVEN a faulty migration was applied to Supabase
- WHEN executing the documented down-migration SQL
- THEN the schema MUST return to the state before the faulty migration
- AND data inserted by the faulty migration MUST be handled (deleted or preserved as documented)
- AND no foreign key or constraint violations MUST occur

#### Scenario: Idempotent migration design

- GIVEN any migration in `supabase/migrations/`
- WHEN it runs against an environment already at or past that version
- THEN it MUST NOT produce errors (use `IF NOT EXISTS`, `IF EXISTS` clauses)
- AND it MUST NOT duplicate data or schema objects

### Requirement: Git Revert

The team MUST be able to undo a faulty commit on `main` without rewriting history.

#### Scenario: Revert with git revert

- GIVEN a faulty commit on `main`
- WHEN `git revert <faulty-commit-hash>` executes
- THEN a new commit MUST be created that undoes the faulty changes
- AND the commit message MUST reference the reverted commit hash
- AND `git push origin main` MUST propagate the revert

#### Scenario: Revert with tag

- GIVEN a faulty release was tagged
- WHEN the release is rolled back
- THEN the tag MUST be moved or documented as deprecated
- AND a new tag MUST be created on the rollback commit

### Requirement: Documentation Location

Rollback procedures MUST be documented in `DEVELOPMENT.md`.

#### Scenario: Documented procedures

- GIVEN `DEVELOPMENT.md` is read
- WHEN checking the "Rollback" section
- THEN it MUST contain Vercel CLI and dashboard rollback steps
- AND it MUST contain Supabase migration revert steps
- AND it MUST contain `git revert` instructions
- AND it MUST contain version tag management instructions
