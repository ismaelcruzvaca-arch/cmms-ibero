# Proposal: PM Engine — Extend Structured Job Plans

## Intent

The `generate_due_preventive_work_orders()` function only cloned materials into WOs. Labor, safety, and checklist data from job plans were lost at generation time, forcing manual re-entry. Also, `is_floating` schedules always used fixed-clock recalculation, which is incorrect for floating schedules that should advance from completion date, not the original target.

## Scope

### In Scope
- Clone `job_plan_labor` → `work_order_labor_estimates` when generating PM WOs
- Clone `job_plan_safety` → `work_order_safety_requirements` when generating PM WOs
- Clone matching `checklist_templates` → `checklist_instances` (PENDING) by module and/or job plan
- Calculate `estimated_hours`, `estimated_parts_cost`, `estimated_labor_cost` on work_orders from cloned snapshots
- Fix `is_floating` support: floating schedules recalculate from `last_completion_date` instead of `next_target_date`

### Out of Scope
- Meter-driven PM schedule evaluation (already handled in CBM trigger)
- UI changes for displaying cost estimates or safety requirements
- Task-specific checklist templates (filtered by `job_plan_task_id IS NULL` — only plan-level checklists)

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `pm-engine-automata`: New labor/safety/checklist cloning behavior and cost calculation in `generate_due_preventive_work_orders()`. Fixed-clock vs floating-clock `next_target_date` recalculation based on `is_floating`.

## Approach

Rewrite `generate_due_preventive_work_orders()` to add 4 new steps after material inheritance:

1. **Clone labor** — copy `job_plan_labor` rows into `work_order_labor_estimates` for the new WO
2. **Clone safety** — copy `job_plan_safety` rows into `work_order_safety_requirements`
3. **Clone checklists** — match `checklist_templates` by `module_id` and/or `job_plan_id`, insert as `checklist_instances` with `status = 'PENDING'` and a system UUID placeholder for unassigned technician
4. **Calculate costs** — UPDATE work_orders with aggregated `estimated_hours`, `estimated_parts_cost` (from materials), `estimated_labor_cost` (from labor snapshots)
5. **Fix floating clock** — when `is_floating = true`, advance `next_target_date` from `last_completion_date` instead of `next_target_date`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260531000002_pm_engine_extend.sql` | New | Full rewrite of `generate_due_preventive_work_orders()` |
| `openspec/specs/pm-engine-automata/spec.md` | Modified | Needs delta spec for cloning + cost + `is_floating` behavior |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `checklist_templates` matching both module AND job plan (AND logic) may exclude intended templates | Low | Template matching uses OR logic per the migration: solo module, solo job plan, or both |
| System UUID placeholder (`00000000-0000-0000-0000-000000000000`) may conflict with real users | Low | Inserted with `ON CONFLICT DO NOTHING`, only used as FK placeholder |
| `estimated_hours` override in step f clobbers the initial `jp.estimated_hours` set at WO insert | Low | Intentional — recalculates as SUM(estimated_hours × head_count) from labor snapshot, which is more accurate |

## Rollback Plan

Drop and recreate `generate_due_preventive_work_orders()` from the previous migration (`20260524000002_pm_engine_automata.sql`). Remove system user from `auth.users` and `user_profiles` if no other functions depend on it. No schema changes to undo — this migration only changes function logic and inserts a seed user.

## Dependencies

- `job_plan_labor`, `job_plan_safety`, `work_order_labor_estimates`, `work_order_safety_requirements` tables exist (created in migration `20260531000001_job_plan_structured`)
- `spare_parts.unit_cost` column exists (added in same migration)
- `checklist_templates`, `checklist_instances` tables exist (from earlier migrations)
- `checklist_instances.status` includes `'PENDING'` (added in `20260531000001`)

## Success Criteria

- [ ] `generate_due_preventive_work_orders()` clones labor, safety, and checklists for each generated PM WO
- [ ] `work_orders.estimated_hours` = SUM of labor snapshot hours × head_count
- [ ] `work_orders.estimated_parts_cost` = SUM of planned materials × unit_cost
- [ ] `work_orders.estimated_labor_cost` = SUM of labor hours × head_count × hourly_rate
- [ ] `is_floating = true` advances `next_target_date` from `last_completion_date`
- [ ] `is_floating = false` (fixed-clock) retains original behavior
- [ ] No regression on material inheritance or hierarchical suppression
