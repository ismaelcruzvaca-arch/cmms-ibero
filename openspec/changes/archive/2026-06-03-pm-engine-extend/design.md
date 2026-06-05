# Design: PM Engine — Extend Structured Job Plans

## Technical Approach

Single migration (`20260531000002_pm_engine_extend.sql`) that:

1. Seeds a system user placeholder (`00000000-0000-0000-0000-000000000000`) in `auth.users` + `user_profiles` for FK compliance on auto-generated checklist instances
2. Replaces `generate_due_preventive_work_orders()` with an extended version that adds 5 new steps (c–g) after the existing WO insert and material inheritance (steps a–b)

The function is a single PL/pgSQL block wrapping a `FOR` loop over eligible PM schedules. All inserts run inside the same transaction as the calling query — no explicit `BEGIN/COMMIT` needed.

## Architecture Decisions

| Decision | Options | Tradeoffs | Chosen |
|----------|---------|-----------|--------|
| Labor/safety storage in function vs separate call | (a) Inline INSERT in the main loop (b) Separate helper functions | (b) adds unnecessary indirection — cloning is a simple INSERT...SELECT with no branching. Inline keeps the generation flow readable end-to-end | **Inline INSERT** — matches the existing material inheritance pattern and keeps all WO generation logic in one place |
| Checklist template matching logic | (a) OR logic: module matches OR job plan matches (b) AND logic: both must match (c) Per-template-configurable | (b) is too restrictive — a module-level template should apply to all WOs in that module regardless of job plan. (c) is overengineered for current needs. (a) gives the flexibility the product needs while staying simple: module-level, plan-level, or both | **OR logic** — `(module_id = X AND job_plan_id IS NULL) OR (job_plan_id = Y AND module_id IS NULL) OR (module_id = X AND job_plan_id = Y)` |
| System user: nil UUID vs dedicated user | (a) `00000000-0000-0000-0000-000000000000` (b) Create a real user row with email | (b) pollutes auth.users with an actual login. (a) is a well-known sentinel value that can never collide with a real Supabase Auth user (Supabase never generates all-zeros UUIDs) | **nil UUID** — seeded into `auth.users` and `user_profiles` only for FK compliance; no login possible, `ON CONFLICT DO NOTHING` for idempotency |
| Floating clock: conditional branch vs separate query | (a) IF/ELSE on `is_floating` inside the UPDATE (b) Two parallel UPDATE statements with WHERE filter | (b) doubles the update logic but is simpler. (a) keeps a single UPDATE with conditional expression | **Conditional branch** — cleaner single UPDATE and makes the floating vs fixed logic explicit side by side |
| Cost calculation: per-WO vs batch after loop | (a) UPDATE inside the loop (per WO) (b) Collect IDs and UPDATE in batch after loop | (b) is more efficient for large batches but adds complexity (need to track IDs and run a bulk UPDATE). (a) keeps each WO generation self-contained and is correct because each WO is processed once in the loop | **Per-WO UPDATE** — simpler, matches the insert-per-WO pattern, acceptable for PM generation (typically <100 WOs per run) |

## Data Flow

```
pm_schedules (next_target_date <= TODAY, NOT suppressed by parent)
  │
  ▼
generate_due_preventive_work_orders()
  │
  ├── a. INSERT work_orders (PM, WAPPR, estimated_hours ← jp.estimated_hours)
  │
  ├── b. INSERT material_requests FROM job_plan_materials (existing behavior)
  │
  ├── c. INSERT work_order_labor_estimates FROM job_plan_labor         ◄─ NEW
  │        • trade, estimated_hours, head_count, hourly_rate cloned
  │        • UNIQUE(work_order_id, trade) enforced by table constraint
  │
  ├── d. INSERT work_order_safety_requirements FROM job_plan_safety    ◄─ NEW
  │        • safety_type, description, is_mandatory, is_fulfilled=false cloned
  │        • UNIQUE(work_order_id, safety_type) enforced
  │
  ├── e. INSERT checklist_instances FROM checklist_templates           ◄─ NEW
  │        • WHERE is_active=true AND job_plan_task_id IS NULL
  │          AND (module_id = asset.module_id)
  │          OR  (job_plan_id = schedule.job_plan_id)
  │          OR  (module_id = asset.module_id AND job_plan_id = schedule.job_plan_id)
  │        • status='PENDING', technician_id=system_placeholder
  │
  ├── f. UPDATE work_orders SET                                        ◄─ NEW
  │        estimated_hours    = SUM(labor.estimated_hours × head_count)
  │        estimated_parts_cost = SUM(materials.planned_qty × COALESCE(sp.unit_cost, 0))
  │        estimated_labor_cost = SUM(labor.estimated_hours × head_count × hourly_rate)
  │
  └── g. UPDATE pm_schedules SET                                       ◄─ MODIFIED
         last_completion_date = NOW(),
         next_target_date = CASE
           WHEN ps.is_floating THEN last_completion_date + frequency
           ELSE next_target_date + frequency
         END
```

## Floating Clock Logic

The original function unconditionally advanced `next_target_date` from itself:

```sql
next_target_date = next_target_date + (r.time_frequency_days || ' days')::INTERVAL
```

The extended function checks `is_floating` to branch:

```sql
IF r.is_floating THEN
  -- Floating: advance from last_completion_date (when the WO was actually done)
  next_target_date = last_completion_date + (r.time_frequency_days || ' days')::INTERVAL;
ELSE
  -- Fixed-clock: advance from next_target_date (original behavior)
  next_target_date = next_target_date + (r.time_frequency_days || ' days')::INTERVAL;
END IF;
```

Note: The first PM generation for a schedule may have `last_completion_date IS NULL`. In that case, floating falls back to `NOW()` (the date the function runs), which is the same as `last_completion_date` after step g sets it. This is correct — the first generation has no completion history, so the clock starts from creation.

## Checklist Template Matching Matrix

| Template `module_id` | Template `job_plan_id` | Asset Module = X | Schedule JP = Y | Matches? |
|---------------------|----------------------|-----------------|-----------------|----------|
| X | NULL | ✓ | any | **Yes** — module-level |
| NULL | Y | any | ✓ | **Yes** — plan-level |
| X | Y | ✓ | ✓ | **Yes** — both |
| X | Y | ✓ | ✗ | No |
| X | Y | ✗ | ✓ | No |
| X | Z (≠ Y) | ✓ | any | No (module X ≠ Z doesn't apply) |
| NULL | NULL | any | any | No (no scope) |

## File Changes

### Migration (`supabase/migrations/20260531000002_pm_engine_extend.sql`)

| Section | Change |
|---------|--------|
| System user seed | `INSERT INTO auth.users (...)` + `INSERT INTO user_profiles (...)` with `'00000000-0000-0000-0000-000000000000'`, `ON CONFLICT DO NOTHING` |
| Steps a–b | Preserved from the original `generate_due_preventive_work_orders()` — WO insert + material inheritance |
| Step c — Labor clone | `INSERT INTO work_order_labor_estimates SELECT ... FROM job_plan_labor WHERE job_plan_id = r.job_plan_id` |
| Step d — Safety clone | `INSERT INTO work_order_safety_requirements SELECT ... FROM job_plan_safety WHERE job_plan_id = r.job_plan_id` |
| Step e — Checklist attach | `FOR v_template IN SELECT ... FROM checklist_templates WHERE ... LOOP INSERT INTO checklist_instances ... END LOOP` |
| Step f — Cost calculation | `UPDATE work_orders SET estimated_hours = (...), estimated_parts_cost = (...), estimated_labor_cost = (...)` |
| Step g — Schedule update | Modified to branch on `is_floating` for `next_target_date` recalculation |
| `COMMENT ON FUNCTION` | Updated to document the new cloning and cost behavior |

### Tests (`supabase/tests/database/`)

Tests live in the Phase 1 migration's test file (`job_plan_structured_test.sql`) alongside schema tests. Key test scenarios:

| Scenario | What it proves |
|----------|---------------|
| Labor clone | Row count + column values match source job_plan_labor |
| Safety clone | Row count + column values match source job_plan_safety |
| Checklist attach | Instance created with PENDING status, system user, correct note |
| Task-level exclusion | Templates with job_plan_task_id IS NOT NULL are skipped |
| Cost calculation | estimated_hours, estimated_parts_cost, estimated_labor_cost are mathematically correct |
| Floating-clock | next_target_date = last_completion_date + frequency when is_floating=true |
| Fixed-clock unchanged | next_target_date = original next_target_date + frequency when is_floating=false/null |
| Empty job plan | WO created with 0s in all cost columns, 0 labor/safety rows |
| System user seed | Migration inserts system user idempotently |

## Migration / Rollout

No data migration required — all new behavior is in the function body only. The seed insert is `ON CONFLICT DO NOTHING` so it's safe to reapply.

**Rollback**: `git checkout <previous> -- supabase/migrations/20260531000002_pm_engine_extend.sql` to restore the original function, then drop the system user row if no other function depends on it.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `checklist_templates` matching OR logic may attach too many templates | Low | The WHERE clause requires `is_active = true` and `job_plan_task_id IS NULL` — only active, plan-level templates qualify |
| `estimated_hours` in step f overwrites the `jp.estimated_hours` set in step a | Low | Intentional — the recalculated value (SUM of labor hours × head_count) is more accurate than the single job_plan-level estimate |
| System user UUID could collide with a real auth user | Very Low | Supabase Auth never generates all-zeros UUIDs; colliding would require manual INSERT by an admin |
| Floating schedule with NULL last_completion_date | Low | On first generation, `last_completion_date` is set to NOW() in the same UPDATE, so the floating calculation effectively starts from NOW() — correct behavior |

## Open Questions

(None — all questions from the Phase 1 design were resolved. `hourly_rate` defaults to 0 until a craft_rate table exists. System user uses the nil UUID `00000000-0000-0000-0000-000000000000`.)
