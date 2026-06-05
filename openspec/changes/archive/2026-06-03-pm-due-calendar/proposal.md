# Proposal: PM Due Calendar View

## Intent

Give planners a single queryable view of upcoming preventive work orders — when each PM schedule is due next, for which asset, with what job plan, and whether it's already overdue. Eliminates ad-hoc joins across `pm_schedules`, `job_plans`, and `assets`.

## Scope

### In Scope
- `pm_due_calendar` view (CREATE OR REPLACE VIEW)
- `COMEMENT ON` documentation on view and columns
- Status classification: `OVERDUE` if `next_target_date ≤ today`, else `PENDING`
- Ordering by `next_target_date ASC` (soonest-first)

### Out of Scope
- UI/frontend (view is consumed by Supabase REST and GraphQL)
- Materialized refresh (live query, no stale data)
- Filtering, pagination, or search (delegated to API consumer)
- Meter-driven schedules (those show NULL next_target_date and are excluded)

## Capabilities

### New Capabilities
- `pm-due-calendar`: Read-only view projecting `pm_schedules × job_plans × assets` with computed OVERDUE/PENDING status, ordered by target date

### Modified Capabilities
- None — view is a new read-only projection; no existing spec changes behavior

## Approach

Single SQL view that joins three existing tables:

```sql
pm_schedules
  → assets          (asset_id → id, equipment_id as asset_name)
  → job_plans       (job_plan_id → id, code as job_plan_title)
```

Filters to schedules with a non-null `next_target_date`, computes `status` via `CASE WHEN ... <= CURRENT_DATE`, and orders by target date ascending.

Deployed as `supabase/migrations/20260525000001_pm_due_calendar.sql`. Idempotent via `CREATE OR REPLACE VIEW`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260525000001_pm_due_calendar.sql` | New | Single idempotent migration creating the view |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Read-only view, no data mutation | None | Schema-only risk; can be dropped atomically |

## Rollback Plan

1. `DROP VIEW IF EXISTS pm_due_calendar CASCADE;`
2. Delete migration file (or revert commit)

## Dependencies

None — depends only on existing tables (`pm_schedules`, `assets`, `job_plans`), all stable.

## Success Criteria

- [ ] `SELECT * FROM pm_due_calendar` returns rows with correct `status` (OVERDUE when past, PENDING otherwise)
- [ ] Every row has non-null `schedule_id`, `asset_name`, `job_plan_title`, `projected_date`, `status`
- [ ] Rows are ordered by `projected_date ASC`
- [ ] No schedules with NULL `next_target_date` appear in results
