# Proposal: Structured Job Plans (job-plan-structured)

## Intent

Expand `job_plans` from basic template (code, description, hours) to Maximo/SAP-level structured plans with labor requirements by trade, safety requirements (permits/LOTO/PPE), snapshot tables for generated WOs, and supporting columns across related tables.

## Scope

### In Scope
- **`job_plan_labor`**: trade enum (ELECTRICIAN, MECHANIC, INSTRUMENTIST, LUBRICATOR, HELPER, WELDER, OPERATOR), headcount, estimated hours, hourly rate per plan
- **`job_plan_safety`**: safety type enum (PTW, LOTO, HOT_WORK, CONFINED_SPACE, HEIGHTS, EPP_ESPECIALIZADO, OTRO), description, mandatory flag per plan
- **`job_plans` columns**: `asset_type_id`, `is_active`, `updated_at`
- **`checklist_templates.job_plan_task_id`**: FK to `job_plan_tasks` for granular checklist linking
- **`work_orders` cost columns**: `estimated_hours`, `estimated_parts_cost`, `estimated_labor_cost`
- **`checklist_instances` status**: added PENDING to allowed values
- **`spare_parts.unit_cost`**: last-known unit cost for estimation
- **Snapshot tables**: `work_order_labor_estimates` and `work_order_safety_requirements` (with `is_fulfilled` + partial index) — frozen at WO generation time
- **RLS + audit triggers** on all new tables
- **`updated_at` trigger** on `job_plans`

### Out of Scope
- PM→WO function extension (separate change)
- Frontend for labor/safety editing (deferred)
- Runtime safety requirement lifecycle on WOs

## Capabilities

### New Capabilities
- `job-plan-labor`: trade-based labor estimation with headcount and planned hours per job plan
- `job-plan-safety`: safety requirement catalog (permits, LOTO, PPE) linked to job plans

### Modified Capabilities
- `preventive-condition-core`: new `job_plan_labor` + `job_plan_safety` tables, `job_plans` columns, snapshot tables, `checklist_templates` FK, cost columns on `work_orders`

## Approach

Single schema migration: CREATE types (`trade_enum`, `safety_type_enum`), CREATE tables (`job_plan_labor`, `job_plan_safety`, `work_order_labor_estimates`, `work_order_safety_requirements`), ALTER existing tables for new columns/constraints, enable RLS with role-gated policies, add audit triggers and `updated_at` trigger.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260531000001_job_plan_structured.sql` | New | Full schema: 4 tables, 2 enums, 5 ALTER TABLE, RLS, triggers |
| RLS policies | New | 16 policies across 4 tables (SELECT for TECH/PLANNER/ADMIN, write for PLANNER/ADMIN, DELETE only ADMIN) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing FK constraints on `checklist_templates` | Low | `job_plan_task_id` is nullable + `ON DELETE SET NULL` |
| `asset_type_id` FK on existing job_plans | Low | NULL-allowed; existing rows set to NULL (generic) |

## Rollback Plan

Revert migration: `DROP TABLE` new tables, `DROP TYPE` new enums, `ALTER TABLE` DROP new columns, `DROP TRIGGER` audit/updated_at triggers. Total DDL rollback — no data loss (new tables are reference data).

## Dependencies

- Preventive core schema (job_plans, job_plan_tasks) must exist
- `asset_types` table must exist
- `checklist_templates` + `checklist_instances` tables must exist
- `spare_parts` table must exist

## Success Criteria

- [ ] `job_plan_labor` stores trade + headcount + hours + rate per plan (UNIQUE on plan+trade)
- [ ] `job_plan_safety` stores PTW/LOTO/PPE with mandatory flag (UNIQUE on plan+safety_type)
- [ ] `work_order_labor_estimates` + `work_order_safety_requirements` store snapshots with FKs
- [ ] `is_fulfilled` partial index on unfulfilled safety requirements covers runtime queries
- [ ] All RLS policies enforce TECH=read-only, PLANNER/ADMIN=write, ADMIN=delete
