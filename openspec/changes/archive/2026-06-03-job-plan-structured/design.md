# Design: Structured Job Plans (job-plan-structured)

## Technical Approach

Two sequential migrations following the existing Supabase conventions (idempotent `CREATE TABLE IF NOT EXISTS`, `DO $$` blocks for ENUMs, `ADD COLUMN IF NOT EXISTS`):

1. **Migration 1 — Schema** (`20260531000001_job_plan_structured.sql`): New tables `job_plan_labor`, `job_plan_safety`; ALTER `job_plans` (asset_type_id, is_active, updated_at); ALTER `checklist_templates` (job_plan_task_id); ALTER `work_orders` (cost columns); add `PENDING` to checklist_instances.status; WO snapshot tables; RLS; audit triggers; updated_at trigger.
2. **Migration 2 — PM Engine Extension** (`20260531000002_pm_engine_extend.sql`): Extends `generate_due_preventive_work_orders()` to clone labor → `work_order_labor_estimates`, safety → `work_order_safety_requirements`, checklists → `checklist_instances` (PENDING), compute estimated costs, advance PM schedules.

## Architecture Decisions

| Decision | Options | Tradeoffs | Chosen |
|----------|---------|-----------|--------|
| Labor & safety: separate tables vs JSONB on job_plans | (a) `job_plan_labor` + `job_plan_safety` tables (b) JSONB column on `job_plans` | (b) loses FK integrity, no RLS per trade/type, harder to query, no UNIQUE enforcement. (a) gives referential integrity, per-row RLS, proper indexing, UNIQUE(job_plan_id, trade) | **Separate tables** — RLS at row level is the deciding factor (TECHNICIAN must never DELETE labor rows) |
| WO estimates: snapshot vs live FK | (a) `work_order_labor_estimates` snapshot (b) live FK to `job_plan_labor` | (b) would change historical WO cost when the plan is updated months later — unacceptable for audit. Snapshot captures the exact estimate at WO creation time | **Snapshot tables** — labor estimates and safety requirements are frozen at WO generation, preserving audit trail |
| `job_plan_task_id` on `checklist_templates` nullable? | (a) nullable FK (b) NOT NULL | (b) would break ALL existing templates. (a) maintains backward compat: NULL = plan-level, set = task-level | **Nullable** — existing templates continue working; new templates opt in |
| `asset_type_id` on `job_plans` nullable? | (a) nullable FK (b) NOT NULL with default | (b) forces every plan to specify a type, which breaks existing data. (a) lets NULL mean "applies to all asset types" | **Nullable** — preserves existing plans; NULL = generic applicability |
| RLS: single multi-role policy vs per-role policies | (a) one policy per table with `get_user_role() IN (...)` (b) one policy per role per table | (b) is more granular but (a) matches the existing `job_plan_materials` pattern, is simpler to maintain, and avoids unbounded policy proliferation | **Single policy per operation per table** — matches project conventions; 4 policies × 4 tables = 16 total |
| Function return type | (a) `RETURNS INT` (b) `RETURNS TABLE(...)` | Original function used `RETURNS INT` (count of WOs created). Changing to TABLE would break callers | **RETURNS INT** — preserves backward compatibility with existing call sites |
| System user for auto-generated checklists | (a) nil UUID `00000000-0000-0000-0000-000000000000` (b) dedicated system user row | (a) violates FK unless the nil UUID is inserted into both `auth.users` and `user_profiles`. (b) requires migration + seeding | **Nil UUID with upfront INSERT** — migration inserts the system user before updating the function, ensuring FK integrity |

## Data Flow

```
pm_schedules (next_target_date <= CURRENT_DATE, NOT suppressed)
  │
  ▼
generate_due_preventive_work_orders()               [RETURNS INT — count of WOs created]
  │
  FOR EACH eligible pm_schedule:
  │
  ├── a. INSERT work_orders (PM, WAPPR, job_plan_id, estimated_hours)
  │
  ├── b. INSERT material_requests FROM job_plan_materials
  │        • part_num, line_desc, planned_qty
  │
  ├── c. INSERT work_order_labor_estimates FROM job_plan_labor
  │        • trade, estimated_hours, head_count, hourly_rate cloned
  │        • References job_plan_id for audit trail
  │
  ├── d. INSERT work_order_safety_requirements FROM job_plan_safety
  │        • safety_type, description, is_mandatory cloned
  │        • is_fulfilled = false
  │        • References job_plan_id for audit trail
  │
  ├── e. FOR EACH matching checklist_template:
  │        • WHERE is_active = true AND job_plan_task_id IS NULL (plan-level)
  │          AND (module_id match OR job_plan_id match OR both)
  │        • INSERT checklist_instances WITH status = 'PENDING'
  │        • technician_id = system nil UUID (placeholder)
  │
  ├── f. UPDATE work_orders SET
  │        estimated_hours = SUM(labor.estimated_hours × head_count)
  │        estimated_parts_cost = SUM(materials.planned_qty × parts.unit_cost)
  │        estimated_labor_cost = SUM(labor.estimated_hours × head_count × hourly_rate)
  │
  └── g. UPDATE pm_schedules SET
           last_completion_date = NOW()
           next_target_date = next_target_date + frequency_interval
```

## File Changes

### Migration 1: Schema (`supabase/migrations/20260531000001_job_plan_structured.sql`)

| Section | Change |
|---------|--------|
| 1 — `trade_enum` + `job_plan_labor` | `CREATE TYPE trade_enum AS ENUM (ELECTRICIAN, MECHANIC, INSTRUMENTIST, LUBRICATOR, HELPER, WELDER, OPERATOR)` + table with FK → job_plans ON DELETE CASCADE, UNIQUE(job_plan_id, trade), hourly_rate DEFAULT 0 |
| 2 — `safety_type_enum` + `job_plan_safety` | `CREATE TYPE safety_type_enum AS ENUM (PTW, LOTO, HOT_WORK, CONFINED_SPACE, HEIGHTS, EPP_ESPECIALIZADO, OTRO)` + table with FK → job_plans ON DELETE CASCADE, UNIQUE(job_plan_id, safety_type) |
| 3 — ALTER `job_plans` | `ADD COLUMN asset_type_id TEXT REFERENCES asset_types(id)`, `is_active BOOLEAN DEFAULT true`, `updated_at TIMESTAMPTZ` |
| 4 — ALTER `checklist_templates` | `ADD COLUMN job_plan_task_id UUID REFERENCES job_plan_tasks(id) ON DELETE SET NULL` |
| 5 — ALTER `work_orders` | `ADD COLUMN estimated_hours NUMERIC DEFAULT 0`, `estimated_parts_cost NUMERIC DEFAULT 0`, `estimated_labor_cost NUMERIC DEFAULT 0` |
| 6 — ALTER `checklist_instances` status | Recreate CHECK to include `'PENDING'` alongside existing statuses |
| 7 — ALTER `spare_parts` | `ADD COLUMN unit_cost NUMERIC DEFAULT 0` |
| 8 — `work_order_labor_estimates` | Snapshot table: trade, estimated_hours, head_count, hourly_rate, job_plan_id, UNIQUE(work_order_id, trade), FK → work_orders(id) |
| 9 — `work_order_safety_requirements` | Snapshot table: safety_type, description, is_mandatory, is_fulfilled, job_plan_id, UNIQUE(work_order_id, safety_type), partial index on `is_fulfilled = false` |
| 10 — RLS | 4 tables enabled. Per-operation policies: SELECT for TECHNICIAN/PLANNER/ADMIN, INSERT/UPDATE for PLANNER/ADMIN, DELETE for ADMIN only (16 policies total) |
| 11 — Audit triggers | `work_order_labor_estimates_audit` + `work_order_safety_requirements_audit` (AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, EXECUTE FUNCTION audit_trigger_func()) |
| 12 — `updated_at` trigger | `trg_job_plans_updated_at` BEFORE UPDATE ON job_plans, calls `set_job_plan_updated_at()` |

### Migration 2: PM Engine Extend (`supabase/migrations/20260531000002_pm_engine_extend.sql`)

| Section | Change |
|---------|--------|
| Setup — System user | INSERT INTO auth.users + user_profiles with nil UUID `00000000-0000-0000-0000-000000000000` |
| Function scaffold | `CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders() RETURNS INT` — uses WITH RECURSIVE due_chain CTE for hierarchical PM schedules |
| a — WO generation | INSERT work_orders with PM type, WAPPR lifecycle, estimated_hours from job_plan, descriptive symptom_note |
| b — Material cloning | INSERT material_requests FROM job_plan_materials LEFT JOIN spare_parts for description |
| c — Labor cloning | INSERT work_order_labor_estimates FROM job_plan_labor (trade, hours, head_count, hourly_rate) |
| d — Safety cloning | INSERT work_order_safety_requirements FROM job_plan_safety (type, description, mandatory) |
| e — Checklist attachment | FOR LOOP over matching templates (module_id OR job_plan_id), INSERT checklist_instances with status='PENDING', technician_id=nil UUID |
| f — Cost calculation | UPDATE work_orders — estimated_hours from snapshot, parts_cost from materials × unit_cost, labor_cost from snapshot × hourly_rate |
| g — Schedule advance | UPDATE pm_schedules SET last_completion_date=NOW(), advance next_target_date |

### Tests (`supabase/tests/database/job_plan_structured_test.sql`)

| Section | Tests | Description |
|---------|-------|-------------|
| T1 — Schema | 14 tests | Tables exist, ENUMs exist, PKs, UNIQUE constraints, new columns on existing tables |
| T2 — RLS (structure) | 4 tests | `policies_are()` for each of the 4 tables (all have 4 policies) |
| T2b — RLS (behavioral) | 7 tests | TECHNICIAN SELECT/INSERT/UPDATE/DELETE, PLANNER INSERT/DELETE, ADMIN DELETE |
| T3 — PM→WO Extension | 6 tests | Function exists, generates WO, labor clone count, safety clone count, checklist instances created, cost calculation |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | ENUM values, column types, NOT NULL, CHECK, UNIQUE, FK CASCADE/SET NULL | pgTAP `has_table`, `has_column`, `col_is_pk`, `col_is_unique`, `has_type` |
| RLS (structural) | Verify policy names per table | pgTAP `policies_are()` |
| RLS (behavioral) | TECHNICIAN read-only vs PLANNER write vs ADMIN delete | pgTAP with `SET LOCAL ROLE authenticated` + `SET LOCAL "request.jwt.claim.sub"` |
| PM→WO labor clone | AUTO insert → verify exact row count in `work_order_labor_estimates` | Start transaction, call function, check rows, rollback |
| PM→WO safety clone | AUTO insert → verify exact row count in `work_order_safety_requirements` | Same rollback pattern |
| PM→WO checklist attach | AUTO insert → verify `checklist_instances` created with status='PENDING' | Same rollback pattern |
| Cost calculation | Verify `estimated_parts_cost` matches materials × unit_cost (e.g., 2×15.50 + 1×45 = $76.00) | Same rollback pattern |

## Migration / Rollout

No data migration required — all new columns are nullable or have defaults. The system user UUID needs to exist in `auth.users` + `user_profiles` before the function can create checklist_instances (handled in Migration 2 setup).

**Rollback plan**:
1. Restore original `generate_due_preventive_work_orders()` from git
2. DROP new tables: `work_order_safety_requirements`, `work_order_labor_estimates`, `job_plan_safety`, `job_plan_labor`
3. DROP new columns from `job_plans`, `checklist_templates`, `work_orders`, `checklist_instances`, `spare_parts`
4. DROP ENUM types: `safety_type_enum`, `trade_enum`
5. DROP triggers: `trg_job_plans_updated_at`, audit triggers
6. DROP function: `set_job_plan_updated_at()`

Total DDL rollback — no data loss (new tables are reference data; snapshot tables are derived).
