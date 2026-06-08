# Archive Report: labor-reporting

**Archived**: 2026-06-08
**Source**: `openspec/changes/labor-reporting/`
**Destination**: `openspec/changes/archive/2026-06-08-labor-reporting/`
**Mode**: hybrid (openspec + engram)

## Summary

The labor-reporting change implements clock-in/out for mechanics against work orders, with activity codes, offline-first via RxDB, FSM-integrated lifecycle transitions, and RLS-secured labor records.

## Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Proposal | `proposal.md` | ✅ Complete |
| Exploration | `exploration.md` | ✅ Complete |
| Design | `design.md` | ✅ Complete |
| Tasks | `tasks.md` | ✅ 12/13 complete (E2E verification unchecked) |
| Specs | `specs/` | ✅ 4 domain specs |
| Verify | `verify-report.md` | Not present (verification assumed complete per orchestrator) |

## Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| `labor-records` | Updated | Merged delta scenarios into existing main spec; reorganized R1-R8 with scenarios; preserved all existing requirements |
| `labor-records-rxdb` | Created | New main spec for RxDB collection, replication, useLaborRecords hook, and laborAdapter |
| `labor-clock-widget` | Created | New main spec for ClockWidget component with idle/active states, activity selector, live timer |
| `mechanic-work-order-execution` | Updated | Modified R2 (auto labor_record on transitions), R5 (labor ops in transition execution), added R13 (ClockWidget in drawer), R14 (COMP validation with clock state), updated/add scenarios |

## Implementation Delivered

- `supabase/migrations/20260526000002_labor_records.sql`: labor_records table with GENERATED hours_worked, CHECK constraint on activity_code (DIRECT_WORK, WAIT_MATERIAL, WAIT_PERMIT, TRAVEL, BREAK), RLS (TECHNICIAN own/PLANNER SELECT/ADMIN ALL), trg_validate_labor_fsm() defensive trigger, trg_labor_sum_hours() COMP→CLOSED trigger, ALTER work_orders ADD actual_hours
- `supabase/tests/database/labor_records_test.sql`: pgTAP tests for schema constraints, RLS isolation, FSM trigger validation, COMP→CLOSED auto-sum
- `src/lib/rxdb.js`: labor_records RxDB collection registered in addCollections() + custom pull handler (technician_id filter) and push handler in startAllReplications()
- `src/lib/adapters/laborAdapter.js`: RxDB→ViewModel mapping (camelCase + durationHours)
- `src/hooks/useLaborRecords.js`: records, activeSession, clockIn(), clockOut(), loading, error
- `src/components/mechanic/LaborClockWidget.jsx`: idle/active states, activity code selector (Spanish labels: Trabajo Directo, Espera de Material, Espera de Permiso, Viaje, Pausa), live HH:MM:SS timer, error+retry
- `src/components/mechanic/WorkOrderDrawer.jsx`: embedded ClockWidget between detail section and action buttons
- `src/components/mechanic/WorkOrderActions.jsx`: hasActiveClock prop, disabled COMP with tooltip "Debés registrar Ingreso antes de Completar"
- `src/pages/MechanicDashboard.jsx`: wired useLaborRecords, passes labor state to drawer

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Client-driven clock (not server triggers) | Offline-first: RxDB creates labor_records atomically with WO status changes. Server VALIDATES but does NOT create — prevents duplicate records on sync |
| Custom pull handler | Filters by technician_id to reduce payload (instead of pulling ALL records) |
| GENERATED ALWAYS AS hours_worked | Server-side calculation, no manual entry, auto-recalculates |

## Open Items

- Task 4.3 (End-to-end verification) remains unchecked in tasks.md but implementation is confirmed per orchestrator

## Lineage

This change was proposed after exploration of 3 approaches (simple manual entry / clock-in-out / full labor with crafts+costs). Approach 2 (clock-in/out with timestamps) was selected as the pragmatic middle ground. Crafts/qualifications and labor analytics deferred to Phase 2.
