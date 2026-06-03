# Proposal: Labor Reporting / Time Tracking

## Intent

Enable mechanics to clock in/out against work orders with activity codes, capturing accurate wrench-time data for future productivity analysis. Replaces manual hours estimation with real clock data.

## Scope

### In Scope
- `labor_records` table (Supabase migration + RLS + audit trigger)
- RxDB `labor_records` collection + push/pull replication + hook + adapter
- Clock-in/out widget in WorkOrderDrawer with activity code selector
- FSM auto clock-in on APPROVED→INPRG, auto clock-out on INPRG→COMP
- COMP transition blocked if no active clock session
- Multiple clock sessions per WO (no pause/resume)
- Re-add `actual_hours` to `work_orders` (auto-sum on COMP→CLOSED)
- Offline-first via RxDB

### Out of Scope
- Crafts/qualifications tables (Phase 2)
- GPS/geolocation (Phase 2)
- Cost rates / payroll integration (Phase 2+)
- Labor dashboards / Wrench Time analytics (Phase 2 — raw data only)

## Capabilities

### New Capabilities
- `labor-records-database`: labor_records table, CHECK constraint on activity_code, RLS, FSM integration triggers, audit trail
- `labor-records-rxdb`: RxDB collection schema, replication handlers, `useLaborRecords` hook, `laborAdapter`
- `labor-clock-widget`: ClockWidget component with activity code selector inside WorkOrderDrawer

### Modified Capabilities
- `mechanic-work-order-execution`: Drawer includes clock widget, COMP validation checks for open clock session

## Approach

Clock-in/out with **multiple independent sessions** per WO (no pause/resume). Each session is a `labor_records` row with `start_time`, nullable `end_time`, and required `activity_code`. Hours are `GENERATED ALWAYS AS` — no manual entry.

| Event | Action |
|-------|--------|
| APPROVED→INPRG | Auto-create DIRECT_WORK session if none active |
| INPRG→COMP | Set `end_time = NOW()` on active session |
| COMP→CLOSED | SUM all labor_records → `work_orders.actual_hours` |
| Manual clock-in | Select activity code → insert with `start_time = NOW()` |
| Manual clock-out | Set `end_time = NOW()` on the active record |

## Affected Areas

| Area | Impact | Detail |
|------|--------|--------|
| `supabase/migrations/202605<next>_labor_records.sql` | **NEW** | labor_records table, updated_at trigger, RLS, FSM trigger integration, ALTER work_orders ADD actual_hours |
| `supabase/tests/database/labor_records_test.sql` | **NEW** | pgTAP tests for schema, RLS, FSM triggers |
| `src/lib/rxdb.js` | **MODIFY** | Add labor_records schema + collection + replication handlers to `addCollections()` and `startAllReplications()` |
| `src/lib/adapters/laborAdapter.js` | **NEW** | RxDB→ViewModel mapping (same pattern as workOrderAdapter) |
| `src/hooks/useLaborRecords.js` | **NEW** | RxDB hook with subscription (same pattern as useWorkOrders) |
| `src/components/mechanic/LaborClockWidget.jsx` | **NEW** | Clock-in/out button + activity code selector |
| `src/pages/MechanicDashboard.jsx` | **MODIFY** | Wire `useLaborRecords` hook, pass labor state to drawer |
| `src/components/mechanic/WorkOrderDrawer.jsx` | **MODIFY** | Add clock widget section, labor session display |
| `src/components/mechanic/WorkOrderActions.jsx` | **MODIFY** | Accept `hasActiveClock` prop, disable COMP if no clock |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mechanic forgets clock-in | Medium | Allow manual session creation as fallback within drawer |
| Offline clock with wrong device time | Low | Store `device_timestamp`; reconcile with server on sync |
| Multi-day WO | Low | Multiple sessions auto-summed on COMP→CLOSED |
| Concurrent edits on same labor_record | Low | Each session is own row; no conflict expected |

## Rollback Plan

1. Remove labor_records collection from `startAllReplications()`
2. Drop `labor_records` table via migration
3. Remove `actual_hours` column if it was added by migration
4. Revert Drawer/Actions/MechanicDashboard to previous versions

## Dependencies

None — `labor_records` references existing `work_orders(id)` (TEXT) and `user_profiles(id)` (UUID).

## Success Criteria

- [ ] Mechanic can clock in with activity code from WO drawer
- [ ] COMP transition is blocked when no active clock session exists
- [ ] Offline clock-in/out syncs when connectivity returns
- [ ] FSM trigger creates labor_record on APPROVED→INPRG (auto DIRECT_WORK)
- [ ] COMP→CLOSED sums all labor_records.hours_worked → work_orders.actual_hours
- [ ] RLS: TECHNICIAN can CRUD own records, PLANNER/ADMIN can see all
- [ ] All data survives page reload (RxDB persistence + sync)
