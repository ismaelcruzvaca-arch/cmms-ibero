# Proposal: App del Mecánico (Fase 1) — Listado de Órdenes

## Intent
The app currently only shows the Asset Hierarchy. Mechanics have no way to view their assigned work orders, see what state they're in, or know if they're viewing stale data offline. We need a work order list view that filters by lifecycle phase (WAPPR, APPROVED), shows sync/conflict status, and bridges the gap between RxDB's v2 schema and the ISO 14224 standard already in Supabase.

## Scope

### In Scope
1. **workOrderAdapter** — DTO layer in `src/lib/adapters/` that transforms RxDB docs to a UI presentation model, mapping old `status` to `lifecycle_phase` and flattening ISO 14224 fields
2. **Mechanic presenters** — `WorkOrderCard`, `WorkOrderStatusBadge`, `WorkOrderList` in `src/components/mechanic/`
3. **MechanicDashboard** — Container page in `src/pages/` that wires `useWorkOrders` into presenters with lifecycle phase filter
4. **SyncStatusIndicator** — New component at `src/components/` fixing the broken import in `App.jsx`, showing online/syncing/offline
5. **Lifecycle phase filtering** — List view filters by `WAPPR` and `APPROVED` phases only
6. **Offline conflict awareness** — Cards show `_conflict` flag badge when local data diverges from server
7. **RxDB schema v3 migration** — Add `lifecycle_phase`, `block_reason`, ISO 14224 fields; map old `status` → `lifecycle_phase`
8. **FSM update** — `src/lib/fsm.js` transitions: `WAPPR → APPROVED → INPRG → COMP → CLOSED` with block reasons
9. **useWorkOrders hook** — Add `lifecycleFilter` parameter

### Out of Scope
- Work order capture/editing forms
- Navigation/routing system
- User authentication screens
- Technician assignment flow
- Full CRUD for work orders
- Reports or analytics

## Capabilities

### New Capabilities
- **mechanic-work-order-list**: Work order list view for mechanics with WAPPR/APPROVED filtering, offline conflict awareness, and ISO 14224 status display

### Modified Capabilities
- None (no existing specs change)

## Approach
1. Write the RxDB schema v3 migration first to align with Supabase's ISO 14224 model, preserving old data via `lifecycle_phase` mapping
2. Update `fsm.js` with the correct lifecycle transitions and block reasons
3. Build the `workOrderAdapter` as a pure transformation layer — RxDB doc in, UI model out — keeping presenters stateless
4. Create presenter components (`WorkOrderStatusBadge`, `WorkOrderCard`, `WorkOrderList`) as leaf MUI components that receive already-transformed data
5. Wire `MechanicDashboard` as the container using `useWorkOrders` with `lifecycleFilter` prop
6. Create `SyncStatusIndicator` using RxDB's replication `$` observables for live online/offline/syncing state

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| src/lib/fsm.js | Modified | Replace old status FSM with lifecycle_phase transitions |
| src/lib/adapters/ | Created | New workOrderAdapter.js DTO layer |
| src/hooks/useWorkOrders.js | Modified | Add lifecycle filter parameter |
| src/components/mechanic/ | Created | WorkOrderCard, WorkOrderList, WorkOrderStatusBadge |
| src/components/SyncStatusIndicator.jsx | Created | Fix broken import, show sync status |
| src/pages/MechanicDashboard.jsx | Created | Container component |
| src/database/collections/ | Modified | Schema v3 migration for work_orders |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Schema migration breaks existing offline data | Medium | Write migration in backward-compatible steps; test on stored docs |
| ISO 14224 field mapping is lossy for old status values | Low | Map completed→COMP, cancelled→CLOSED, pending→WAPPR, in_progress→INPRG; no data loss |
| Sync conflict detection adds UI complexity | Low | Use RxDB `_conflict` flag directly; show badge, no resolution UI in Phase 1 |

## Rollback Plan
- Revert RxDB schema to v2 by reversing the migration number
- Restore `fsm.js` from git
- Delete `src/lib/adapters/`, `src/components/mechanic/`, `SyncStatusIndicator.jsx`, `MechanicDashboard.jsx`
- Remove `lifecycleFilter` from `useWorkOrders`

## Dependencies
- None beyond existing project deps (MUI v9, RxDB v17, Dexie, Supabase JS v2, React 19, Sentry)

## Success Criteria
- [ ] RxDB schema v3 migration runs without errors and preserves existing docs
- [ ] fsm.js enforces WAPPR→APPROVED→INPRG→COMP→CLOSED transitions and block reasons
- [ ] workOrderAdapter correctly transforms RxDB docs to UI presentation model
- [ ] WorkOrderList shows only WAPPR and APPROVED orders by default
- [ ] WorkOrderCard displays ISO 14224 lifecycle_phase as a human-readable badge
- [ ] WorkOrderCard shows conflict badge when `_conflict` flag is set
- [ ] SyncStatusIndicator renders and reflects real online/syncing/offline state
- [ ] MechanicDashboard renders without errors and wires data end-to-end
- [ ] App.jsx imports SyncStatusIndicator without errors
- [ ] No regressions in Asset Hierarchy module
