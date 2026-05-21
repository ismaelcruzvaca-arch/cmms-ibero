# Tasks: App del Mecánico (Fase 1)

## Review Workload Forecast
- Estimated changed lines: **~369**
- 400-line budget risk: **Medium** — close to budget; schema migration + push handler conflict recovery carry complexity that could push over
- Chained PRs recommended: **No** — fits in a single PR at ~369 lines
- Decision needed before apply: **Yes** — Open Question #2: how to mount MechanicDashboard (unconditional vs. toggle/route); orchestrator must ask user

## Phase 1: Foundation

### Task 1.1: RxDB Schema v3 Migration
**File**: `src/lib/rxdb.js`
**Action**: Modify
**Description**: Increment `workOrderSchema.version` from 2 to 3; drop `status` field; add `lifecycle_phase`, `block_reason`, `failure_class`, `problem_code`, `cause_code`, `remedy_code`, `symptom_note`, `cause_note`, `action_note` fields; create `workOrdersMigrationV3` strategy mapping old `status` → `lifecycle_phase`; update collection registration to spread both v2 and v3 migrations; update `preSave` hook to validate `lifecycle_phase` transitions instead of `status`; add `lifecycle_phase` and `block_reason` to `WORK_ORDER_PUSH_FIELDS`; update conflict recovery code (line ~405) to query `lifecycle_phase` from Supabase instead of `status`; remove `status` from `required` array.
**Acceptance**: Schema v3 migration runs without errors on existing docs; new docs insert with `lifecycle_phase`; old docs are migrated with correct phase mapping (pending→WAPPR, in_progress→INPRG, completed→COMP, cancelled→CLOSED); preSave rejects invalid lifecycle transitions; push handler sends new fields to Supabase; conflict recovery reads `lifecycle_phase` from server; no data loss on rollback.
**Depends on**: None

### Task 1.2: Update FSM with lifecycle_phase Transitions
**File**: `src/lib/fsm.js`
**Action**: Modify
**Description**: Replace `ALLOWED_TRANSITIONS` old status map (pending/in_progress/completed/cancelled) with ISO 14224 lifecycle model (WAPPR→APPROVED→INPRG→COMP→CLOSED); add `PHASE_LABELS` constant (WAPPR→'Pendiente Aprobación', APPROVED→'Aprobada', INPRG→'En Progreso', COMP→'Completada', CLOSED→'Cerrada'); add `PHASE_COLORS` constant (WAPPR→warning, APPROVED→info, INPRG→primary, COMP→success, CLOSED→default); export `getPhaseLabel(phase)` and `getPhaseColor(phase)` helper functions; keep existing `isValidTransition`, `getAllowedTransitions`, `isTerminal` signatures unchanged.
**Acceptance**: `isValidTransition('WAPPR', 'APPROVED')` returns true; `isValidTransition('APPROVED', 'WAPPR')` returns false; `getPhaseLabel('WAPPR')` returns 'Pendiente Aprobación'; `getPhaseColor('APPROVED')` returns 'info'; old status values passed to `isValidTransition` return false (no silent data corruption); file still under 55 lines.
**Depends on**: None

## Phase 2: Adapter

### Task 2.1: Create workOrderAdapter
**File**: `src/lib/adapters/workOrderAdapter.js` (new directory)
**Action**: Create
**Description**: Pure function `toViewModel(rxdbDoc)` that transforms a single RxDB work_order document to a UI ViewModel; `toViewModelList(docs)` that maps array. Mapping: `id`→id, `equipment_id`→equipmentId, `description`→description (null→''), `lifecycle_phase`→lifecyclePhase, lifecycleLabel (from `getPhaseLabel`), lifecycleColor (from `getPhaseColor`), `criticality`→criticalityColor (A→error, B→warning, C→success), `priority`→priority, `scheduled_date`→scheduledDate (`Intl.DateTimeFormat('es-MX')`), `_conflict`→hasConflict (Boolean), `_deleted`→isDeleted (Boolean), `asset_id`→assetId, `wo_type`→woType, `planned_hours`→plannedHours. Import `getPhaseLabel` and `getPhaseColor` from `../fsm.js`. No RxDB or Supabase imports. No side effects. Default export `toViewModel`, named export `toViewModelList`.
**Acceptance**: Given a raw RxDB doc with `{id:'1', equipment_id:'PMP-001', description:'Fix pump', lifecycle_phase:'WAPPR', criticality:'A', priority:'high', scheduled_date:'2026-06-01', _conflict:true, asset_id:'a1', wo_type:'corrective', planned_hours:4}`, `toViewModel` returns a plain object with camelCase keys, `lifecycleLabel: 'Pendiente Aprobación'`, `lifecycleColor: 'warning'`, `criticalityColor: 'error'`, `hasConflict: true`, `scheduledDate` formatted in es-MX locale; `toViewModelList([])` returns `[]`; function is pure (no side effects, no DB calls).
**Depends on**: Task 1.2 (needs `getPhaseLabel`, `getPhaseColor` from fsm.js)

## Phase 3: Presenters

### Task 3.1: Create WorkOrderStatusBadge
**File**: `src/components/mechanic/WorkOrderStatusBadge.jsx`
**Action**: Create
**Description**: Functional component with props `{ phase: string, size?: 'small' | 'medium' }`. Renders MUI `<Chip>` with `label={getPhaseLabel(phase)}` and `color={getPhaseColor(phase)}`, size defaults to 'medium'. Import getPhaseLabel and getPhaseColor from `../../lib/fsm.js`. No hooks, no data fetching, no side effects. Default export.
**Acceptance**: `<WorkOrderStatusBadge phase="WAPPR" />` renders MUI Chip with label "Pendiente Aprobación" and color "warning"; `<WorkOrderStatusBadge phase="APPROVED" size="small" />` renders small Chip with label "Aprobada" and color "info"; unknown phase renders label as-is with fallback color "default".
**Depends on**: Task 1.2

### Task 3.2: Create WorkOrderCard
**File**: `src/components/mechanic/WorkOrderCard.jsx`
**Action**: Create
**Description**: Functional component with props `{ workOrder: WorkOrderViewModel, onSelect: (id) => void }`. Renders MUI `<Card>` with: left border accent colored by `criticalityColor`; `WorkOrderStatusBadge` with `phase={workOrder.lifecyclePhase}`; `hasConflict` true → conflict warning badge with tooltip "Conflicto de sincronización" (use MUI Tooltip + Chip/Badge) + light amber border/background tint; displays equipmentId, description (truncated to 2 lines), priority, scheduledDate. onClick on the card calls `onSelect(workOrder.id)`. Uses MUI Card, CardContent, Typography, Box. No hooks. Default export.
**Acceptance**: Card renders all fields; left border uses criticalityColor (red for A, amber for B, green for C); conflict badge shows when hasConflict is true with tooltip; card onClick fires onSelect with the workOrder id; card looks reasonable at both mobile and desktop widths.
**Depends on**: Task 3.1

### Task 3.3: Create WorkOrderList
**File**: `src/components/mechanic/WorkOrderList.jsx`
**Action**: Create
**Description**: Functional component with props `{ workOrders: WorkOrderViewModel[], onSelect: (id) => void }`. Maps workOrders array to `<WorkOrderCard>` components wrapped in a `<Stack>` or `<Box>` with gap. Shows MUI `<Typography>` "No hay órdenes de trabajo pendientes" with subdued styling when workOrders is empty. Default export. No hooks. No data fetching.
**Acceptance**: Given 3 ViewModels, renders 3 WorkOrderCards stacked vertically; given empty array, renders empty state text; onSelect propagates to each card.
**Depends on**: Task 3.2

### Task 3.4: Create SyncStatusIndicator
**File**: `src/components/SyncStatusIndicator.jsx`
**Action**: Create
**Description**: Exports named `NavSyncIndicator` (to fix broken `import { NavSyncIndicator }` in App.jsx line 6). Props: `{ status: 'online' | 'syncing' | 'offline' }`. Renders MUI `<Box>` with a colored dot (MUI `<Chip>` variant="outlined" with a small colored circle via `sx`) and text label. States: online → green dot + "En línea"; syncing → pulsing animation (CSS keyframe in `sx`) + "Sincronizando"; offline → red dot + "Sin conexión". Uses `<Box>` with `sx` for custom CSS, no external animation libraries. No hooks, no side effects. No default export (only named).
**Acceptance**: `<NavSyncIndicator status="online" />` renders green indicator with "En línea"; status="syncing" shows animated pulse with "Sincronizando"; status="offline" shows red indicator with "Sin conexión"; import `{ NavSyncIndicator }` in App.jsx resolves without error.
**Depends on**: None

## Phase 4: Container

### Task 4.1: Create MechanicDashboard
**File**: `src/pages/MechanicDashboard.jsx`
**Action**: Create (new `src/pages/` directory)
**Description**: Self-contained container component. Calls `useWorkOrders({ lifecycleFilter: ['WAPPR', 'APPROVED'] })`. Transforms raw docs via `workOrderAdapter.toViewModelList(docs)`. Renders `<SyncStatusIndicator>` in header area, then `<WorkOrderList workOrders={viewModels} onSelect={handleSelect} />`. `handleSelect` logs selected ID to console (no navigation yet). Manages loading state (show MUI CircularProgress or skeleton if loading, show error Alert if error). No props (self-contained). Default export.
**Acceptance**: Renders loading state while useWorkOrders initializes; renders error Alert if error is non-null; renders SyncStatusIndicator + WorkOrderList with transformed ViewModels when data loads; clicking a card logs the work order id and does not crash; no import of RxDB directly (only through useWorkOrders hook and adapter).
**Depends on**: Task 2.1, Task 3.3, Task 3.4, Task 4.2

### Task 4.2: Update useWorkOrders Hook
**File**: `src/hooks/useWorkOrders.js`
**Action**: Modify
**Description**: Add `lifecycleFilter` parameter to `useWorkOrders` signature: `export function useWorkOrders({ lifecycleFilter = null } = {})`. Add filter step in both the initial query subscription callback: `.filter(doc => { if (!lifecycleFilter) return true; return lifecycleFilter.includes(doc.lifecycle_phase); })`. Fix pre-existing bug: replace all `doc.is_deleted` with `doc._deleted` in both the initial query and subscription callback (3 occurrences: lines 57, 70, 115, 150). The `createWorkOrder` and `deleteWorkOrder` functions also set `is_deleted` → must change to `_deleted`. Keep backward compatibility: when `lifecycleFilter` is null/undefined, all phases pass through. Return value unchanged.
**Acceptance**: `useWorkOrders()` (no args) returns all non-deleted work orders (backward compat); `useWorkOrders({ lifecycleFilter: ['WAPPR'] })` returns only WAPPR work orders; `is_deleted` no longer appears anywhere in the file; `_deleted` is used consistently in filters, insert, and soft-delete.
**Depends on**: Task 1.1 (needs `lifecycle_phase` field on documents)

## Phase 5: Integration

### Task 5.1: Wire MechanicDashboard into App.jsx
**File**: `src/App.jsx`
**Action**: Modify
**Description**: Import `MechanicDashboard` from `./pages/MechanicDashboard`. Add `<MechanicDashboard />` to the component tree. Placement depends on user decision for Open Question #2: either unconditional mount below the asset tree section, or behind a simple toggle button. Default approach (pending user confirmation): mount unconditionally below the existing `<Grid>` layout, wrapped in a `<Paper>` similar to the AssetTree section. Update the subtitle from "Módulo de Jerarquía de Activos" to "Módulo de Órdenes y Activos" or similar.
**Acceptance**: MechanicDashboard renders in App without errors; SyncStatusIndicator shows correct sync state; work order list shows only WAPPR/APPROVED orders; NavSyncIndicator import from SyncStatusIndicator resolves (was previously broken); no regressions in AssetTree, AssetSearchBar, AssetDetailsPanel, QRScannerModal.
**Depends on**: Task 4.1, Task 3.4

## Migration Safety Cross-Check

| Concern | Mitigation in Tasks |
|---------|---------------------|
| v2→v3 migration breaks existing offline data | Task 1.1 — pure function mapping status→lifecycle_phase; no async lookups (unlike v2 migration); RxDB fallback to DB6 drop/recreate |
| `is_deleted` vs `_deleted` inconsistency | Task 4.2 — fixes all 5 occurrences to use `_deleted` |
| Push handler conflict recovery queries `status` | Task 1.1 — updates Supabase query to `lifecycle_phase` |
| preSave hook rejects valid migration | Task 1.1 — preSave handles undefined oldPhase (new doc insert) gracefully |
| Two `useWorkOrders` hooks confusion | Out of scope for Phase 1 per design; noted in Task 4.2 to add JSDoc pointing to canonical location |
| NavSyncIndicator breaks App.jsx import | Task 3.4 — creates file with named export `NavSyncIndicator` matching the existing import |
