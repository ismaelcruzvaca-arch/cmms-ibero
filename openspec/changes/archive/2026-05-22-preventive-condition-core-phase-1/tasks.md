# Tasks: Preventive & Condition-Based Maintenance — Core Schema Phase 1

## Phase 1: Infrastructure / Migration

- [x] **1.1 Create migration SQL file**
- [x] **1.2 Apply migration to local Docker Supabase**
- [x] **1.3 Verify schema integrity**
  Query `information_schema.tables`, `information_schema.table_constraints`, and `information_schema.check_constraints` against local DB. Confirm:
  - All 7 tables exist
  - FK constraints on all child tables (job_plan_tasks, job_plan_materials, pm_schedules, meters, measure_points, meter_readings)
  - CHECK constraints for `intervention_type`, `meter_type`, `planned_qty > 0`
  - RLS enabled on all 7 tables (`pg_class.relrowsecurity = true`)
  - UNIQUE constraint on `job_plans.code` and `job_plan_tasks(job_plan_id, step_sequence)`
  **Acceptance**: All constraints verified with zero errors.
