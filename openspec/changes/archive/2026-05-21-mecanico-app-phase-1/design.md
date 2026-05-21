# Design: App del Mecánico (Fase 1) — Listado de Órdenes

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        RxDB (Dexie)                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  work_orders collection  (schema v3)                      │  │
│  │  .$.observe → useWorkOrders hook                          │  │
│  └──────────┬─────────────────────────────────────────────────┘  │
│             │ raw RxDB documents                                 │
│             ▼                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  useWorkOrders (hook)  + lifecycleFilter param             │  │
│  │  Filters docs by lifecycle_phase, strips _deleted          │  │
│  └──────────┬─────────────────────────────────────────────────┘  │
│             │ filtered raw docs                                  │
│             ▼                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  workOrderAdapter.toViewModel(arr)                         │  │
│  │  PURE TRANSFORM — no side effects, no RxDB imports         │  │
│  │  lifecycle_phase → label/color, _conflict → hasConflict    │  │
│  └──────────┬─────────────────────────────────────────────────┘  │
│             │ ViewModel[]                                        │
│             ▼                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  MechanicDashboard (CONTAINER)                             │  │
│  │  Owns useWorkOrders hook, calls adapter, passes props      │  │
│  └──┬───────────┬──────────────┬──────────────────────────────┘  │
│     │           │              │                                 │
│     ▼           ▼              ▼                                 │
│  ┌──────┐  ┌─────────┐  ┌────────────────────┐                 │
│  │Sync  │  │WorkOrder│  │ WorkOrderList       │                 │
│  │Status│  │Status   │  │ (PRESENTER)         │                 │
│  │Indic.│  │Badge    │  │ maps over ViewModel │                 │
│  │      │  │(PRESENT)│  │ → WorkOrderCard[]   │                 │
│  └──────┘  └─────────┘  └────────────────────┘                 │
│                                │                                │
│                                ▼                                │
│                        ┌──────────────┐                         │
│                        │ WorkOrderCard │                         │
│                        │ (PRESENTER)   │                         │
│                        │ Lifecycle     │                         │
│                        │ badge + conf- │                         │
│                        │ lict indicator│                         │
│                        └──────────────┘                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Supabase Replication (live pull/push)                     │  │
│  │  RxDB replicateRxCollection ↔ Supabase REST               │  │
│  │  _conflict flag set on push failure                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Component Tree

```
<App>
  ├── <NavSyncIndicator status={syncStatus} />
  ├── <AssetSearchBar />
  ├── <AssetTree />
  ├── <MechanicDashboard />            ← NEW CONTAINER
  │   └── <SyncStatusIndicator status={syncStatus} />
  │   └── <WorkOrderList workOrders={viewModels} onSelect={handleSelect}>
  │       └── <WorkOrderCard workOrder={vm} onSelect={fn}>
  │           ├── <WorkOrderStatusBadge phase={vm.lifecyclePhase} />
  │           ├── ConflictBadge  (conditionally rendered)
  │           └── [equipmentId, description, criticalityColor, priority, scheduledDate]
  ├── <AssetDetailsPanel />
  └── <QRScannerModal />
```

## Data Flow

```
1. App mounts → MechanicDashboard calls useWorkOrders({ lifecycleFilter: ['WAPPR', 'APPROVED'] })

2. useWorkOrders hook subscribes to db.work_orders.find().$
   → receives raw RxDB documents
   → filters by !doc._deleted AND lifecycle_phase in lifecycleFilter
   → returns { workOrders, loading, error, syncStatus }

3. MechanicDashboard receives filtered raw docs
   → calls workOrderAdapter.toViewModel(docs)
   → produces WorkOrderViewModel[]

4. MechanicDashboard passes ViewModel[] to <WorkOrderList>
   → WorkOrderList maps array → <WorkOrderCard key={vm.id} workOrder={vm} onSelect={fn} />

5. WorkOrderCard renders:
   - WorkOrderStatusBadge (phase → label + MUI Chip color)
   - Conflict badge if vm.hasConflict
   - Key fields (equipmentId, description, priority, scheduledDate)
   - onSelect callback

6. SyncStatusIndicator reads syncStatus from hook → renders dot + label

7. On replication update:
   RxDB push fails → _conflict = true → adapter map hasConflict = true → card shows badge
   RxDB pull receives new data → reactive list update → card re-renders
```

## Key Design Decisions

### DD1: Adapter Layer

- **File**: `src/lib/adapters/workOrderAdapter.js`
- Pure function `toViewModel(rxdbDoc)` that takes a single RxDB document and returns a UI model
- Pure function `toViewModelList(docs)` that maps the array
- No RxDB imports, no Supabase imports, no side effects
- Mapping:

| Source | Target | Logic |
|--------|--------|-------|
| `id` | `id` | passthrough |
| `equipment_id` | `equipmentId` | rename to camelCase |
| `description` | `description` | passthrough, null coalesce to `''` |
| `lifecycle_phase` | `lifecyclePhase` | passthrough |
| `lifecycle_phase` | `lifecycleLabel` | `getPhaseLabel(phase)` |
| `criticality` | `criticalityColor` | `A→'error'`, `B→'warning'`, `C→'success'` |
| `priority` | `priority` | passthrough |
| `scheduled_date` | `scheduledDate` | `Intl.DateTimeFormat('es-MX')` |
| `_conflict` | `hasConflict` | `Boolean(_conflict)` |
| `_deleted` | `isDeleted` | `Boolean(_deleted)` |
| `asset_id` | `assetId` | passthrough |
| `wo_type` | `woType` | rename to camelCase |
| `planned_hours` | `plannedHours` | rename to camelCase |

- `getPhaseLabel(phase)` is imported from fsm.js — NOT duplicated

### DD2: FSM Update

- **File**: `src/lib/fsm.js`
- Replace `ALLOWED_TRANSITIONS` with ISO 14224 lifecycle model:

```js
const ALLOWED_TRANSITIONS = {
  WAPPR:   ['APPROVED'],
  APPROVED: ['INPRG', 'CLOSED'],
  INPRG:   ['COMP', 'CLOSED'],
  COMP:    ['CLOSED'],
  CLOSED:  []
};
```

- `isValidTransition(from, to)` — unchanged logic, new transition map
- `getAllowedTransitions(phase)` — unchanged
- `isTerminal(phase)` — unchanged
- New exports:

```js
const PHASE_LABELS = {
  WAPPR: 'Pendiente Aprobación',
  APPROVED: 'Aprobada',
  INPRG: 'En Progreso',
  COMP: 'Completada',
  CLOSED: 'Cerrada'
};

const PHASE_COLORS = {
  WAPPR: 'warning',
  APPROVED: 'info',
  INPRG: 'primary',
  COMP: 'success',
  CLOSED: 'default'
};

export function getPhaseLabel(phase) {
  return PHASE_LABELS[phase] ?? phase;
}

export function getPhaseColor(phase) {
  return PHASE_COLORS[phase] ?? 'default';
}
```

- **Backward compatibility note**: Old `isValidTransition` was called with `pending`/`in_progress`/`completed`/`cancelled`. Code that still passes old status values will fail silently (return `false`). The preSave hook in `rxdb.js` must be updated simultaneously.
- `preSave` hook in `rxdb.js` must be updated to validate `lifecycle_phase` instead of `status`
- The push handler's conflict recovery code (line 405) queries Supabase for `status` — must update to `lifecycle_phase`

### DD3: Container/Presenter Split

#### MechanicDashboard (Container)
- **File**: `src/pages/MechanicDashboard.jsx`
- Self-contained, no props
- Calls `useWorkOrders({ lifecycleFilter: ['WAPPR', 'APPROVED'] })`
- Transforms raw docs via `workOrderAdapter.toViewModelList(docs)`
- Passes ViewModel[] to `<WorkOrderList>`
- Manages loading/error states
- Doesn't import RxDB directly

#### WorkOrderList (Presenter)
- **File**: `src/components/mechanic/WorkOrderList.jsx`
- Props: `{ workOrders: WorkOrderViewModel[], onSelect: (id) => void }`
- Maps array → `<WorkOrderCard>`
- Shows empty state if no work orders
- Shows `SyncStatusIndicator` in a header area

#### WorkOrderCard (Presenter)
- **File**: `src/components/mechanic/WorkOrderCard.jsx`
- Props: `{ workOrder: WorkOrderViewModel, onSelect: (id) => void }`
- Displays: `equipmentId`, `description`, `WorkOrderStatusBadge`, `criticalityColor` as left border accent, `priority`, `scheduledDate`
- Conditional conflict badge with tooltip "Conflicto de sincronización"
- Light amber border/background tint when `hasConflict` is true

#### WorkOrderStatusBadge (Presenter)
- **File**: `src/components/mechanic/WorkOrderStatusBadge.jsx`
- Props: `{ phase: string, size?: 'small' | 'medium' }`
- Uses MUI `<Chip>` with `color={getPhaseColor(phase)}` and `label={getPhaseLabel(phase)}`
- No data fetching, no side effects

### DD4: RxDB Schema v3 Migration

- **File**: `src/lib/rxdb.js`
- Increment `workOrderSchema.version` from `2` to `3`
- Drop `status` field from schema (will be migrated to `lifecycle_phase`)
- Add fields:

```js
lifecycle_phase: { type: 'string', enum: ['WAPPR', 'APPROVED', 'INPRG', 'COMP', 'CLOSED'] },
block_reason: { type: 'string', enum: ['NONE', 'MATERIAL', 'PLANT_CONDITION', 'SCHEDULE'] },
failure_class: { type: 'string' },
problem_code: { type: 'string' },
cause_code: { type: 'string' },
remedy_code: { type: 'string' },
symptom_note: { type: 'string' },
cause_note: { type: 'string' },
action_note: { type: 'string' },
```

- New `workOrdersMigrationV3` migration strategy (v2→v3):

```js
const workOrdersMigrationV3 = {
  3: async (oldDoc) => {
    const statusToPhase = {
      pending: 'WAPPR',
      in_progress: 'INPRG',
      completed: 'COMP',
      cancelled: 'CLOSED'
    };

    return {
      ...oldDoc,
      lifecycle_phase: statusToPhase[oldDoc.status] ?? 'WAPPR',
      block_reason: 'NONE',
      failure_class: '',
      problem_code: '',
      cause_code: '',
      remedy_code: '',
      symptom_note: '',
      cause_note: '',
      action_note: ''
    };
  }
};
```

- **Removed fields**: `status` (replaced by `lifecycle_phase`)
- **Backward compat**: The migration preserves all existing fields; the old `status` is removed from the schema but if present on old docs, the strategy maps it. The `_deleted` field is preserved.
- Update collection registration to pass both `workOrdersMigrationV2` and `workOrdersMigrationV3`:

```js
work_orders: {
  schema: workOrderSchema,
  migrationStrategies: {
    ...workOrdersMigrationV2,
    ...workOrdersMigrationV3
  }
}
```

- **preSave hook update**: Must validate `lifecycle_phase` transitions instead of `status`:

```js
db.work_orders.preSave((plainData, doc) => {
  const oldPhase = doc.lifecycle_phase;
  const newPhase = plainData.lifecycle_phase ?? oldPhase;
  if (oldPhase && newPhase && oldPhase !== newPhase && !isValidTransition(oldPhase, newPhase)) {
    throw new Error(`FSM violation: ${oldPhase} → ${newPhase}`);
  }
}, false);
```

- **Push handler update**: Add `lifecycle_phase`, `block_reason` to `WORK_ORDER_PUSH_FIELDS`
- **Conflict recovery update**: The push handler's `revertStatus` code (line 405-409) queries `status` from Supabase — must change to `lifecycle_phase`

### DD5: SyncStatusIndicator

- **File**: `src/components/SyncStatusIndicator.jsx`
- Exports named `NavSyncIndicator` (fixing the broken import in `App.jsx` line 6)
- Props: `{ status: 'online' | 'syncing' | 'offline' }`
- MUI rendering:

| Status | Visual | Label |
|--------|--------|-------|
| `online` | green dot (MUI `success` Chip) | "En línea" |
| `syncing` | animated pulse (CSS keyframe) | "Sincronizando" |
| `offline` | red dot (MUI `error` Chip) | "Sin conexión" |

- Uses `<Box>` with `sx` for custom CSS, no external animation libraries
- Sync state derived from replication `active$` observables (already available from `useWorkOrders` and `useRxDB` hooks)

### DD6: useWorkOrders Hook Update

- **File**: `src/hooks/useWorkOrders.js` (the canonical hook used by `App.jsx`)
- Add `lifecycleFilter` parameter to the function signature:

```js
export function useWorkOrders({ lifecycleFilter = null } = {}) {
```

- Filter logic in the subscription callback:

```js
subscription = collection.find().$.subscribe({
  next: (docs) => {
    try {
      const activeDocs = docs
        .map(doc => doc.toJSON())
        .filter(doc => !doc._deleted)
        .filter(doc => {
          if (!lifecycleFilter) return true;
          return lifecycleFilter.includes(doc.lifecycle_phase);
        });
      setWorkOrders(activeDocs);
    } catch (e) {
      console.error('[useWorkOrders] Error procesando docs:', e);
    }
  },
});
```

- When `lifecycleFilter` is null/undefined, all phases pass through (backward compat for AssetTree usage)
- Default value: `null` — existing consumers (`App.jsx`) continue to work unchanged
- **Note**: The hook currently filters by `is_deleted` (wrong field name in the code) — must fix to `_deleted` to match the schema. This is a pre-existing bug being corrected.
- The duplicate `useWorkOrders` in `src/lib/rxdb.js` (line 622) should be considered for consolidation in a follow-up but is NOT in scope for this phase.

## File Map

| File | Action | Description |
|------|--------|-------------|
| `src/lib/fsm.js` | MODIFY | Replace old status FSM with lifecycle_phase transitions; add `getPhaseLabel()`, `getPhaseColor()` |
| `src/lib/adapters/workOrderAdapter.js` | CREATE | Pure DTO transformation: RxDB doc → ViewModel |
| `src/hooks/useWorkOrders.js` | MODIFY | Add `lifecycleFilter` param, filter by `_deleted` (fix pre-existing bug), filter by lifecycle_phase |
| `src/lib/rxdb.js` | MODIFY | Schema v3 migration, add lifecycle_phase/block_reason fields, update preSave, update push fields |
| `src/components/mechanic/WorkOrderCard.jsx` | CREATE | Presenter: single card with lifecycle badge, conflict indicator, key fields |
| `src/components/mechanic/WorkOrderList.jsx` | CREATE | Presenter: card list with empty state |
| `src/components/mechanic/WorkOrderStatusBadge.jsx` | CREATE | Presenter: MUI Chip colored by lifecycle_phase |
| `src/components/SyncStatusIndicator.jsx` | CREATE | Named export `NavSyncIndicator` — online/syncing/offline dot + label |
| `src/pages/MechanicDashboard.jsx` | CREATE | Container: wires useWorkOrders + adapter + presenters |
| `src/App.jsx` | MODIFY | Import and mount `<MechanicDashboard />` |


## Data Contracts

### RxDB → UI ViewModel (workOrderAdapter.toViewModel)

```js
{
  id: string,                    // passthrough
  equipmentId: string,           // equipment_id → camelCase
  description: string,           // passthrough, null → ''
  lifecyclePhase: 'WAPPR' | 'APPROVED' | 'INPRG' | 'COMP' | 'CLOSED',
  lifecycleLabel: string,        // getPhaseLabel(lifecyclePhase)
  lifecycleColor: 'warning' | 'info' | 'primary' | 'success' | 'default',
  criticality: string,           // passthrough
  criticalityColor: 'error' | 'warning' | 'success',  // A→error, B→warning, C→success
  priority: string,              // passthrough
  hasConflict: boolean,          // Boolean(_conflict)
  isDeleted: boolean,            // Boolean(_deleted)
  scheduledDate: string,         // Intl.DateTimeFormat('es-MX').format(new Date(scheduled_date))
  assetId: string,               // passthrough
  woType: string,                // passthrough
  plannedHours: number           // passthrough
}
```

### Component Props

```ts
// MechanicDashboard — no props, container is self-contained
<MechanicDashboard />

// WorkOrderList
<WorkOrderList
  workOrders: WorkOrderViewModel[]       // transformed docs
  onSelect: (id: string) => void         // card tap callback
/>

// WorkOrderCard
<WorkOrderCard
  workOrder: WorkOrderViewModel          // single view model
  onSelect: (id: string) => void         // card tap callback
/>

// WorkOrderStatusBadge
<WorkOrderStatusBadge
  phase: string                          // lifecycle_phase value
  size?: 'small' | 'medium'             // MUI Chip size, default 'medium'
/>

// SyncStatusIndicator / NavSyncIndicator
<NavSyncIndicator
  status: 'online' | 'syncing' | 'offline'
/>
```

### Hook Signature

```ts
useWorkOrders({ lifecycleFilter?: string[] }): {
  workOrders: RawRxDBDoc[],
  allWorkOrders: RawRxDBDoc[],   // backward compat, same as workOrders
  loading: boolean,
  error: Error | null,
  syncStatus: 'online' | 'syncing' | 'offline',
  createWorkOrder: (doc) => Promise,
  updateWorkOrder: (id, updates) => Promise,
  deleteWorkOrder: (id) => Promise
}
```

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Schema v3 migration fails on existing offline data** | Medium | Migration strategy is a pure function mapping `status`→`lifecycle_phase`; no async lookups (unlike v2 migration which queried assets). If it fails, RxDB falls back to schema conflict detection (DB6 error) and drops/recreates — we keep the fallback catch in `_createDatabase()`. |
| **Two useWorkOrders hooks cause confusion** | Medium | Design explicitly selects `src/hooks/useWorkOrders.js` as canonical. `src/lib/rxdb.js`'s `useWorkOrders` is noted for future dedup. Add a JSDoc comment on the duplicate warning of the canonical location. |
| **`is_deleted` vs `_deleted` inconsistency** | Low | The `useWorkOrders.js` hook currently filters by `is_deleted` but schema defines `_deleted`. Fixing this in DD6. Must also update `createWorkOrder` in that hook which sets `is_deleted: false` → should be `_deleted: false`. |
| **Push handler conflicts after schema change** | Low | The push handler serializes `WORK_ORDER_PUSH_FIELDS` which must include `lifecycle_phase` and `block_reason`; the conflict recovery code (lines 405-409) currently queries `status` from Supabase — must query `lifecycle_phase` instead. |
| **preSave hook rejects valid migration** | Low | The preSave hook fires on `_deleted` changes too. Migration itself bypasses preSave because it runs during schema upgrade, not during normal writes. But `insert` operations after migration must pass validation. The preSave must handle `undefined` oldPhase gracefully (new docs being inserted). |
| **NavSyncIndicator breaks App.jsx if not named export** | Low | The import in `App.jsx` is `{ NavSyncIndicator }` — the new file MUST export a named `NavSyncIndicator` (not default). |
| **No explore artifact found** | Low | The explore phase was skipped or not persisted. The proposal + spec + prior ISO 14224 design provide sufficient context to proceed. Any open questions should be raised during review. |

## Open Questions

1. Should the duplicate `useWorkOrders` in `src/lib/rxdb.js` be removed/deprecated as part of this change, or left as a follow-up? (Design says follow-up to keep scope contained.)
2. Should `MechanicDashboard` be mounted unconditionally in `App.jsx` or behind a feature flag / route? Phase 1 doesn't include routing, so unconditional mount or a simple tab/button toggle is needed.
3. The `createWorkOrder` function in useWorkOrders.js sets `is_deleted: false` instead of `_deleted: false` — this should be fixed regardless of phase scope since it's a data corruption bug.
