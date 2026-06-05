# Tasks: Structured Job Plans (job-plan-structured)

> 16 tasks across 3 phases. All completed and deployed.
> Migration 1 has 12 sections covering 4 new tables, 4 ALTERs, 2 audit triggers, 1 updated_at trigger, RLS.
> Migration 2 extends `generate_due_preventive_work_orders()` with 4 new cloning/cost blocks + schedule advancement.
> Tests cover 31 pgTAP assertions (schema: 14, RLS: 11, PM→WO integration: 6).
>
> Design ref: `design.md`. Specs: `spec.md` (root), `specs/job-plan-labor/`, `specs/job-plan-safety/`.

---

## Design Decisions (Resolved)

- **hourly_rate**: Column exists on `job_plan_labor` and `work_order_labor_estimates` with DEFAULT 0. Used as-is; future craft_rate table will populate real rates. **Resolution: DEFAULT 0, hardcoded rate deferred**.
- **System user for auto-generated checklist_instances**: `checklist_instances.technician_id` FK requires a valid user. **Resolution: nil UUID `00000000-0000-0000-0000-000000000000` inserted into auth.users + user_profiles** in Migration 2 before the function update.
- **Function return type**: Original `generate_due_preventive_work_orders()` returned INT. **Resolution: preserve RETURNS INT** — changing to TABLE would break callers.

---

## Phase 1: Schema Migration

> Single migration file: `supabase/migrations/20260531000001_job_plan_structured.sql`
> Convention: idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$` blocks), `COMMENT ON` in Spanish, snake_case.

---

### [x] 1.1 Migration Section 1 — `trade_enum` + `job_plan_labor` table

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (first Phase 1 task)
- **Acceptance**:
  - `trade_enum` ENUM type created with values: `'ELECTRICIAN'`, `'MECHANIC'`, `'INSTRUMENTIST'`, `'LUBRICATOR'`, `'HELPER'`, `'WELDER'`, `'OPERATOR'`
  - `job_plan_labor` table exists with columns: `id UUID PK DEFAULT gen_random_uuid()`, `job_plan_id UUID NOT NULL FK → job_plans(id) ON DELETE CASCADE`, `trade trade_enum NOT NULL`, `estimated_hours NUMERIC NOT NULL CHECK (> 0)`, `head_count INT DEFAULT 1 CHECK (> 0)`, `hourly_rate NUMERIC DEFAULT 0`
  - UNIQUE constraint on `(job_plan_id, trade)`
  - INDEX on `job_plan_id`
  - COMMENT ON table and all columns in Spanish

---

### [x] 1.2 Migration Section 2 — `safety_type_enum` + `job_plan_safety` table

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (independent of 1.1)
- **Acceptance**:
  - `safety_type_enum` ENUM type created with values: `'PTW'`, `'LOTO'`, `'HOT_WORK'`, `'CONFINED_SPACE'`, `'HEIGHTS'`, `'EPP_ESPECIALIZADO'`, `'OTRO'`
  - `job_plan_safety` table exists with columns: `id UUID PK DEFAULT gen_random_uuid()`, `job_plan_id UUID NOT NULL FK → job_plans(id) ON DELETE CASCADE`, `safety_type safety_type_enum NOT NULL`, `description TEXT nullable`, `is_mandatory BOOLEAN DEFAULT true`
  - UNIQUE constraint on `(job_plan_id, safety_type)`
  - INDEX on `job_plan_id`
  - COMMENT ON table and all columns in Spanish

---

### [x] 1.3 Migration Sections 3-4 — ALTER `job_plans` + ALTER `checklist_templates`

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

### [x] 1.4 Migration Sections 5-6 — ALTER `work_orders` + ALTER `checklist_instances` status

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None
- **Acceptance**:
  - `work_orders` has 3 new columns (`ADD COLUMN IF NOT EXISTS`):
    - `estimated_hours NUMERIC DEFAULT 0`
    - `estimated_parts_cost NUMERIC DEFAULT 0`
    - `estimated_labor_cost NUMERIC DEFAULT 0`
  - `checklist_instances` status CHECK constraint is **replaced** to include `'PENDING'` alongside existing values
    - Pattern: `DROP CONSTRAINT IF EXISTS ...; ADD CONSTRAINT ... CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','VOID'))`
  - COMMENT ON all new columns in Spanish

---

### [x] 1.5 Migration Section 7 — ALTER `spare_parts` (add `unit_cost`)

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None
- **Acceptance**:
  - `spare_parts` has 1 new column:
    - `unit_cost NUMERIC DEFAULT 0` — needed for `estimated_parts_cost` calculation
  - COMMENT ON column in Spanish

---

### [x] 1.6 Migration Sections 8-9 — Snapshot tables: `work_order_labor_estimates` + `work_order_safety_requirements`

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: None (new tables, no FK to other new tables)
- **Acceptance**:

  **`work_order_labor_estimates`** (SNAPSHOT — not live FK to job_plan_labor):
  - Columns: `id UUID PK`, `work_order_id TEXT NOT NULL FK → work_orders(id)`, `job_plan_id UUID FK → job_plans(id)` (nullable, referential), `trade trade_enum NOT NULL`, `estimated_hours NUMERIC NOT NULL`, `head_count INT DEFAULT 1`, `hourly_rate NUMERIC DEFAULT 0`
  - UNIQUE constraint on `(work_order_id, trade)`
  - INDEX on `work_order_id`
  - COMMENT ON table and columns in Spanish

  **`work_order_safety_requirements`** (SNAPSHOT — not live FK to job_plan_safety):
  - Columns: `id UUID PK`, `work_order_id TEXT NOT NULL FK → work_orders(id)`, `job_plan_id UUID FK → job_plans(id)` (nullable, referential), `safety_type safety_type_enum NOT NULL`, `description TEXT nullable`, `is_mandatory BOOLEAN DEFAULT true`, `is_fulfilled BOOLEAN DEFAULT false`
  - UNIQUE constraint on `(work_order_id, safety_type)`
  - INDEX on `work_order_id`
  - Partial index `idx_wosr_unfulfilled ON work_order_safety_requirements(is_fulfilled) WHERE is_fulfilled = false`
  - COMMENT ON table and columns in Spanish

- **Notes**:
  - `hourly_rate` defaults to 0 (placeholder until craft_rate table exists)
  - `is_fulfilled` on safety is a runtime field set during WO execution (deferred)
  - Both tables reference `work_orders` ON DELETE CASCADE (snapshot deleted when WO is deleted)
  - `job_plan_id` is stored for audit trail but not enforced as FK (referential)

---

### [x] 1.7 Migration Section 10 — RLS policies on all 4 new tables

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: [1.1], [1.2], [1.6] (all new tables must exist)
- **Acceptance**:

  RLS policy matrix (uses existing `get_user_role()` function, single policy per operation):

  | Table | TECHNICIAN | PLANNER | ADMIN |
  |-------|-----------|---------|-------|
  | `job_plan_labor` | SELECT | SELECT / INSERT / UPDATE | ALL |
  | `job_plan_safety` | SELECT | SELECT / INSERT / UPDATE | ALL |
  | `work_order_labor_estimates` | SELECT | SELECT / INSERT / UPDATE | ALL |
  | `work_order_safety_requirements` | SELECT | SELECT / INSERT / UPDATE | ALL |

  - All 4 tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  - Per-table naming convention: `{abbr}_{select|insert|update|delete}` (e.g., `jpl_select`, `jpl_insert`, `jpl_update`, `jpl_delete`)
  - SELECT policies: `get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')`
  - INSERT/UPDATE policies: `get_user_role() IN ('PLANNER', 'ADMIN')`
  - DELETE policies: `get_user_role() = 'ADMIN'`

---

### [x] 1.8 Migration Sections 11-12 — Audit triggers + `updated_at` trigger

- **Files**: `supabase/migrations/20260531000001_job_plan_structured.sql`
- **Depends on**: [1.6] (snapshot tables exist for audit), [1.3] (`job_plans.updated_at` exists)
- **Acceptance**:
  - `work_order_labor_estimates_audit` trigger: AFTER INSERT OR UPDATE OR DELETE ON `work_order_labor_estimates`, FOR EACH ROW, `EXECUTE FUNCTION audit_trigger_func()`
  - `work_order_safety_requirements_audit` trigger: AFTER INSERT OR UPDATE OR DELETE ON `work_order_safety_requirements`, FOR EACH ROW, `EXECUTE FUNCTION audit_trigger_func()`
  - `trg_job_plans_updated_at` trigger: BEFORE UPDATE ON `job_plans`, FOR EACH ROW, `EXECUTE FUNCTION set_job_plan_updated_at()` (dedicated function that sets `NEW.updated_at = NOW()`)
  - `set_job_plan_updated_at()` function: LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  - Audit triggers use the same pattern as existing audit triggers in the project (`audit_trigger_func()`)
  - Idempotent: use `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` pattern

---

## Phase 2: PM Engine Extension

> Single migration file: `supabase/migrations/20260531000002_pm_engine_extend.sql`
> Uses `CREATE OR REPLACE FUNCTION` to replace the existing function.
> Adds system user setup before function definition.
> The function body is one transaction — all WOs, estimates, safety, checklists, and cost updates either succeed together or roll back together.

---

### [x] 2.1 System user setup + scaffold the new function

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Phase 1 (all new tables exist)
- **Acceptance**:
  - System user INSERT into `auth.users` with nil UUID `00000000-0000-0000-0000-000000000000`, email `system@gema.local`, encrypted password placeholder — `ON CONFLICT (id) DO NOTHING`
  - System user INSERT into `user_profiles` with nil UUID, role `'ADMIN'` — `ON CONFLICT (id) DO NOTHING`
  - `CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()` with `RETURNS INT` (same signature as existing)
  - Uses `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`
  - All original logic preserved: WITH RECURSIVE due_chain CTE for hierarchical PM schedules, eligible CTE filtering suppressed + asset/job_plan joins
  - **Notes**: The original function used `RETURNS INT` (count of WOs created). The replacement preserves this signature. Existing CTE logic for due_chain (hierarchical parent/child schedule traversal) must be preserved.

---

### [x] 2.2 Add labor estimate cloning block (step c)

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded with WO + material blocks)
- **Acceptance**:
  - After WO INSERT + material request cloning, add `INSERT INTO work_order_labor_estimates (work_order_id, job_plan_id, trade, estimated_hours, head_count, hourly_rate)`
  - Source: `SELECT v_wo_id, r.job_plan_id, jpl.trade, jpl.estimated_hours, jpl.head_count, jpl.hourly_rate FROM job_plan_labor jpl WHERE jpl.job_plan_id = r.job_plan_id`
  - `job_plan_id` stored for audit trail (referential, not enforced as FK)
  - Skips if no labor rows exist for the job plan (0 rows inserted, no error)

---

### [x] 2.3 Add safety requirement cloning block (step d)

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After labor estimate cloning, add `INSERT INTO work_order_safety_requirements (work_order_id, job_plan_id, safety_type, description, is_mandatory)`
  - Source: `SELECT v_wo_id, r.job_plan_id, jps.safety_type, jps.description, jps.is_mandatory FROM job_plan_safety jps WHERE jps.job_plan_id = r.job_plan_id`
  - `is_fulfilled` defaults to `false` (not included in INSERT, uses table default)
  - Skips if no safety rows exist for the job plan (0 rows inserted, no error)

---

### [x] 2.4 Add checklist template attachment block (step e)

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After safety cloning, add a FOR LOOP over matching `checklist_templates`
  - Filter logic:
    ```sql
    WHERE ct.is_active = true
      AND ct.job_plan_task_id IS NULL  -- Plan-level only (no task-specific)
      AND (
        (ct.module_id = r.module_id AND ct.job_plan_id IS NULL)       -- Module-level only
        OR (ct.job_plan_id = r.job_plan_id AND ct.module_id IS NULL)  -- Job-plan-level only
        OR (ct.module_id = r.module_id AND ct.job_plan_id = r.job_plan_id) -- Both must match
      )
    ```
  - INSERT into `checklist_instances`:
    - `status = 'PENDING'`
    - `technician_id = '00000000-0000-0000-0000-000000000000'` (system placeholder)
    - `asset_id = r.asset_id::text`
    - `evaluator_source = 'SELF'`
    - `evaluated_by = v_system_user_id`
    - `notes = 'Generado automáticamente desde job_plan ' || r.code`
    - `started_at = NULL`, `created_at = NOW()`
  - Skips if no templates match (0 instances created, no error)

- **Notes**:
  - The nil UUID system user must already exist — handled by [2.1] setup block
  - FOR LOOP is inside the main record loop (one iteration per template match)

---

### [x] 2.5 Add cost calculation and `work_orders` UPDATE block (step f)

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.2], [2.3] (cost data must be inserted first)
- **Acceptance**:
  - After all inserts, compute and UPDATE the newly created work order:
    ```sql
    UPDATE work_orders
    SET
      estimated_hours = COALESCE((
        SELECT SUM(wole.estimated_hours * wole.head_count)
        FROM work_order_labor_estimates wole
        WHERE wole.work_order_id = v_wo_id
      ), 0),
      estimated_parts_cost = COALESCE((
        SELECT SUM(jpm.planned_qty * COALESCE(sp.unit_cost, 0))
        FROM job_plan_materials jpm
        LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
        WHERE jpm.job_plan_id = r.job_plan_id
      ), 0),
      estimated_labor_cost = COALESCE((
        SELECT SUM(wole.estimated_hours * wole.head_count * wole.hourly_rate)
        FROM work_order_labor_estimates wole
        WHERE wole.work_order_id = v_wo_id
      ), 0)
    WHERE id = v_wo_id;
    ```
  - Uses snapshot tables as source of truth (not live job_plan tables)
  - Each cost component independently defaults to 0 if no source data exists
  - `estimated_labor_cost` uses `hourly_rate` from snapshot (may be 0 until craft_rate table populated)

---

### [x] 2.6 Add PM schedule advancement (step g)

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: [2.1] (function body scaffolded)
- **Acceptance**:
  - After cost calculation, UPDATE `pm_schedules`:
    ```sql
    UPDATE pm_schedules
    SET
      last_completion_date = NOW(),
      next_target_date = next_target_date + (r.time_frequency_days || ' days')::INTERVAL
    WHERE id = r.schedule_id;
    ```
  - `last_completion_date` tracks when the WO was generated
  - `next_target_date` advances by the schedule's frequency interval
  - Count `v_created` incremented per schedule processed
  - Return `v_created` at end of function

---

## Phase 3: Tests

> Single test file: `supabase/tests/database/job_plan_structured_test.sql`
> Follows existing pgTAP pattern: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`
> Uses `SAVEPOINT`/`ROLLBACK TO` for test isolation.
> Total: 31 tests (14 schema + 11 RLS + 6 PM→WO integration).

---

### [x] 3.1 pgTAP — Schema validation tests (14 tests)

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: Phase 1 (migration applied)
- **Acceptance**:
  - `has_table('job_plan_labor')`, `has_table('job_plan_safety')`, `has_table('work_order_labor_estimates')`, `has_table('work_order_safety_requirements')`
  - `has_type('trade_enum')`, `has_type('safety_type_enum')`
  - `col_is_pk('job_plan_labor', 'id')`, `col_is_pk('job_plan_safety', 'id')`
  - `col_is_unique('job_plan_labor', ARRAY['job_plan_id', 'trade'])`
  - `col_is_unique('job_plan_safety', ARRAY['job_plan_id', 'safety_type'])`
  - `has_column('job_plans', 'asset_type_id')`, `has_column('job_plans', 'is_active')`
  - `has_column('checklist_templates', 'job_plan_task_id')`
  - `has_column('spare_parts', 'unit_cost')`

---

### [x] 3.2 pgTAP — RLS structural + behavioral tests (11 tests)

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: [1.7] (RLS policies applied)
- **Acceptance**:

  **Structural (4 tests)**:
  - `policies_are('job_plan_labor', ARRAY['jpl_select','jpl_insert','jpl_update','jpl_delete'])`
  - `policies_are('job_plan_safety', ARRAY['jps_select','jps_insert','jps_update','jps_delete'])`
  - `policies_are('work_order_labor_estimates', ARRAY['wole_select','wole_insert','wole_update','wole_delete'])`
  - `policies_are('work_order_safety_requirements', ARRAY['wosr_select','wosr_insert','wosr_update','wosr_delete'])`

  **Behavioral (7 tests)**:
  - Test 19: TECHNICIAN can SELECT job_plan_labor (COUNT = 2)
  - Test 20: TECHNICIAN cannot INSERT job_plan_labor (throws 23514)
  - Test 21: TECHNICIAN cannot UPDATE job_plan_labor (hours unchanged)
  - Test 22: TECHNICIAN cannot DELETE job_plan_labor (row still exists)
  - Test 23: PLANNER can INSERT job_plan_labor (lives_ok)
  - Test 24: PLANNER cannot DELETE job_plan_labor (row still exists)
  - Test 25: ADMIN can DELETE job_plan_labor (COUNT = 0)

  - Tests use `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" TO '...'` with corresponding user_profiles entries created in setup
  - Each test wrapped in SAVEPOINT/ROLLBACK TO for isolation

---

### [x] 3.3 pgTAP — PM→WO extension integration tests (6 tests)

- **Files**: `supabase/tests/database/job_plan_structured_test.sql`
- **Depends on**: Phase 2 (new function deployed)
- **Acceptance**:

  **Setup** (rolled back at test end):
  - Insert asset_types, assets, job_plan with labor + safety + materials, spare_parts, pm_schedule, checklist_templates
  - Insert technician/planner/admin test users in auth.users + user_profiles
  - Typical setup: 1 job plan, 2 labor rows (MECHANIC 2h, ELECTRICIAN 1h), 2 safety rows (LOTO, PTW), 2 materials (BRG-6205 × 2, SEAL-001 × 1), 1 pm_schedule due yesterday, 1 checklist_template

  **Test 26 — Function exists**: `has_function('generate_due_preventive_work_orders')`
  **Test 27 — Generates at least 1 WO**: `generate_due_preventive_work_orders() >= 1`
  **Test 28 — Labor clone**: Verify 2 rows in `work_order_labor_estimates` for the job_plan_id
  **Test 29 — Safety clone**: Verify 2 rows in `work_order_safety_requirements` for the job_plan_id
  **Test 30 — Checklist instances**: Verify `checklist_instances` created with `status = 'PENDING'` AND `notes LIKE '%JP-TEST-PLAN%'`
  **Test 31 — Cost calculation**: Verify `estimated_parts_cost = 76.00` (2 bearings × $15.50 + 1 seal × $45.00 = $76.00)

  - All tests wrapped in SAVEPOINT/ROLLBACK TO for isolation
  - Setup data uses `ON CONFLICT DO NOTHING` for idempotency

---

## Summary

| Phase | Tasks | Key Artifacts |
|-------|-------|---------------|
| 1. Schema Migration | 1.1 → 1.8 | `20260531000001_job_plan_structured.sql` — 12 sections, 4 new tables, 4 ALTERs, RLS, triggers |
| 2. PM Engine Extension | 2.1 → 2.6 | `20260531000002_pm_engine_extend.sql` — extends `generate_due_preventive_work_orders()` with labor/safety/checklist cloning, cost calc, schedule advancement |
| 3. Tests | 3.1 → 3.3 | `job_plan_structured_test.sql` — pgTAP with 31 tests (schema: 14, RLS: 11, PM→WO: 6) |

### Total Artifacts

| Artifact | Lines |
|----------|-------|
| `proposal.md` | 70 |
| `spec.md` | ~250 |
| `specs/job-plan-labor/spec.md` | 86 |
| `specs/job-plan-safety/spec.md` | 82 |
| `specs/preventive-condition-core/delta.md` | 89 |
| `specs/pm-engine-automata/delta.md` | 49 |
| `design.md` | ~180 |
| `tasks.md` | ~410 |
| `20260531000001_job_plan_structured.sql` | 335 |
| `20260531000002_pm_engine_extend.sql` | 191 |
| `job_plan_structured_test.sql` | 357 |

### Edge Cases Handled

| Edge Case | Where Handled | Mechanism |
|-----------|--------------|-----------|
| Job plan has no labor rows | [2.2] cloning | 0 rows inserted, no error |
| Job plan has no safety rows | [2.3] cloning | 0 rows inserted, no error |
| Job plan has no checklist templates | [2.4] attachment | 0 instances created, no error |
| Job plan has no materials | [2.5] cost calc | estimated_parts_cost defaults to 0 |
| hourly_rate = 0 for all trades | [2.5] cost calc | estimated_labor_cost = 0 until craft_rate table exists |
| Existing checklist_templates with NULL job_plan_task_id | [1.3] ALTER | Backward compatible — ON DELETE SET NULL, NULL means plan-level |
| Existing job_plans without asset_type_id | [1.3] ALTER | NULL = applies to all asset types (generic) |
| System user placeholder FK violation | [2.1] setup | INSERT nil UUID into auth.users + user_profiles before function |
| Snapshot cost shouldn't change when plan updates | Architecture decision | Snapshot tables freeze data at WO creation time |
| Hierarchical PM schedules (parent/child) | [2.1] CTE | WITH RECURSIVE due_chain handles 2-level hierarchy |
| Idempotent re-runs | [2.1] CTE | suppressed schedules not reprocessed; next_target_date advances |
