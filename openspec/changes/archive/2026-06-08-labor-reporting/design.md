# Design: Labor Reporting / Time Tracking

## Technical Approach

Three-layer architecture: **RxDB client orchestrates** (creates labor_records atomically with WO status changes), **DB validates** (defensive triggers reject invalid state, NO auto-creation), **ClockWidget** delivers the mechanic UI inside WorkOrderDrawer. Each clock session is an independent `labor_records` row (`end_time` NULL = active). No pause/resume — mechanics clock in/out multiple times per WO and hours auto-sum on COMP→CLOSED.

## Architecture Decisions

### Decision: Client-Driven Clock (NOT Server Triggers)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **RxDB client creates labor_records** (2 atomic writes: WO→INPRG + labor_record) | Works offline-first, no duplicate risk, knows which technician | ✅ **Chosen** |
| DB BEFORE UPDATE trigger auto-creates labor_record on INPRG | DUPLICATE FANTASMA: RxDB creates locally offline, trigger creates another on sync. Also doesn't know which technician. | Rejected |

**Rationale**: In offline-first apps, the CLIENT is the creator. When the mechanic taps "Start" offline:
1. RxDB atomically writes: `work_order.status = INPRG` + `INSERT labor_record(start_time=NOW(), activity_code=DIRECT_WORK, technician_id=user)`
2. Both changes sync together → no split-brain
3. Server trigger that also creates labor_record on INPRG transition = SECOND record on sync = corrupted data

The server VALIDATES (defensive trigger), it does NOT create.

### Decision: Custom Pull Handler for Labor Records

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Generic `createPullHandler` | Pulls ALL labor_records (no RLS filter at app level) | Rejected |
| Custom handler with `technician_id` filter | Extra code but only fetches relevant rows | ✅ **Chosen** |

**Rationale**: The generic handler does `supabase.from('labor_records').select('*')`. With 100+ technicians, each device would pull ALL records. Custom handler adds `.eq('technician_id', userId)` — respects RLS AND reduces payload. Push uses generic handler (RLS on Supabase rejects unauthorized writes).

### Decision: GENERATED ALWAYS AS hours_worked

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `GENERATED ALWAYS AS ... STORED` | Accurate server-side calc, no manual entry, auto-recalculates | ✅ **Chosen** |
| Application-level calculation | Drift-prone, timezone issues, stale data | Rejected |

**Rationale**: `EXTRACT(EPOCH FROM COALESCE(end_time, NOW()) - start_time) / 3600` gives real-time hours for active sessions. COMP→CLOSED trigger SUMs these values. Active sessions use NOW() so the generated value changes — but the SUM trigger only runs on COMP→CLOSED when end_time IS NOT NULL, so the stored value is final.

## Data Flow

```
Clock-in (manual):
  ClockWidget → useLaborRecords.clockIn(activityCode)
    → RxDB atomic batch:
        1. work_order.lifecycle_phase = 'INPRG'  (si estaba APPROVED)
        2. INSERT labor_record(start_time=NOW(), activity_code, technician_id)
    → push sync → Supabase → validate_lifecycle_fsm() + trg_validate_labor_fsm()

Clock-out (manual):
  ClockWidget → useLaborRecords.clockOut()
    → RxDB atomic batch:
        1. UPDATE labor_record SET end_time=NOW()
        2. Si no quedan sesiones activas → work_order.lifecycle_phase = 'COMP'
    → push sync → Supabase → validate FSM

COMP→CLOSED (auto):
  Supabase trigger: BEFORE UPDATE → SUM labor_records → SET actual_hours

Offline:
  RxDB writes BOTH changes locally → timer runs in UI immediately
  → push when online → Supabase validates → no duplicates
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260526000002_labor_records.sql` | Create | labor_records table, RLS, FSM triggers, actual_hours ALTER |
| `supabase/tests/database/labor_records_test.sql` | Create | pgTAP: schema, RLS policies, FSM trigger scenarios |
| `src/lib/rxdb.js` | Modify | Add `labor_records` schema, collection in `addCollections()`, replication in `startAllReplications()` |
| `src/lib/adapters/laborAdapter.js` | Create | RxDB doc → ViewModel mapper |
| `src/hooks/useLaborRecords.js` | Create | RxDB hook: `records`, `activeSession`, `clockIn()`, `clockOut()` |
| `src/components/mechanic/LaborClockWidget.jsx` | Create | Clock-in/out UI with activity selector, live timer |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modify | Embed ClockWidget, pass `hasActiveClock` |
| `src/components/mechanic/WorkOrderActions.jsx` | Modify | Accept `hasActiveClock` prop, disable COMP with tooltip |
| `src/pages/MechanicDashboard.jsx` | Modify | Pass labor state to drawer |

## Interfaces

### labor_records Schema (Supabase)

```sql
CREATE TABLE labor_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  hours_worked NUMERIC GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  ) STORED,
  activity_code TEXT NOT NULL CHECK (activity_code IN (
    'DIRECT_WORK','WAIT_MATERIAL','WAIT_PERMIT','TRAVEL','BREAK'
  )),
  notes TEXT,
  device_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### FSM Trigger Functions (inline in migration)

- **trg_validate_labor_fsm()** (BEFORE INSERT OR UPDATE ON labor_records): Defensive validation only. On INSERT with end_time=NULL (new active session), verify that work_order is INPRG. On UPDATE setting end_time (clock-out), verify session belongs to the same technician. REJECT with clear error if validation fails.
- **trg_labor_sum_hours()** (BEFORE UPDATE ON work_orders): On COMP→CLOSED, UPDATE work_orders SET actual_hours = SUM of all labor_records.hours_worked for this WO.
- NO auto-create triggers. The client (RxDB) creates labor_records atomically with WO status changes.

### RxDB Schema (labor_records)

```js
const laborRecordSchema = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 50 },
    work_order_id: { type: 'string', maxLength: 50 },
    technician_id: { type: 'string', maxLength: 50 },
    start_time: { type: 'string' },
    end_time: { type: 'string' },
    activity_code: { type: 'string' },
    notes: { type: 'string' },
    device_timestamp: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'number' },
    _deleted: { type: 'boolean' }
  },
  required: ['id', 'work_order_id', 'technician_id', 'start_time', 'activity_code']
};
```

### ViewModel (laborAdapter)

```js
toViewModel(doc) → {
  id, workOrderId, technicianId, startTime, endTime,
  activityCode, notes, deviceTimestamp,
  durationHours: endTime ? (endTime - startTime) / 3600 : null
}
```

### useLaborRecords Hook

```js
useLaborRecords({ workOrderId }) → {
  records: LaborRecordViewModel[],   // all for this WO
  activeSession: LaborRecordViewModel | null,
  clockIn(activityCode, notes?),
  clockOut(),
  loading: boolean,
  error: string | null
}
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| DB | Schema constraints, RLS, FSM triggers | pgTAP: `labor_records_test.sql` following `cbm_trigger_test.sql` pattern |
| UI | ClockWidget states (idle/active), activity selector, error + retry | Component tests with simulated RxDB |
| Integration | Offline sync, push/pull conflict | Manual + replication test in dev |

## Migration Plan

1. Run migration `20260526000002_labor_records.sql` (creates table, RLS, FSM triggers, adds `actual_hours` COLUMN IF NOT EXISTS)
2. Deploy frontend with RxDB collection + replication
3. No data migration needed (new table)
4. Rollback: Drop `labor_records` table, remove collection from `startAllReplications()`

## Open Questions

- ~~**Trigger ordering**: RESUELTO — no hay trigger de auto-creación. El cliente orquesta.~~
- **RxDB atomic batch**: ¿RxDB soporta batches atómicos (WO update + labor_record insert) o necesitamos two-phase? Respuesta: RxDB no tiene transacciones multi-colección. La solución es: (1) primero crear labor_record, (2) si el WO necesita transición a INPRG, actualizar WO. Si falla el paso 2, el labor_record queda huérfano — mitigado por el trigger defensivo que rechaza labor_records activos sin WO en INPRG.
