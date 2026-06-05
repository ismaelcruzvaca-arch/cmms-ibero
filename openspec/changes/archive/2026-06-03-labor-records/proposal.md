# Proposal: labor-records

## Intent

Track mechanic hours per work order with activity codes. Replace manual estimates with real clock data. Keep the client (RxDB) as the source of truth for session creation; server validates FSM constraints and auto-sums hours on close.

## Scope

### In Scope
- `labor_records` table with `hours_worked GENERATED ALWAYS AS (end_time - start_time) / 3600 STORED`
- `work_orders.actual_hours` column — auto-summed via trigger on COMP → CLOSED
- `trg_validate_labor_fsm` — defensive insert/update validation (WO must be INPRG for new sessions; non-admin can only touch own sessions)
- `trg_labor_sum_hours` — computes SUM on COMP → CLOSED transition
- RLS: TECHNICIAN CRUD own records, PLANNER SELECT all, ADMIN all
- Updated-at audit trigger

### Out of Scope
- Auto clock-in/out on lifecycle transitions (deferred — manual sessions only)
- Labor dashboards / wrench-time analytics
- Cost rates, payables, payroll
- Crafts/qualifications tables

## Capabilities

### New Capabilities
- `labor-records-database`: labor_records table, CHECK constraint on activity_code, RLS, FSM validation trigger, auto-sum trigger, audit trail

### Modified Capabilities
- None — no existing spec changes at the requirements level

## Approach

| Principle | Detail |
|-----------|--------|
| Client-driven | RxDB creates labor_records rows. Server never auto-creates. |
| Server validates | `trg_validate_labor_fsm` rejects INSERT if WO is not INPRG; rejects UPDATE if non-admin and not the owning technician. |
| Auto-calculated hours | `hours_worked` is a generated column — never written directly. |
| Auto-sum on close | `trg_labor_sum_hours` fires on COMP→CLOSED, sums all `hours_worked` for that WO into `work_orders.actual_hours`. |
| Offline-ready | `device_timestamp` column for offline clock reconciliation. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260526000002_labor_records.sql` | **NEW** | Full migration: DDL, triggers, RLS, indexes |
| `supabase/seed.sql` | Modified | Seed sample labor records if needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mechanic forgets to clock out | Medium | `end_time` NULL allowed; can be reconciled later |
| Offline device timestamp drift | Low | `device_timestamp` stored alongside server timestamps |
| Concurrent close on same WO | Low | Single-row trigger, idempotent SUM |

## Rollback Plan

1. Drop trigger `trg_labor_sum_hours` and `trg_validate_labor_fsm`
2. Drop table `labor_records` via migration
3. Remove `actual_hours` column from `work_orders`
4. Remove RLS policies

## Dependencies

None — `labor_records` references existing `work_orders(id)` (TEXT) and `user_profiles(id)` (UUID). All functions (`get_user_role`, `auth.uid()`) already exist.

## Success Criteria

- [ ] Mechanic can create labor sessions against INPRG work orders only
- [ ] `hours_worked` auto-calculates when `end_time` is set
- [ ] COMP → CLOSED sums all labor hours into `work_orders.actual_hours`
- [ ] RLS: TECHNICIAN sees only own records; PLANNER sees all; ADMIN has full access
- [ ] Non-admin cannot UPDATE a session owned by another technician
