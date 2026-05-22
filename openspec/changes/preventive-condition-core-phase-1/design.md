# Design: Preventive & Condition-Based Maintenance — Core Schema Phase 1

## Technical Approach

Single idempotent migration (`supabase/migrations/20260522000001_preventive_condition_core.sql`) creating 7 tables in `public` schema. Three table groups with strict FK chains: PM templates (`job_plans` → tasks/materials), schedules (`pm_schedules` → assets + job_plans + self-FK suppression), and condition monitoring (`meters` → measure_points → meter_readings → assets). RLS enabled on all tables using the existing `get_user_role()` helper from Migration 1. No triggers, functions, or application logic — pure schema.

## Architecture Decisions

### Decision: CHECK constraints over ENUMs for intervention_type and meter_type

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `CREATE TYPE` ENUM | Persistent, cannot be dropped without CASCADE; schema migration overhead for new values | ❌ Rejected |
| `CHECK (IN (...))` | Flexible at DDL level, easy to extend with ALTER TABLE DROP/ADD CONSTRAINT | ✅ **Chosen** |

**Rationale**: ENUMs in Postgres are painful to evolve. Existing migrations already use CHECK constraints (e.g., `lifecycle_phase` in Migration 1 IS an ENUM, but that was needed for FSM trigger typing). For these two purely categorical fields, CHECK gives us the same domain enforcement without ALTER TYPE migration cost.

### Decision: Separate columns for time/meter frequency (not JSONB)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| JSONB `frequency` column | Flexible for hybrid schedules, but harder to index, query, and validate at schema level | ❌ Rejected |
| `time_frequency_days INT` / `meter_frequency_value NUMERIC` | Queryable, indexable, CHECK constraints possible, nullable for either-or | ✅ **Chosen** |

**Rationale**: The spec defines separate columns. This matches how PM scheduling works in practice — a schedule is EITHER time-driven OR meter-driven OR both. Separate columns make SQL queries (`WHERE time_frequency_days IS NOT NULL`) trivial and avoid JSONB parsing in application code.

### Decision: part_num as nullable TEXT without FK to spare_parts

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `FK → spare_parts(part_num)` | Referential integrity, but tight coupling; Epicor sync edge cases | ❌ Rejected |
| `TEXT nullable` | Loose coupling, planner can enter free-text part numbers | ✅ **Chosen** |

**Rationale**: The proposal and spec mention a FK, but the inventory Epicor integration revealed that `spare_parts` gets synced externally and part numbers can change or be pending. Planners need to define job plan templates with part numbers that may not yet exist in `spare_parts`. Loose coupling avoids sync-ordering problems.

### Decision: RLS per role using existing get_user_role() helper

**Choice**: Reuse `get_user_role()` from Migration 1 for all policies. ADMIN/PLANNER: full ALL policies on all 7 tables. TECHNICIAN: SELECT on all, INSERT only on `meter_readings`.

**Rationale**: Consistent with existing `work_orders` and `assets` RLS patterns in the codebase. No need for a new permission system.

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                   PM TEMPLATES GROUP                     │
│                                                          │
│  job_plans ──→ job_plan_tasks  (1:N, cascade)            │
│  job_plans ──→ job_plan_materials (1:N, cascade)         │
└──────────────────────┬──────────────────────────────────┘
                       │ job_plan_id (FK)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   SCHEDULES GROUP                        │
│                                                          │
│  assets ──→ pm_schedules ←── job_plans                   │
│               │ self-FK (suppression chain)              │
│               │ parent_schedule_id (nullable)            │
└──────────────────────┬──────────────────────────────────┘
                       │ asset_id (FK)
                       ▼
┌─────────────────────────────────────────────────────────┐
│               CONDITION MONITORING GROUP                  │
│                                                          │
│  assets ──→ meters ──→ measure_points (1:N, cascade)    │
│               │                                           │
│               └──→ meter_readings (1:N, cascade)          │
└─────────────────────────────────────────────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260522000001_preventive_condition_core.sql` | Create | Single idempotent migration with all 7 tables, indexes, RLS |
| `openspec/changes/preventive-condition-core-phase-1/design.md` | Create | This design document |

## Interfaces / Contracts

### PK convention across all 7 tables

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

### RLS policy template

```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY {table}_all_admin ON {table}
  FOR ALL USING (get_user_role() = 'ADMIN');

CREATE POLICY {table}_all_planner ON {table}
  FOR ALL USING (get_user_role() = 'PLANNER');

CREATE POLICY {table}_select_technician ON {table}
  FOR SELECT USING (get_user_role() = 'TECHNICIAN');
```

Exception: `meter_readings` gets an additional `INSERT` policy for TECHNICIAN.

### Key FK chains

```
job_plan_tasks.job_plan_id       → job_plans(id) ON DELETE CASCADE
job_plan_materials.job_plan_id   → job_plans(id) ON DELETE CASCADE
pm_schedules.asset_id            → assets(id)        (TEXT match)
pm_schedules.job_plan_id         → job_plans(id)
pm_schedules.parent_schedule_id  → pm_schedules(id)  (self-FK, nullable)
meters.asset_id                  → assets(id)        (TEXT match)
measure_points.meter_id          → meters(id) ON DELETE CASCADE
meter_readings.meter_id          → meters(id) ON DELETE CASCADE
```

### CHECK constraints

```sql
intervention_type TEXT NOT NULL CHECK (intervention_type IN ('INSPECTION','LUBRICATION','MINOR_SERVICE','OVERHAUL'))
meter_type TEXT NOT NULL CHECK (meter_type IN ('CONTINUOUS','GAUGE','CHARACTERISTIC'))
planned_qty NUMERIC NOT NULL CHECK (planned_qty > 0)
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | All 7 tables created, FK chains intact | Run migration against test DB, verify `\dt` and FK metadata |
| Integration | CHECK constraints reject bad data | Insert invalid intervention_type, meter_type, zero planned_qty — expect constraint violations |
| Integration | UNIQUE constraint on job_plan_tasks | Insert duplicate step_sequence for same job_plan_id — expect unique violation |
| Integration | RLS policies per role | Create test users per role via `auth.users()`, verify DML success/failure per table |
| Integration | Cascade deletes | Delete job_plan — verify tasks and materials deleted. Delete meter — verify measure_points and readings deleted |
| Integration | Suppression self-FK | Create parent and child pm_schedules, verify FK allows tree structure |

## Migration / Rollout

**Migration**: Single forward-only file, `CREATE TABLE IF NOT EXISTS` for idempotency. Run via `supabase db push` or manual execution against the target database.

**Rollback plan**: `DROP TABLE IF EXISTS meter_readings, measure_points, meters, pm_schedules, job_plan_materials, job_plan_tasks, job_plans CASCADE;` — no data loss since no production data exists yet for these tables.

**Migration order in file**: job_plans → job_plan_tasks + job_plan_materials → pm_schedules → meters → measure_points → meter_readings. FK creation and RLS at the end, after all parent tables exist.

## Open Questions

- None. Spec, proposal, and design are aligned.
