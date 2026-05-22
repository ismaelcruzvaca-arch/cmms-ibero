# Proposal: Preventive & Condition-Based Maintenance — Core Schema Phase 1

## Intent

SQL schema foundation for PM/CBM module. Enables planners to define PM job plans, schedule them against assets (time/meter), and capture condition monitoring data — database layer only.

## Scope

### In Scope

- Migration: `job_plans`, `job_plan_tasks`, `job_plan_materials`
- Migration: `pm_schedules` with time/meter frequency, floating window, suppression chain
- Migration: `meters`, `measure_points`, `meter_readings`
- RLS policies on all 7 tables, role-gated
- CHECK constraints for non-negative freqs, valid values

### Out of Scope

- Triggers, functions, edge functions (Phase 2)
- RxDB schemas, UI, AI signal processing

## Capabilities

### New Capabilities

- `pm-job-plan-schema`: job_plans, job_plan_tasks, job_plan_materials
- `pm-schedule-schema`: pm_schedules (time/meter/float/suppression)
- `condition-monitoring-schema`: meters, measure_points, meter_readings

### Modified Capabilities

None — additive schema, no existing spec behavior changes.

## Approach

Single idempotent migration (`supabase/migrations/`). Three groups:

| Group | Tables | Key FK Targets |
|-------|--------|----------------|
| PM Templates | job_plans → job_plan_tasks → job_plan_materials | `spare_parts(part_num)` |
| Schedules | pm_schedules | `assets(id)`, `job_plans(id)`, self-FK suppression |
| Monitoring | meters → measure_points → meter_readings | `assets(id)` |

- `pm_schedules.frequency` as JSONB supporting `{type:"days", value:N}`, `{type:"meter", meter_id:UUID, value:N}`, or `{type:"both"}`
- `suppressed_by` nullable self-FK, deferrable
- RLS: ADMIN/PLANNER full r/w; TECHNICIAN read + insert readings only

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| FK type mismatch with assets(id) TEXT | Low | Use `TEXT REFERENCES assets(id)` — confirmed convention |
| Self-FK suppression update ordering | Low | Make nullable, deferrable |

## Rollback Plan

`DROP TABLE ... CASCADE` all 7 tables. No data loss — tables are new.

## Dependencies

- `assets` table (FK target)
- `spare_parts` table (FK for job_plan_materials)
- `get_user_role()` helper for RLS

## Success Criteria

- [ ] All 7 tables created with correct FK chains
- [ ] CHECK constraints reject negative frequencies/values
- [ ] RLS active on all tables — ADMIN/PLANNER full, TECHNICIAN restricted
- [ ] pm_schedules supports time, meter, and hybrid freq via JSONB
- [ ] Suppression chain enforced via self-FK
- [ ] Migration idempotent — safe to run multiple times
