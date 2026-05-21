# Design: Work Order FSM & Schema Phase 1

## Technical Approach

Upgrade the work_orders data layer from v1 to v2 by adding enterprise fields, a real `asset_id` FK, and a defense-in-depth FSM enforced at three layers: RxDB `preUpdate` hook (client), PostgreSQL trigger (server), and `_conflict` flag (sync loop breaker). Align replication to use `updated_at` / `updated_at_ms` consistently, matching the `assets` collection pattern. Keep `equipment_id` denormalized and state names unchanged. All changes are database-layer only; hooks and UI are deferred to Phase 2.

---

## Architecture Decisions

### Decision: Client-side FSM lives in RxDB `preUpdate`, not hooks

**Choice**: Register an RxDB collection `preUpdate` hook inside `rxdb.js` that validates status transitions before any local write.
**Alternatives considered**: JSON Schema `validate` (cannot compare old vs new state); `useWorkOrders.js` pre-check (deferred to Phase 2 per scope).
**Rationale**: The `preUpdate` hook receives `oldData` and `newData`, making transition validation trivial. It lives in the database layer, satisfying the Phase 1 scope while providing fail-fast UX and reducing invalid push attempts.

### Decision: `_conflict` flag set by push handler on permanent errors

**Choice**: When the push handler receives a permanent PostgreSQL error (FSM violation, CHECK constraint, FK violation), it updates the local document with `_conflict: true`, reverts the invalid field to its previous value, and returns `[]` to break the retry loop.
**Alternatives considered**: Server-side process marking `_conflict` (no background worker in this architecture); letting RxDB retry forever (unacceptable).
**Rationale**: We have no background workers. The push handler is the only place that knows the error type. Distinguishing retryable (network) vs permanent (constraint) errors and acting locally is the only practical defense.

### Decision: Supabase ordering field is `updated_at_ms`; deprecate `_last_modified`

**Choice**: Add `updated_at TIMESTAMPTZ` + `updated_at_ms BIGINT` to `work_orders`. Update pull handler to order by `updated_at_ms`. Keep existing `_last_modified` column and trigger untouched as a compatibility bridge, but treat it as deprecated.
**Alternatives considered**: Continue using `_last_modified` (latent mismatch with other collections); drop it immediately (risky).
**Rationale**: `assets` already uses `updated_at_ms`. Standardizing on one pattern makes the replication abstraction uniform. Deprecating rather than dropping preserves safety.

### Decision: `asset_id` resolved at RxDB migration time, not replication time

**Choice**: The v1→v2 RxDB migration function queries the local `assets` collection to map `equipment_id` → `asset_id`. If no match, `asset_id` becomes `""`.
**Alternatives considered**: Backfill `asset_id` in Supabase migration (requires joining across tables in DDL, fragile); resolve in pull handler (adds complexity to generic handler).
**Rationale**: The local `assets` collection is already populated before work_orders migration runs in typical app startup. Doing it in RxDB migration keeps the push/pull handlers generic and stateless.

---

## Data Flow

```
User Action (offline or online)
       │
       ▼
┌─────────────────┐     preUpdate hook validates FSM transition
│   useWorkOrders │     (throws if invalid → local write blocked)
│  updateWorkOrder│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   RxDB (v2)     │◄──── Migration v1→v2 resolves asset_id on first open
│  Dexie.js       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Push: sends all v2 fields + updated_at / updated_at_ms
│  Replication    │     Pull: orders by updated_at_ms, maps _deleted, updated_at
│  (RxDB plugin)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     FSM trigger rejects invalid transitions
│   Supabase      │     CHECK constraints reject negative numbers
│  PostgreSQL     │     Audit trigger logs status changes
└─────────────────┘
         │
         ▼
  work_order_status_history (server-only audit trail)
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/rxdb.js` | Modify | Schema v2, migration strategy, `preUpdate` FSM hook, push/pull field lists and ordering |
| `sql/trigger-work_orders.sql` | Modify | Replace with unified DDL: new columns, timestamp trigger, FSM trigger, audit trigger, RLS |
| `sql/migration-work_orders-v2.sql` | Create | Idempotent Supabase migration script executable in SQL Editor |
| `src/lib/fsm.js` | Create | Pure `isValidTransition(from, to)` and `getAllowedTransitions(status)` helpers |

---

## Interfaces / Contracts

### FSM Pure Functions (`src/lib/fsm.js`)

```javascript
const ALLOWED_TRANSITIONS = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export function isValidTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  return ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

export function getAllowedTransitions(status) {
  return ALLOWED_TRANSITIONS[status] ?? [];
}
```

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

### RxDB Migration v1→v2

```javascript
const workOrdersMigrationV2 = {
  2: async (oldDoc, database) => {
    // Resolve asset_id from equipment_id
    let asset_id = '';
    try {
      const asset = await database.assets
        .findOne({ selector: { equipment_id: oldDoc.equipment_id } })
        .exec();
      if (asset) asset_id = asset.id;
    } catch (e) {
      console.warn('[Migration] asset resolution failed for', oldDoc.equipment_id);
    }

    return {
      ...oldDoc,
      asset_id,
      wo_type: 'corrective',
      planned_hours: 0,
      actual_hours: 0,
      cost_estimate: 0,
      actual_cost: 0,
      requested_by: '',
      approved_by: '',
      approval_date: '',
      start_date: '',
      end_date: '',
      hold_reason: '',
      close_reason: '',
      cancel_reason: '',
      work_center: '',
      planner_group: '',
      downtime_hours: 0,
      percentage_complete: 0,
      _conflict: false,
      _deleted: oldDoc._deleted ?? false
    };
  }
};
```

### Collection Registration with FSM Hook

```javascript
await db.addCollections({
  work_orders: {
    schema: workOrderSchemaV2,
    migrationStrategies: workOrdersMigrationV2
  },
  // ...
});

// Register preUpdate hook AFTER collection creation
db.work_orders.preUpdate((newData, doc) => {
  const oldStatus = doc.status;
  const newStatus = newData.status ?? oldStatus;
  if (oldStatus !== newStatus && !isValidTransition(oldStatus, newStatus)) {
    throw new Error(`FSM violation: ${oldStatus} → ${newStatus}`);
  }
}, false);
```

### Supabase DDL

```sql
-- 1. ENUMs
CREATE TYPE IF NOT EXISTS wo_type_enum AS ENUM (
  'preventive', 'corrective', 'predictive', 'emergency', 'inspection'
);

-- 2. New columns (all idempotent)
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

-- 3. Foreign key (idempotent)
ALTER TABLE work_orders
  DROP CONSTRAINT IF EXISTS fk_work_orders_asset,
  ADD CONSTRAINT fk_work_orders_asset
  FOREIGN KEY (asset_id) REFERENCES assets(id);

-- 4. Timestamp trigger
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

-- 5. FSM validation trigger
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

-- 7. Audit trigger
CREATE OR REPLACE FUNCTION log_work_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO work_order_status_history (work_order_id, from_status, to_status, reason)
    VALUES (NEW.id, OLD.status, NEW.status,
            COALESCE(NEW.cancel_reason, NEW.close_reason, NEW.hold_reason));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_audit ON work_orders;
CREATE TRIGGER work_orders_audit
  AFTER UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION log_work_order_status_change();

-- 8. RLS policies
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_orders_select ON work_orders;
CREATE POLICY work_orders_select ON work_orders
  FOR SELECT TO authenticated USING (_deleted = FALSE OR _deleted IS NULL);

DROP POLICY IF EXISTS work_orders_insert ON work_orders;
CREATE POLICY work_orders_insert ON work_orders
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS work_orders_update ON work_orders;
CREATE POLICY work_orders_update ON work_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Audit table: insert-only via RLS (no update/delete)
DROP POLICY IF EXISTS history_select ON work_order_status_history;
CREATE POLICY history_select ON work_order_status_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS history_insert ON work_order_status_history;
CREATE POLICY history_insert ON work_order_status_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- 9. Backfill existing rows
UPDATE work_orders
SET updated_at = NOW(),
    updated_at_ms = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE updated_at IS NULL;

UPDATE work_orders
SET _conflict = FALSE
WHERE _conflict IS NULL;
```

### Replication Adapter Changes

**Pull handler** (`createPullHandler` for `work_orders`):
- `orderField` changes from `'updated_at'` to `'updated_at_ms'`.
- Mapping stays the same: `updated_at_ms` → `updated_at` (number), `_deleted` handling unchanged.

**Push handler** (`createPushHandler` for `work_orders`):
- Field list expands to include all v2 fields.
- `updated_at` is sent as ISO string; `updated_at_ms` as number.
- **Conflict handling**: catch Supabase errors. If error code indicates a constraint/FSM violation (e.g., `23514` check, `P0001` raise), update local doc: set `_conflict: true`, revert `status` to last known valid value, bump `updated_at`. Return `[]` to RxDB to stop retry.

```javascript
const woPush = createPushHandler('work_orders', [
  'id', 'equipment_id', 'description', 'location', 'criticality',
  'status', 'priority', 'assigned_to', 'scheduled_date',
  'completed_date', 'created_at', 'asset_id', 'wo_type',
  'planned_hours', 'actual_hours', 'cost_estimate', 'actual_cost',
  'requested_by', 'approved_by', 'approval_date', 'start_date',
  'end_date', 'hold_reason', 'close_reason', 'cancel_reason',
  'work_center', 'planner_group', 'downtime_hours', 'percentage_complete',
  '_conflict'
]);
```

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `isValidTransition` matrix | Exhaustive table test: 4 states × 4 states + identity transitions |
| Unit | RxDB migration v1→v2 | Create v1 doc, run migration strategy, assert all new fields have defaults and `asset_id` resolves correctly (mock `assets` collection) |
| Unit | `preUpdate` hook | Attempt invalid transition via `doc.update()`, assert error thrown and doc unchanged |
| Integration | Replication pull ordering | Seed Supabase with rows having different `updated_at_ms`, run pull, assert correct order and checkpoint |
| Integration | Push FSM rejection | Update local doc to invalid status, push, assert `_conflict: true` is set locally and retry stops |
| Integration | Audit trail | Valid status update via Supabase client, assert row exists in `work_order_status_history` with correct `from_status`/`to_status` |
| E2E | Offline → online sync | Go offline, valid transition, reconnect, assert push succeeds and audit row created |

---

## Migration / Rollout

### Step 1: Supabase (server-first)
1. Run `sql/migration-work_orders-v2.sql` in Supabase SQL Editor.
2. Verify columns, triggers, and RLS with `\d work_orders` and `\d work_order_status_history`.
3. Backfill `asset_id` manually or via script by joining `work_orders.equipment_id` → `assets.equipment_id`.

### Step 2: RxDB (client-second)
1. Update `src/lib/rxdb.js`: swap `workOrderSchema` to v2, add `migrationStrategies: { 2: ... }`.
2. Add `src/lib/fsm.js` and import into `rxdb.js`.
3. Register `preUpdate` hook after collection creation.
4. Update `createPullHandler` call for work_orders to use `updated_at_ms`.
5. Update `createPushHandler` field list to all v2 fields.
6. Add permanent-error handling in push (FSM/CHECK catch → local `_conflict` + revert).

### Step 3: Verification
1. Open app in browser. RxDB migrates v1 docs silently.
2. Check DevTools → IndexedDB → `cmms-db` → `work_orders` for new fields.
3. Trigger a valid transition; verify audit row in Supabase Table Editor.
4. Trigger an invalid transition; verify local error and no audit row.

### Rollback
- **Supabase**: Run inverse DDL (drop columns, triggers, type, table). Note: dropping `work_order_status_history` loses audit data.
- **RxDB**: If migration fails catastrophically, the existing `catch (err)` DB6/schema recreate path in `_createDatabase` drops and rebuilds the database. On next online sync, data is restored from Supabase pull.

---

## Open Questions

- [ ] **Ownership column for RLS**: The RLS UPDATE policy currently uses `USING (true)`. In production, this should restrict to the row owner (e.g., `created_by = auth.uid()`). Deferred to Phase 2 when auth context is available.
- [ ] **Changed_by in audit**: `work_order_status_history.changed_by` is nullable. Populating it requires passing application context through to Supabase (e.g., `current_setting('app.current_user_id', true)`). A future edge function or RPC wrapper should set this.
