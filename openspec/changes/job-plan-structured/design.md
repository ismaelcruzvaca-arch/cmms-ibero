# Design: Structured Job Plans

## Technical Approach

Two sequential migrations following the existing Supabase conventions (idempotent `CREATE TABLE IF NOT EXISTS`, `DO $$` blocks for ENUMs, `ADD COLUMN IF NOT EXISTS`):

1. **Migration 1 — Schema** (`20260531000001_job_plan_structured.sql`): New tables `job_plan_labor`, `job_plan_safety`; ALTER `job_plans` (asset_type_id, is_active, updated_at); ALTER `checklist_templates` (job_plan_task_id); ALTER `work_orders` (cost columns); add `PENDING` to checklist_instances.status; WO snapshot tables; RLS; audit triggers.
2. **Migration 2 — PM Engine extension**: Extend `generate_due_preventive_work_orders()` to clone labor → `work_order_labor_estimates`, safety → `work_order_safety_requirements`, checklists → `checklist_instances` (PENDING), compute estimated costs.

## Architecture Decisions

| Decision | Options | Tradeoffs | Chosen |
|----------|---------|-----------|--------|
| Labor & safety: separate tables vs JSONB on job_plans | (a) `job_plan_labor` + `job_plan_safety` tables (b) JSONB column on `job_plans` | (b) loses FK integrity, no RLS per trade/type, harder to query, no UNIQUE enforcement. (a) gives referential integrity, per-row RLS, proper indexing, UNIQUE(job_plan_id, trade) | **Separate tables** — RLS at row level is the deciding factor (TECHNICIAN must never DELETE labor rows) |
| WO estimates: snapshot vs live FK | (a) `work_order_labor_estimates` snapshot (b) live FK to `job_plan_labor` | (b) would change historical WO cost when the plan is updated months later — unacceptable for audit. Snapshot captures the exact estimate at WO creation time | **Snapshot tables** — labor estimates and safety requirements are frozen at WO generation, preserving audit trail |
| `job_plan_task_id` on `checklist_templates` nullable? | (a) nullable FK (b) NOT NULL | (b) would break ALL existing templates. (a) maintains backward compat: NULL = plan-level, set = task-level | **Nullable** — existing templates continue working; new templates opt in |
| `asset_type_id` on `job_plans` nullable? | (a) nullable FK (b) NOT NULL with default | (b) forces every plan to specify a type, which breaks existing data. (a) lets NULL mean "applies to all asset types" | **Nullable** — preserves existing plans; NULL = generic applicability |

## Data Flow

```
pm_schedules (next_target_date <= TODAY, NOT suppressed)
  │
  ▼
generate_due_preventive_work_orders()
  │
  ├── 1. INSERT work_orders (PM, WAPPR, job_plan_id, planned_hours)
  │
  ├── 2. INSERT material_requests FROM job_plan_materials (existing)
  │
  ├── 3. INSERT work_order_labor_estimates FROM job_plan_labor
  │        • trade, estimated_hours, head_count, hourly_rate cloned
  │
  ├── 4. INSERT work_order_safety_requirements FROM job_plan_safety
  │        • safety_type, description, is_mandatory cloned
  │
  ├── 5. INSERT checklist_instances FROM checklist_templates
  │        • WHERE module_id = asset.module_id
  │          AND (job_plan_id IS NULL OR job_plan_id = pm.job_plan_id)
  │        • status = 'PENDING' (new ALTERed value)
  │        • No technician assigned yet (system-created)
  │
  └── 6. UPDATE work_orders SET
           estimated_hours = SUM(labor.estimated_hours × head_count)
           estimated_parts_cost = SUM(materials.planned_qty × parts.unit_cost)
           estimated_labor_cost = SUM(labor.estimated_hours × head_count × hourly_rate)
```

## File Changes

### Migration 1: Schema (`supabase/migrations/20260531000001_job_plan_structured.sql`)

| Section | Change |
|---------|--------|
| 1 — `trade_enum` + `job_plan_labor` | `CREATE TYPE trade_enum AS ENUM (...)` + table with FK → job_plans ON DELETE CASCADE, UNIQUE(job_plan_id, trade) |
| 2 — `safety_type_enum` + `job_plan_safety` | `CREATE TYPE safety_type_enum AS ENUM (...)` + table with FK → job_plans ON DELETE CASCADE, UNIQUE(job_plan_id, safety_type) |
| 3 — ALTER `job_plans` | `ADD COLUMN asset_type_id TEXT REFERENCES asset_types(id)`, `is_active BOOLEAN DEFAULT true`, `updated_at TIMESTAMPTZ` |
| 4 — ALTER `checklist_templates` | `ADD COLUMN job_plan_task_id UUID REFERENCES job_plan_tasks(id) ON DELETE SET NULL` |
| 5 — ALTER `work_orders` | `ADD COLUMN estimated_hours NUMERIC`, `estimated_parts_cost NUMERIC`, `estimated_labor_cost NUMERIC` |
| 6 — ALTER `checklist_instances` status | Recreate CHECK to include `'PENDING'` alongside existing statuses |
| 7 — ALTER `spare_parts` | `ADD COLUMN unit_cost NUMERIC DEFAULT 0` (needed for cost calculation) |
| 8 — `work_order_labor_estimates` | Snapshot table: trade, estimated_hours, head_count, hourly_rate, UNIQUE(work_order_id, trade) |
| 9 — `work_order_safety_requirements` | Snapshot table: safety_type, description, is_mandatory, is_fulfilled, UNIQUE(work_order_id, safety_type) |
| 10 — RLS | 4 new tables: TECHNICIAN=SELECT, PLANNER=SELECT+INSERT+UPDATE, ADMIN=ALL (matches `job_plan_materials` pattern) |
| 11 — Audit triggers | `work_order_labor_estimates_audit` + `work_order_safety_requirements_audit` |
| 12 — `updated_at` trigger | `trg_job_plans_updated_at` BEFORE UPDATE ON job_plans |

### Migration 2: PM Engine Extend

| File | Action |
|------|--------|
| `supabase/migrations/20260531000002_pm_engine_extend.sql` | New — `CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()` with labor/safety/checklist/cost cloning |

### Tests

| File | Action |
|------|--------|
| `supabase/tests/database/job_plan_structured_test.sql` | New — pgTAP: schema validation, FK enforcement, RLS policies, PM→WO extension scenarios |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | ENUM values, column types, NOT NULL, CHECK, UNIQUE, FK CASCADE/SET NULL | pgTAP `has_table`, `has_column`, `col_not_null`, `has_check`, `has_type` |
| RLS | TECHNICIAN SELECT-only vs PLANNER INSERT/UPDATE vs ADMIN DELETE | pgTAP with `set_role('authenticated')` + `get_user_role()` mock |
| PM→WO labor clone | AUTO insert → verify exact row count + column values in `work_order_labor_estimates` | Start transaction, call function, check rows, rollback |
| PM→WO safety clone | AUTO insert → verify safety_type + description in `work_order_safety_requirements` | Same rollback pattern |
| PM→WO checklist attach | AUTO insert → verify `checklist_instances` created with status='PENDING' | Same rollback pattern |
| Cost calculation | Verify `estimated_hours`, `estimated_parts_cost`, `estimated_labor_cost` are computed correctly | Same rollback pattern |

## Migration / Rollout

No data migration required — all new columns are nullable or have defaults. Rollback: DROP new tables, DROP new columns from `job_plans`, `checklist_templates`, `work_orders`, `checklist_instances`, `spare_parts`; restore original `generate_due_preventive_work_orders()` from git.

## Open Questions

- [ ] `hourly_rate` — labor spec says "deferred to future craft_rate table" but the schema has a column. Use default rate 0 until craft_rate table exists? Or add a config table (`config.default_labor_rate`)?
- [ ] System user for auto-generated checklist_instances — `technician_id` is NOT NULL; use a system UUID placeholder for PM-generated instances?
