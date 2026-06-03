# Tasks: Safety & Permits — Phase 1 (PTW + LOTO)

## Phase 1: Migration

- [x] 1.1 Create `20260527000001_safety_permits.sql` — 3 ENUMs (permit_status, loto_status, device_type) + ALTER user_profiles role CHECK to add SAFETY_OFFICER
- [x] 1.2 Add 5 tables: permit_types, work_permits, permit_tasks, lockout_tagout, tagout_devices with FKs, CHECK constraints, Spanish COMMENTS
- [x] 1.3 Write PTW FSM trigger: 7-state (REQUESTED→APPROVED→ACTIVE→COMPLETED|REJECTED|CANCELLED|EXPIRED) + gas test gate + auto-expiry
- [x] 1.4 Write LOTO FSM trigger: 4-state (PLANNED→LOCKED→VERIFIED→REMOVED) + two-person rule (verified_by != locked_by)
- [x] 1.5 Attach audit_trigger_func() on all 5 tables + RLS policies via get_user_role() (ADMIN/SAFETY_OFFICER ALL, PLANNER SELECT/INSERT/UPDATE, TECHNICIAN SELECT)
- [x] 1.6 Seed 7 permit_types + add indexes on all FK columns

## Phase 2: Tests

- [x] 2.1 Write pgTAP schema tests: ENUM values, table structure, column constraints, FK references, 7 seed rows
- [x] 2.2 Write PTW FSM tests: full lifecycle, backward rejection, gas test gate, auto-expiry, invalid transitions
- [x] 2.3 Write LOTO FSM tests: full lifecycle, skip verification rejection, two-person rule, ENUM validation
- [x] 2.4 Write RLS tests: TECHNICIAN read-only, PLANNER INSERT/UPDATE blocked on DELETE, SAFETY_OFFICER ALL
- [x] 2.5 Write cascade tests: permit_tasks ON DELETE CASCADE, tagout_devices ON DELETE CASCADE

## Phase 3: Verify & Archive

- [ ] 3.1 Run all pgTAP tests, confirm green
- [ ] 3.2 Review migration: confirm SAFETY_OFFICER role, Italian COMMENTS, no dead code
- [ ] 3.3 Sync delta specs to main specs, archive change via sdd-archive
