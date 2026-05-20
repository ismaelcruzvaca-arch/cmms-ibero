# Work Order FSM & Schema Phase 1 — Specification

## Purpose

Define the database-layer upgrade for work_orders from a basic 12-field v1 schema to an enterprise CMMS schema with FSM-enforced status transitions, referential integrity, audit trail, and retry-loop defense — without breaking offline-first replication or renaming existing states.

**Scope**: Database layer ONLY. Zero UI changes.

---

## Functional Requirements

### Requirement: Work Order Schema v2 (RxDB)

The system MUST bump the RxDB `work_orders` collection from schema version 1 to version 2.

The v2 schema MUST retain all v1 fields (`id`, `equipment_id`, `description`, `location`, `criticality`, `status`, `priority`, `assigned_to`, `scheduled_date`, `completed_date`, `created_at`, `updated_at`) and MUST add the following fields:

| Field | Type | Constraints |
|-------|------|-------------|
| `asset_id` | `string`, maxLength 100 | Required. References `assets.id` |
| `wo_type` | `string` | Enum: `preventive`, `corrective`, `predictive`, `emergency`, `inspection` |
| `planned_hours` | `number` | Non-negative |
| `actual_hours` | `number` | Non-negative |
| `cost_estimate` | `number` | Non-negative |
| `actual_cost` | `number` | Non-negative |
| `requested_by` | `string` | |
| `approved_by` | `string` | |
| `approval_date` | `string` | ISO 8601 date string |
| `start_date` | `string` | ISO 8601 date string |
| `end_date` | `string` | ISO 8601 date string |
| `hold_reason` | `string` | |
| `close_reason` | `string` | |
| `cancel_reason` | `string` | |
| `work_center` | `string` | |
| `planner_group` | `string` | |
| `downtime_hours` | `number` | Non-negative |
| `percentage_complete` | `number` | Integer, minimum 0, maximum 100 |
| `_conflict` | `boolean` | Default `false`. Set by server to break retry loops |

The `updated_at` field MUST remain a `number` (epoch ms) in RxDB. `equipment_id` MUST remain as a denormalized read-only field.

### Requirement: Supabase Migration

The system MUST alter the Supabase `work_orders` table with the following changes:

1. Add `updated_at TIMESTAMPTZ DEFAULT NOW()` column and auto-populate it via trigger on every INSERT/UPDATE.
2. Add `updated_at_ms BIGINT` column, auto-populated from `EXTRACT(EPOCH FROM updated_at) * 1000`, for replication ordering parity with `assets`.
3. Add all enterprise fields listed in the schema requirement above, with matching PostgreSQL types.
4. Add `asset_id TEXT` column with a foreign key constraint: `FOREIGN KEY (asset_id) REFERENCES assets(id)`.
5. Keep `equipment_id` as a read-only denormalized column.
6. Create a PostgreSQL ENUM `wo_type_enum` with values: `preventive`, `corrective`, `predictive`, `emergency`, `inspection`. Apply it to `wo_type`.
7. Add `CHECK (percentage_complete BETWEEN 0 AND 100)`.
8. Add `CHECK (planned_hours >= 0)`, `CHECK (actual_hours >= 0)`, etc., for all non-negative numeric fields.
9. Add RLS policies: authenticated users can SELECT all non-deleted rows; authenticated users can INSERT/UPDATE their own rows (ownership TBD by app_id or similar claim).
10. Add `_conflict BOOLEAN DEFAULT FALSE`.

### Requirement: FSM Engine

The system MUST enforce the following exact state transition matrix:

| Current State | Allowed Next States |
|---------------|---------------------|
| `pending` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` | *(terminal — no transitions)* |
| `cancelled` | *(terminal — no transitions)* |

State names MUST NOT be renamed. `pending`, `in_progress`, `completed`, `cancelled` MUST be kept exactly as-is.

Enforcement MUST be implemented in three layers:

1. **PostgreSQL trigger** (`validate_work_order_fsm`): Before UPDATE on `work_orders`, raise an exception if the transition violates the matrix. Terminal states MUST reject any status change.
2. **RxDB client-side validator** (in schema or hook layer): Pre-check transitions before local write to provide fail-fast UX and reduce invalid push attempts.
3. **Conflict flag**: If an invalid state is somehow pushed and rejected by PostgreSQL, the document MUST be marked with `_conflict = true` server-side (or via a resolution mechanism) so the pull handler surfaces it and the replication retry loop is broken.

### Requirement: Status Audit Trail

The system MUST create a `work_order_status_history` table in Supabase with the following columns:

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `work_order_id` | `TEXT NOT NULL` | References `work_orders(id)` ON DELETE CASCADE |
| `from_status` | `TEXT NOT NULL` | |
| `to_status` | `TEXT NOT NULL` | |
| `changed_by` | `TEXT` | Nullable. Set from application context if available |
| `changed_at` | `TIMESTAMPTZ DEFAULT NOW()` | |
| `reason` | `TEXT` | Nullable. Populated when transition includes a reason |

A PostgreSQL trigger MUST auto-insert a row into `work_order_status_history` on every UPDATE of `work_orders` where `OLD.status IS DISTINCT FROM NEW.status`.

The audit table MUST NOT live in RxDB. It is server-side only.

### Requirement: RxDB v1→v2 Migration

The system MUST provide an explicit RxDB schema migration function from v1 to v2 that is safe for Dexie storage under React StrictMode.

The migration function MUST:
1. Map existing v1 fields to v2 fields one-to-one.
2. For `asset_id`, query the `assets` collection by `equipment_id` to resolve the corresponding `assets.id`. If no match is found, set `asset_id` to an empty string (the schema still requires it, but empty string satisfies the type constraint and signals manual backfill needed).
3. Set all new numeric fields to `0` if absent.
4. Set all new string fields to `""` or `null` depending on schema nullability.
5. Set `_conflict` to `false`.

The existing recreate fallback (catching DB6/schema errors) MUST be preserved as a safety net, but MUST NOT be the primary migration path.

### Requirement: Replication Alignment

The system MUST update the work_orders replication handlers to use `updated_at_ms` for ordering (like `assets`), resolving the latent mismatch where the pull handler ordered by `updated_at` but the Supabase table had `_last_modified`.

The push handler MUST include all v2 fields in the field list and MUST send both `updated_at` (ISO string) and `updated_at_ms` (number) to Supabase.

The pull handler MUST map `updated_at_ms` to the RxDB `updated_at` number field.

---

## Non-Functional Requirements

- **Offline-first integrity**: FSM rules MUST be enforceable client-side so that offline users cannot create locally invalid states that will stall sync indefinitely.
- **Migration safety**: The v1→v2 migration MUST be idempotent and MUST NOT drop data. If migration fails, the recreate fallback MUST restore data from Supabase on next pull.
- **Review budget protection**: This change targets the database layer only. Hook and UI changes are deferred to Phase 2 to keep the PR under the 400-line review budget.
- **Audit immutability**: `work_order_status_history` rows MUST be insert-only. No UPDATE or DELETE operations should be permitted on this table (enforced by RLS or trigger).

---

## Scenarios

### Happy Path Scenarios

#### Scenario: Create a new work order with enterprise fields

- GIVEN a clean RxDB v2 database synced to Supabase
- WHEN a work order is inserted with `asset_id`, `wo_type`, `planned_hours`, `cost_estimate`, `requested_by`, `work_center`, and `percentage_complete: 0`
- THEN the document is stored locally with all fields
- AND it is pushed to Supabase with `updated_at` and `updated_at_ms` populated
- AND `asset_id` passes the foreign key constraint

#### Scenario: Valid status transition pending → in_progress

- GIVEN a work order with status `pending`
- WHEN its status is updated to `in_progress` with `start_date` set
- THEN the local write succeeds (client-side validation passes)
- AND the push succeeds (PostgreSQL trigger allows the transition)
- AND a row is inserted into `work_order_status_history` with `from_status='pending'`, `to_status='in_progress'`

#### Scenario: Valid status transition in_progress → completed

- GIVEN a work order with status `in_progress`
- WHEN its status is updated to `completed` with `end_date` and `close_reason` set
- THEN the local write succeeds
- AND the push succeeds
- AND a row is inserted into `work_order_status_history`

#### Scenario: RxDB v1→v2 migration backfills asset_id

- GIVEN an existing v1 work order with `equipment_id = 'EQ-001'`
- AND an asset exists with `equipment_id = 'EQ-001'` and `id = 'ASSET-001'`
- WHEN the migration function runs
- THEN the resulting v2 document has `asset_id = 'ASSET-001'`
- AND all new fields have safe defaults

### Edge Case Scenarios

#### Scenario: Migration with orphaned equipment_id

- GIVEN an existing v1 work order with `equipment_id = 'EQ-999'`
- AND no asset exists with that `equipment_id`
- WHEN the migration function runs
- THEN `asset_id` is set to `""`
- AND the document migrates successfully
- AND a warning is logged

#### Scenario: Offline status change followed by valid sync

- GIVEN the client is offline
- AND a work order has status `pending`
- WHEN the user changes status to `in_progress` offline
- AND later comes online
- THEN the push succeeds because the transition is valid

#### Scenario: Duplicate status update (no-op)

- GIVEN a work order with status `in_progress`
- WHEN an update sets status to `in_progress` again (no actual change)
- THEN the PostgreSQL FSM trigger allows it (status unchanged)
- AND no row is inserted into `work_order_status_history`

### Error Case Scenarios

#### Scenario: Invalid status transition rejected locally

- GIVEN a work order with status `completed`
- WHEN a client-side update attempts to set status to `pending`
- THEN the local write is rejected BEFORE touching RxDB
- AND an error is returned indicating the transition is invalid

#### Scenario: Invalid status transition rejected by PostgreSQL

- GIVEN a work order in Supabase with status `cancelled`
- WHEN a direct SQL UPDATE or bypass attempt sets status to `in_progress`
- THEN the PostgreSQL trigger raises an exception
- AND the transaction is rolled back

#### Scenario: Sync retry loop broken by conflict flag

- GIVEN a document with an invalid status was written offline before client-side validation existed
- WHEN the push handler sends it to Supabase
- AND Supabase rejects it with an FSM violation
- AND replication retries indefinitely
- THEN a server-side process or manual resolution marks the document `_conflict = true`
- AND the next pull surfaces `_conflict: true` to the client
- AND the client handler stops retrying the invalid state

#### Scenario: Negative planned_hours rejected

- GIVEN a work order update with `planned_hours: -5`
- WHEN the push reaches Supabase
- THEN the `CHECK (planned_hours >= 0)` constraint rejects the write
- AND the client receives an error

---

## Data Model Specification

### RxDB Schema v2

```javascript
const workOrderSchemaV2 = {
  version: 2,
  primaryKey: 'id',
  type: 'object',
  properties: {
    // v1 fields (retained)
    id: { type: 'string', maxLength: 50 },
    equipment_id: { type: 'string', maxLength: 50 },
    description: { type: 'string' },
    location: { type: 'string', maxLength: 100 },
    criticality: { type: 'string', enum: ['A', 'B', 'C'] },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    assigned_to: { type: 'string' },
    scheduled_date: { type: 'string' },
    completed_date: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' },

    // v2 fields (new)
    asset_id: { type: 'string', maxLength: 100 },
    wo_type: { type: 'string', enum: ['preventive', 'corrective', 'predictive', 'emergency', 'inspection'] },
    planned_hours: { type: 'number', minimum: 0 },
    actual_hours: { type: 'number', minimum: 0 },
    cost_estimate: { type: 'number', minimum: 0 },
    actual_cost: { type: 'number', minimum: 0 },
    requested_by: { type: 'string' },
    approved_by: { type: 'string' },
    approval_date: { type: 'string' },
    start_date: { type: 'string' },
    end_date: { type: 'string' },
    hold_reason: { type: 'string' },
    close_reason: { type: 'string' },
    cancel_reason: { type: 'string' },
    work_center: { type: 'string' },
    planner_group: { type: 'string' },
    downtime_hours: { type: 'number', minimum: 0 },
    percentage_complete: { type: 'number', minimum: 0, maximum: 100 },

    // replication / conflict
    _conflict: { type: 'boolean' },
    _deleted: { type: 'boolean' }
  },
  required: [
    'id', 'equipment_id', 'description', 'status', 'asset_id',
    'wo_type', 'planned_hours', 'actual_hours', 'cost_estimate', 'actual_cost',
    'percentage_complete', '_conflict', '_deleted'
  ]
};
```

**Migration function v1→v2** (conceptual):
- Copy all v1 fields directly.
- Resolve `asset_id` via `assets.findOne({ selector: { equipment_id: doc.equipment_id } })`.
- Default `wo_type` to `'corrective'`.
- Default numeric fields to `0`.
- Default string fields to `""`.
- Set `_conflict: false`, `_deleted: false`.

### Supabase DDL

```sql
-- 1. ENUMs
CREATE TYPE wo_type_enum AS ENUM ('preventive', 'corrective', 'predictive', 'emergency', 'inspection');

-- 2. Add columns to work_orders
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at_ms BIGINT,
  ADD COLUMN IF NOT EXISTS asset_id TEXT,
  ADD COLUMN IF NOT EXISTS wo_type wo_type_enum DEFAULT 'corrective',
  ADD COLUMN IF NOT EXISTS planned_hours NUMERIC DEFAULT 0 CHECK (planned_hours >= 0),
  ADD COLUMN IF NOT EXISTS actual_hours NUMERIC DEFAULT 0 CHECK (actual_hours >= 0),
  ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC DEFAULT 0 CHECK (cost_estimate >= 0),
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0 CHECK (actual_cost >= 0),
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approval_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS work_center TEXT,
  ADD COLUMN IF NOT EXISTS planner_group TEXT,
  ADD COLUMN IF NOT EXISTS downtime_hours NUMERIC DEFAULT 0 CHECK (downtime_hours >= 0),
  ADD COLUMN IF NOT EXISTS percentage_complete INTEGER DEFAULT 0 CHECK (percentage_complete BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS _conflict BOOLEAN DEFAULT FALSE;

-- 3. Foreign key
ALTER TABLE work_orders
  ADD CONSTRAINT fk_work_orders_asset
  FOREIGN KEY (asset_id) REFERENCES assets(id);

-- 4. Trigger: update timestamps
CREATE OR REPLACE FUNCTION update_work_order_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.updated_at_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_timestamp ON work_orders;
CREATE TRIGGER work_orders_timestamp
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_work_order_timestamps();

-- 5. Trigger: FSM validation
CREATE OR REPLACE FUNCTION validate_work_order_fsm()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: % is a terminal state', OLD.status;
  END IF;

  IF OLD.status = 'pending' AND NEW.status NOT IN ('in_progress', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from pending to %', NEW.status;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from in_progress to %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_fsm ON work_orders;
CREATE TRIGGER work_orders_fsm
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_work_order_fsm();

-- 6. Audit table
CREATE TABLE IF NOT EXISTS work_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);

-- 7. Trigger: audit logging
CREATE OR REPLACE FUNCTION log_work_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO work_order_status_history (work_order_id, from_status, to_status, reason)
    VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.cancel_reason, NEW.close_reason, NEW.hold_reason));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_audit ON work_orders;
CREATE TRIGGER work_orders_audit
  AFTER UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION log_work_order_status_change();

-- 8. RLS
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_orders_select ON work_orders;
CREATE POLICY work_orders_select ON work_orders
  FOR SELECT TO authenticated USING (_deleted = FALSE OR _deleted IS NULL);

DROP POLICY IF EXISTS work_orders_insert ON work_orders;
CREATE POLICY work_orders_insert ON work_orders
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS work_orders_update ON work_orders;
CREATE POLICY work_orders_update ON work_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 9. Backfill existing rows
UPDATE work_orders SET updated_at = NOW(), updated_at_ms = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint WHERE updated_at IS NULL;
UPDATE work_orders SET _conflict = FALSE WHERE _conflict IS NULL;
```

---

## FSM Specification

### States

| State | Type | Description |
|-------|------|-------------|
| `pending` | Initial | Work order created, awaiting start |
| `in_progress` | Active | Work being performed |
| `completed` | Terminal | Work finished successfully |
| `cancelled` | Terminal | Work aborted |

### Transition Matrix

```
          pending    in_progress    completed    cancelled
pending      —          OK            NO           OK
in_progress  NO         —             OK           OK
completed    NO         NO            —            NO
cancelled    NO         NO            NO           —
```

### Validation Rules

1. **Identity transitions** (same state → same state) MUST be allowed and MUST NOT create audit entries.
2. **Terminal states** (`completed`, `cancelled`) MUST reject ALL status changes.
3. **Invalid transitions** MUST be rejected by client-side code before write, by PostgreSQL trigger on server write, and MUST NOT silently succeed.
4. **Transition reasons**:
   - `pending` → `cancelled`: `cancel_reason` SHOULD be populated.
   - `in_progress` → `completed`: `close_reason` MAY be populated.
   - `in_progress` → `cancelled`: `cancel_reason` SHOULD be populated.

---

## Migration Plan

### RxDB v1→v2

1. Bump `version: 1` to `version: 2` in `workOrderSchema`.
2. Add `migrationStrategies: { 2: async (oldDoc) => ({ ... }) }` to the collection config.
3. The migration function MUST be async and MUST resolve `asset_id` by querying the `assets` collection.
4. Preserve the existing `catch(err)` recreate fallback in `_createDatabase` for StrictMode safety.
5. Update `createPushHandler` field list to include all v2 fields.
6. Update `createPullHandler` for `work_orders` to order by `updated_at_ms` (matching assets pattern).

### Supabase Migration

1. Execute the DDL script above in a single Supabase migration file.
2. Backfill `updated_at`, `updated_at_ms`, and `_conflict` on existing rows.
3. Verify the `asset_id` backfill separately (manual or scripted) for rows where `equipment_id` has a matching asset.
4. Update `_last_modified` trigger to coexist with `updated_at` triggers, or deprecate `_last_modified` in favor of `updated_at_ms`.

### Rollback

- Supabase: Run inverse DDL (drop columns, triggers, tables, type). Restore `_last_modified` as primary ordering field if needed.
- RxDB: If v2 migration fails catastrophically, the recreate fallback restores empty v2 schema; data is re-downloaded from Supabase pull.

---

## Acceptance Criteria

- [ ] Supabase `work_orders` table has `updated_at`, `updated_at_ms`, all 18 new enterprise fields, `_conflict`, and `asset_id` FK.
- [ ] `wo_type` uses PostgreSQL ENUM `wo_type_enum`.
- [ ] RxDB v2 schema matches the specification and migrates existing v1 documents without data loss.
- [ ] Invalid transitions (`completed` → `pending`, `cancelled` → `in_progress`, `pending` → `completed`) are rejected by both client-side code and PostgreSQL trigger.
- [ ] Valid transitions (`pending` → `in_progress`, `in_progress` → `completed`, `pending` → `cancelled`) succeed end-to-end.
- [ ] Every status change creates exactly one row in `work_order_status_history`.
- [ ] No audit row is created for no-op status updates (same → same).
- [ ] RLS SELECT policy hides soft-deleted rows from authenticated queries.
- [ ] Replication pull handler orders by `updated_at_ms` without error.
- [ ] `_conflict = true` on a document stops infinite replication retry.
- [ ] The change set is database-layer only — no UI files modified.

---

## Related Artifacts

- Proposal: `openspec/changes/work-order-fsm-schema-phase-1/proposal.md`
- Exploration: `openspec/changes/work-order-fsm-schema-phase-1/explore.md`
- Current schema: `src/lib/rxdb.js`
- Current hooks: `src/hooks/useWorkOrders.js`
- Current SQL: `sql/trigger-work_orders.sql`
