# Tasks: Labor Reporting / Time Tracking

## Phase 1: Database Foundation

- [x] 1.1 Create `supabase/migrations/20260526000002_labor_records.sql` with labor_records table, GENERATED hours_worked, CHECK constraint on activity_code, RLS (TECHNICIAN own/PLANNER SELECT/ADMIN ALL), `trg_validate_labor_fsm()` defensive trigger, `trg_labor_sum_hours()` COMP→CLOSED trigger, ALTER work_orders ADD actual_hours
- [x] 1.2 Write `supabase/tests/database/labor_records_test.sql` with pgTAP tests: schema constraints, RLS isolation, FSM trigger validation, COMP→CLOSED auto-sum

## Phase 2: RxDB Layer (offline-first)

- [x] 2.1 Register `laborRecordSchema` + `labor_records` collection in `src/lib/rxdb.js` `addCollections()` (both normal + retry paths)
- [x] 2.2 Add custom pull handler (technician_id filter) + push handler in `startAllReplications()` for labor_records sync
- [x] 2.3 Create `src/lib/adapters/laborAdapter.js` with `toViewModel()` mapping doc→camelCase + durationHours
- [x] 2.4 Create `src/hooks/useLaborRecords.js` exposing `records`, `activeSession`, `clockIn()`, `clockOut()`, `loading`, `error`

## Phase 3: Frontend UI

- [x] 3.1 Create `src/components/mechanic/LaborClockWidget.jsx` with idle/active states, activity code selector (Spanish labels), live HH:MM:SS timer, error+retry handling
- [x] 3.2 Modify `src/components/mechanic/WorkOrderDrawer.jsx` — embed ClockWidget between detail section and action buttons
- [x] 3.3 Modify `src/components/mechanic/WorkOrderActions.jsx` — accept `hasActiveClock` prop, disable COMP with tooltip "Debés registrar Ingreso antes de Completar"

## Phase 4: Wiring & Verification

- [x] 4.1 Modify `src/pages/MechanicDashboard.jsx` — wire `useLaborRecords`, pass labor state (`hasActiveClock`, `activeSession`) to drawer
- [x] 4.2 Integrate `clockIn()`/`clockOut()` in drawer's `handleTransition`: write labor_record first, then WO status update (RxDB has no multi-collection tx)
- [ ] 4.3 End-to-end verification: clock-in→timer, clock-out→COMP enabled, offline sync→no duplicates, RLS isolation, COMP→CLOSED actual_hours populated
