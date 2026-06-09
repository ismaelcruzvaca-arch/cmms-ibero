# pdf-seed-testing Specification

## Purpose

Define the seed data contract required for PDF engine integration tests and the validation criteria for the end-to-end pipeline from database to rendered HTML.

## Requirements

### Requirement: Seed Data Minimum Dataset

A migration MUST insert the following minimum dataset into the database so a work order report can render without mock data:

| Table | Required fields | At least |
|-------|----------------|----------|
| `assets` | `asset_num`, `description`, `area`, `category` | 1 row |
| `work_orders` | `wo_num`, `asset_id` (FK), `wo_type`, `priority`, `lifecycle_phase`, `description`, `actual_hours` | 1 row |
| `labor_records` | `wo_id` (FK), `technician_name`, `activity_code`, `start_time`, `end_time`, `total_hours` | 2 rows |
| `material_requests` | `wo_id` (FK), `part_num`, `line_desc`, `requested_qty`, `unit_of_measure` | 1 row |

The seed data MUST use fixed, deterministic IDs (e.g., `SEED-ASSET-001`, `SEED-WO-001`) to avoid FK conflicts on re-execution.

#### Scenario: Seed data inserts without FK violation

- GIVEN a clean database with all prerequisite migrations applied
- WHEN the seed migration runs
- THEN `work_orders` references a valid `asset_id` in `assets`
- AND `labor_records` and `material_requests` reference a valid `wo_id` in `work_orders`

#### Scenario: Re-execution is idempotent

- GIVEN the seed migration has already run once
- WHEN it runs again
- THEN no duplicate key errors occur (all inserts use `ON CONFLICT` or idempotent patterns)

### Requirement: Integration Test Validation

The integration test MUST validate the full pipeline: fetch the seed template from Supabase → resolve data from the seed rows → render HTML. The test MUST use `describe.skipIf(!process.env.SUPABASE_URL)` to skip when no Supabase connection is available.

#### Scenario: Pipeline renders without unresolved placeholders

- GIVEN a Supabase connection with seed data and the fixed `ot-default` template
- WHEN the test fetches the template, builds render data from seed rows, and calls `resolveTemplate`
- THEN the output HTML contains NO raw `{{...}}` placeholders
- AND the output includes the seed WO description, asset description, and at least one labor record activity label
