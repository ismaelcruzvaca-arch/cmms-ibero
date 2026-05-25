# Tasks: Structured Job Plans (job-plan-structured)

> 17 tasks across 3 phases. Migration 1 has 12 sections covering 4 new tables, 4 ALTERs, 2 audit triggers, 1 updated_at trigger, RLS.
> Phase 2 modifies `generate_due_preventive_work_orders()` with 4 new cloning/cost blocks.
> Phase 3 validates everything end-to-end with pgTAP.
> Design ref: `design.md` (98 lines). Specs: `specs/job-plan-labor/`, `specs/job-plan-safety/`, `specs/preventive-condition-core/delta.md`, `specs/pm-engine-automata/delta.md`.

---

## Open Design Questions (Resolve Before Phase 2)

- **hourly_rate**: Design says column exists on `work_order_labor_estimates` but labor spec defers craft_rate table. **Decision: use 0 as default** until a craft_rate or config table is added.
- **System user for auto-generated checklist_instances**: `checklist_instances.technician_id` is NOT NULL but PM-generated instances have no technician assigned. **Decision: use a well-known placeholder UUID** — the nil UUID `00000000-0000-0000-0000-000000000000` or a dedicated system user profile row.

---

## Phase 1: Schema Migration

> All tasks write to **a single migration file**: `supabase/migrations/20260531000001_job_plan_structured.sql`
> Convention: idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$` blocks), `COMMENT ON` in Spanish, snake_case.

---

### [ ] 1.1 Migration Section 1 — `trade_enum` + `job_plan_labor` table + seed trades

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (first Phase 1 task)
- **Acceptance**:
  - `trade_enum` ENUM type created with values: `'ELECTRICIAN'`, `'MECHANIC'`, `'HELPER'`, `'INSTRUMENTATION'`, `'WELDER'`, `'OPERATOR'`, `'SUPERVISOR'`, `'OTHER'`
  - `job_plan_labor` table exists with columns: `id UUID PK DEFAULT gen_random_uuid()`, `job_plan_id UUID NOT NULL FK → job_plans(id) ON DELETE CASCADE`, `trade trade_enum NOT NULL`, `estimated_hours NUMERIC NOT NULL CHECK (> 0)`, `head_count INT DEFAULT 1`
  - UNIQUE constraint on `(job_plan_id, trade)`
  - COMMENT ON table and all columns in Spanish

---

### [ ] 1.2 Migration Section 2 — `safety_type_enum` + `job_plan_safety` table

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (independent of 1.1)
- **Acceptance**:
  - `safety_type_enum` ENUM type created with values: `'PTW'`, `'LOTO'`, `'HOT_WORK'`, `'CONFINED_SPACE'`, `'HEIGHTS'`, `'EPP_ESPECIALIZADO'`, `'OTRO'`
  - `job_plan_safety` table exists with columns: `id UUID PK DEFAULT gen_random_uuid()`, `job_plan_id UUID NOT NULL FK → job_plans(id) ON DELETE CASCADE`, `safety_type safety_type_enum NOT NULL`, `description TEXT nullable`, `is_mandatory BOOLEAN DEFAULT true`
  - UNIQUE constraint on `(job_plan_id, safety_type)`
  - COMMENT ON table and all columns in Spanish

---

### [ ] 1.3 Migration Sections 3-4 — ALTER `job_plans` + ALTER `checklist_templates`

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (ALTERs on existing tables, no new tables needed)
- **Acceptance**:
  - `job_plans` has 3 new columns (all `ADD COLUMN IF NOT EXISTS`):
    - `asset_type_id TEXT REFERENCES asset_types(id)` — nullable, backward compat
    - `is_active BOOLEAN DEFAULT true`
    - `updated_at TIMESTAMPTZ` — nullable, set by trigger (see task 1.8)
  - `checklist_templates` has 1 new column:
    - `job_plan_task_id UUID REFERENCES job_plan_tasks(id) ON DELETE SET NULL` — nullable, backward compat
  - Existing rows have NULL for both nullable columns (no data migration needed)
  - COMMENT ON all new columns in Spanish

---

### [ ] 1.4 Migration Sections 5-6 — ALTER `work_orders` + ALTER `checklist_instances` status

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None
- **Acceptance**:
  - `work_orders` has 3 new columns (`ADD COLUMN IF NOT EXISTS`):
    - `estimated_hours NUMERIC` — nullable, computed at WO generation
    - `estimated_parts_cost NUMERIC` — nullable, computed at WO generation
    - `estimated_labor_cost NUMERIC` — nullable, computed at WO generation
  - `checklist_instances` status CHECK constraint is **replaced** to include `'PENDING'` alongside existing values (`'IN_PROGRESS'`, `'COMPLETED'`, `'VOID'`)
    - Use `ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...; ALTER TABLE ... ADD CONSTRAINT ... CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','VOID'))`
  - COMMENT ON all new columns in Spanish

---

### [ ] 1.5 Migration Section 7 — ALTER `spare_parts` (add `unit_cost`)

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None
- **Acceptance**:
  - `spare_parts` has 1 new column:
    - `unit_cost NUMERIC DEFAULT 0` — needed for `estimated_parts_cost` calculation
  - COMMENT ON column in Spanish

---

### [ ] 1.6 Migration Sections 8-9 — Snapshot tables: `work_order_labor_estimates` + `work_order_safety_requirements`

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (new tables, no FK to other new tables)
- **Acceptance**:

  **`work_order_labor_estimates`** (SNAPSHOT — not live FK to job_plan_labor):
  - Columns: `id UUID PK DEFAULT gen_random_uuid()`, `work_order_id UUID NOT NULL FK → work_orders(id) ON DELETE CASCADE`, `trade trade_enum NOT NULL`, `estimated_hours NUMERIC NOT NULL`, `head_count INT DEFAULT 1`, `hourly_rate NUMERIC DEFAULT 0`
  - UNIQUE constraint on `(work_order_id, trade)`
  - COMMENT ON table and columns in Spanish

  **`work_order_safety_requirements`** (SNAPSHOT — not live FK to job_plan_safety):
  - Columns: `id UUID PK DEFAULT gen_random_uuid()`, `work_order_id UUID NOT NULL FK → work_orders(id) ON DELETE CASCADE`, `safety_type safety_type_enum NOT NULL`, `description TEXT nullable`, `is_mandatory BOOLEAN DEFAULT true`, `is_fulfilled BOOLEAN DEFAULT false`
  - UNIQUE constraint on `(work_order_id, safety_type)`
  - COMMENT ON table and columns in Spanish

- **Notes**:
  - `hourly_rate` defaults to 0 (placeholder until craft_rate table exists)
  - `is_fulfilled` on safety is a runtime field set during WO execution (deferred)
  - Both tables reference `work_orders` ON DELETE CASCADE (snapshot deleted when WO is deleted)

---

### [ ] 1.7 Migration Section 10 — RLS policies on all 4 new tables

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: [1.1], [1.2], [1.6] (all new tables must exist)
- **Acceptance**:

  RLS policy matrix (same pattern as `job_plan_materials` — uses existing `get_user_role()` function):

  | Table | TECHNICIAN | PLANNER | ADMIN |
  |-------|-----------|---------|-------|
  | `job_plan_labor` | SELECT | SELECT / INSERT / UPDATE | ALL |
  | `job_plan_safety` | SELECT | SELECT / INSERT / UPDATE | ALL |
  | `work_order_labor_estimates` | SELECT | ALL | ALL |
  | `work_order_safety_requirements` | SELECT | ALL | ALL |

  - All 4 tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  - One policy per role per operation (e.g., `technician_select`, `planner_insert`, `admin_all`)
  - `job_plan_labor` and `job_plan_safety` deny PLANNER DELETE (consistent with `job_plan_materials` pattern)
  - `work_order_labor_estimates` and `work_order_safety_requirements` give PLANNER full CRUD (WO-level data, not plan-level)
  - COMMENT ON policies (Spanish)

---

### [ ] 1.8 Migration Sections 11-12 — Audit triggers + `updated_at` trigger

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: [1.6] (snapshot tables exist for audit), [1.3] (`job_plans.updated_at` exists)
- **Acceptance**:
  - `work_order_labor_estimates_audit` trigger: AFTER INSERT OR UPDATE OR DELETE ON `work_order_labor_estimates`, FOR EACH ROW, `EXECUTE FUNCTION audit_trigger_func()`
  - `work_order_safety_requirements_audit` trigger: AFTER INSERT OR UPDATE OR DELETE ON `work_order_safety_requirements`, FOR EACH ROW, `EXECUTE FUNCTION audit_trigger_func()`
  - `trg_job_plans_updated_at` trigger: BEFORE UPDATE ON `job_plans`, FOR EACH ROW, `EXECUTE FUNCTION set_updated_at()` (or equivalent inline function that sets `NEW.updated_at = NOW()`)
  - Audit triggers use the same pattern as existing audit triggers in the project (check existing `audit_trigger_func()` signature)
  - Idempotent: use `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` pattern

---

## Phase 2: PM Engine Extension

> All tasks modify the same SQL function: `generate_due_preventive_work_orders()`.
> Single migration file: `supabase/migrations/20260531000002_pm_engine_extend.sql`
> Uses `CREATE OR REPLACE FUNCTION` to replace the existing function.
> The function body is one transaction — all WOs, estimates, safety, checklists, and cost updates either succeed together or roll back together.

---

### [ ] 2.1 Scaffold the new function + preserve existing WO + material_request cloning

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Phase 1 (all new tables exist)
- **Acceptance**:
  - `CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()` with `RETURNS TABLE(work_order_id UUID, pm_schedule_id UUID, code TEXT)` (same signature as existing)
  - Function body preserved from the original: iterates `pm_schedules` where `next_target_date <= NOW() AND NOT suppressed`, inserts `work_orders` with `type='PM'`, `lifecycle_phase='WAPPR'`, clones `job_plan_materials` into `material_requests`
  - All logic from the original function is preserved (no regression)
  - Uses `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`
  - **Notes**: Read the existing function first to understand current body structure before extending

---

### [ ] 2.2 Add labor estimate cloning block

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After WO INSERT + material request cloning, add `INSERT INTO work_order_labor_estimates (work_order_id, trade, estimated_hours, head_count, hourly_rate)`
  - Source: `SELECT new_wo_id, jpl.trade, jpl.estimated_hours, jpl.head_count, 0 FROM job_plan_labor jpl WHERE jpl.job_plan_id = pm.job_plan_id`
  - `hourly_rate = 0` (default until craft_rate table exists)
  - Skips if no labor rows exist for the job plan (0 rows inserted, no error)

---

### [ ] 2.3 Add safety requirement cloning block

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After labor estimate cloning, add `INSERT INTO work_order_safety_requirements (work_order_id, safety_type, description, is_mandatory)`
  - Source: `SELECT new_wo_id, jps.safety_type, jps.description, jps.is_mandatory FROM job_plan_safety jps WHERE jps.job_plan_id = pm.job_plan_id`
  - `is_fulfilled` defaults to `false`
  - Skips if no safety rows exist for the job plan (0 rows inserted, no error)

---

### [ ] 2.4 Add checklist template attachment block

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After safety cloning, add `INSERT INTO checklist_instances (work_order_id, template_id, technician_id, asset_id, status, ...)` 
  - Source: `SELECT checklist_templates` linked to the job plan's module AND the job plan itself
  - Filter: `WHERE module_id = (SELECT module_id FROM assets WHERE id = asset_id_from_wo) AND (job_plan_id IS NULL OR job_plan_id = pm.job_plan_id)`
  - `status = 'PENDING'` (new enum value from Phase 1)
  - `technician_id = '00000000-0000-0000-0000-000000000000'` (system placeholder — no technician assigned yet)
  - If `checklist_template.job_plan_task_id IS NOT NULL`, link the instance to the specific task (the design notes this, but the actual task FK on `checklist_instances` must already exist or be added — **verify `checklist_instances` has a `job_plan_task_id` FK or use a denormalized `task_id` column**)
  - Skips if no templates match (0 instances created, no error)
- **Notes**:
  - The nil UUID system user must already exist as a row in `user_profiles` or the FK on `technician_id` will fail. Add an INSERT for a system user if not present: `INSERT INTO user_profiles (id, full_name, role) VALUES ('00000000-0000-0000-0000-000000000000', 'Sistema', 'SYSTEM') ON CONFLICT (id) DO NOTHING`

---

### [ ] 2.5 Add cost calculation and `work_orders` UPDATE block

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.2], [2.3] (cost data must be inserted first)
- **Acceptance**:
  - After all inserts, compute and UPDATE the newly created work order:
    - `estimated_hours = SUM(labor.estimated_hours × labor.head_count)` from `work_order_labor_estimates`
    - `estimated_parts_cost = SUM(mr.planned_qty × COALESCE(sp.unit_cost, 0))` from `material_requests` JOIN `spare_parts`
    - `estimated_labor_cost = SUM(labor.estimated_hours × labor.head_count × labor.hourly_rate)` from `work_order_labor_estimates`
  - `SET estimated_hours = subquery.hours, estimated_parts_cost = subquery.parts_cost, estimated_labor_cost = subquery.labor_cost`
  - Uses a single UPDATE per WO (or a single batch UPDATE after the loop)
  - If no labor rows exist, `estimated_hours` and `estimated_labor_cost` default to 0
  - If no material requests exist, `estimated_parts_cost` defaults to 0
- **Notes**:
  - This is the final step of the function — all clone inserts must complete before the cost calculation runs
  - `hourly_rate` is 0 for now, so `estimated_labor_cost` will be 0 until the craft_rate table exists (accept per design — the column is there for when rates exist)

---

## Phase 3: Tests

> All tasks write to: `supabase/tests/database/job_plan_structured_test.sql`
> Follows existing pgTAP pattern: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`
> Uses `SAVEPOINT`/`ROLLBACK TO` for test isolation.

---

### [ ] 3.1 pgTAP — Schema validation tests

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: Phase 1 (migration applied)
- **Acceptance**:
  - `has_table('job_plan_labor')`, `has_table('job_plan_safety')`, `has_table('work_order_labor_estimates')`, `has_table('work_order_safety_requirements')`
  - Column checks: `has_column('job_plan_labor', 'trade')`, `has_column('job_plan_safety', 'safety_type')`, etc.
  - Type checks: `col_type_is('job_plan_labor', 'trade', 'trade_enum')`, `col_type_is('job_plan_safety', 'safety_type', 'safety_type_enum')`
  - NOT NULL checks: `col_not_null('job_plan_labor', 'trade')`, `col_not_null('job_plan_labor', 'estimated_hours')`
  - CHECK constraints: insert estimated_hours=0 on job_plan_labor → violation; insert safety_type='INVALID' on job_plan_safety → violation
  - UNIQUE constraints: duplicate (job_plan_id, trade) on job_plan_labor → violation; duplicate (job_plan_id, safety_type) on job_plan_safety → violation
  - FK constraints: `col_is_fk('job_plan_labor', 'job_plan_id')`, `col_is_fk('job_plan_safety', 'job_plan_id')`
  - FK ON DELETE CASCADE: DELETE job_plan → child rows in labor and safety are also deleted
  - ALTER columns exist: `has_column('job_plans', 'asset_type_id')`, `has_column('job_plans', 'is_active')`, `has_column('job_plans', 'updated_at')`
  - `has_column('checklist_templates', 'job_plan_task_id')`
  - `has_column('work_orders', 'estimated_hours')`, `has_column('work_orders', 'estimated_parts_cost')`, `has_column('work_orders', 'estimated_labor_cost')`
  - `has_column('spare_parts', 'unit_cost')`
  - `checklist_instances.status` CHECK accepts 'PENDING' (insert OK) and rejects 'DONE' (violation)
  - UNIQUE on snapshot tables: `work_order_labor_estimates(work_order_id, trade)` and `work_order_safety_requirements(work_order_id, safety_type)`
  - Snapshot FK ON DELETE CASCADE: DELETE work_order → child rows in labor_estimates and safety_requirements deleted
  - Verify `job_plans.is_active` defaults to `true` on INSERT

---

### [ ] 3.2 pgTAP — RLS policy tests

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: [1.7] (RLS policies applied)
- **Acceptance**:
  - RLS is enabled on all 4 tables: `SELECT results_eq('SELECT relrowsecurity FROM pg_class WHERE relname = ''job_plan_labor''', ARRAY[true::text])`
  - **TECHNICIAN role**:
    - Can SELECT from all 4 tables
    - Cannot INSERT into `job_plan_labor` (42501)
    - Cannot INSERT into `job_plan_safety` (42501)
    - Cannot DELETE from any table (42501)
  - **PLANNER role**:
    - Can SELECT, INSERT, UPDATE on `job_plan_labor` and `job_plan_safety`
    - Cannot DELETE from `job_plan_labor` or `job_plan_safety` (42501)
    - Can SELECT, INSERT, UPDATE, DELETE on `work_order_labor_estimates` and `work_order_safety_requirements`
  - **ADMIN role**:
    - Can perform all DML on all 4 tables
  - Tests use `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" TO '...'` with corresponding user_profiles entries created in setup

---

### [ ] 3.3 pgTAP — PM→WO extension integration tests

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: Phase 2 (new function deployed)
- **Acceptance**:

  **Setup** (rolled back at test end):
  - Insert a technological_module, asset type, asset, job_plan with labor + safety + materials
  - Insert a pm_schedule linked to the job plan with `next_target_date <= NOW()` and NOT suppressed
  - Insert checklist_templates linked to the module (one plan-level, one task-level if possible)

  **Labor clone test**:
  - Call `generate_due_preventive_work_orders()`
  - Verify `work_order_labor_estimates` has rows matching the job plan's labor rows (same trade, estimated_hours, head_count)
  - Verify row count matches: 2 labor rows → 2 estimate rows

  **Safety clone test**:
  - Verify `work_order_safety_requirements` has rows matching the job plan's safety rows (same safety_type, description, is_mandatory)
  - Verify `is_fulfilled = false` for all cloned rows

  **Checklist attach test**:
  - Verify `checklist_instances` was created with `status = 'PENDING'`
  - Verify `technician_id` = system placeholder UUID
  - Verify instance linked to correct work_order_id

  **Cost calculation test**:
  - Verify `work_order.estimated_hours > 0` (matching labor estimates)
  - Verify `work_order.estimated_parts_cost > 0` (matching material requests × unit_cost)
  - Verify `work_order.estimated_labor_cost = 0` (since hourly_rate = 0 — accept per design)

  **Idempotency test**:
  - Call the function again with same pm_schedule
  - Verify no duplicate rows in any snapshot table (the function should handle already-generated PMs)

  **Empty job plan test**:
  - Create a job plan with NO labor, NO safety, NO materials
  - Generate WO → verify WO exists with 0 cost estimates, 0 safety requirements, 0 labor estimates

- **Notes**:
  - All tests wrapped in SAVEPOINT/ROLLBACK TO for isolation
  - Use `SELECT * FROM generate_due_preventive_work_orders()` to invoke
  - The function runs inside the test's transaction, so ROLLBACK at test end reverts everything
  - For the system user placeholder, INSERT the nil UUID user_profiles row in the test setup

---

## Summary

| Phase | Tasks | Key Artifacts |
|-------|-------|---------------|
| 1. Schema Migration | 1.1 → 1.8 | `20260531000001_job_plan_structured.sql` — 12 sections, 4 new tables, 4 ALTERs, RLS, triggers |
| 2. PM Engine Extension | 2.1 → 2.5 | `20260531000002_pm_engine_extend.sql` — extends `generate_due_preventive_work_orders()` |
| 3. Tests | 3.1 → 3.3 | `job_plan_structured_test.sql` — pgTAP for schema, RLS, and PM→WO integration |

### Dependency Graph

```
Phase 1 (mostly parallel, some sequential):
  1.1 ──┐
  1.2 ──┤  (no deps on each other)
  1.3 ──┤
  1.4 ──┤
  1.5 ──┘
  1.6 ── (no deps)
  1.7 ── depends on 1.1, 1.2, 1.6
  1.8 ── depends on 1.6, 1.3

Phase 2 (sequential — all modify same function):
  2.1 → 2.2 → 2.3 → 2.4 → 2.5
  All depend on Phase 1

Phase 3:
  3.1 ── depends on Phase 1
  3.2 ── depends on 1.7
  3.3 ── depends on Phase 2
```

### Edge Cases to Watch

| Edge Case | Where Handled | Mechanism |
|-----------|--------------|-----------|
| Job plan has no labor rows | [2.2] cloning | 0 rows inserted, no error |
| Job plan has no safety rows | [2.3] cloning | 0 rows inserted, no error |
| Job plan has no checklist templates | [2.4] attachment | 0 instances created, no error |
| Job plan has no materials | [2.5] cost calc | estimated_parts_cost = 0 |
| hourly_rate = 0 for all trades | [2.5] cost calc | estimated_labor_cost = 0 until craft_rate table exists |
| Existing checklist_templates with NULL job_plan_id | [1.3] ALTER | Backward compatible — NULL means plan-level |
| Existing job_plans without asset_type_id | [1.3] ALTER | NULL = applies to all asset types |
| Idempotent PM generation | [3.3] test | Subsequent calls detect already-generated PMs |
| System user placeholder doesn't exist | [2.4] attachment | Must INSERT nil UUID into user_profiles first |
| Snapshot cost shouldn't change when plan updates | Architecture decision | Snapshot tables freeze data at WO creation time |
