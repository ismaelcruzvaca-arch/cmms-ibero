# Archive Report: safety-permits

**Change**: safety-permits
**Archived**: 2026-05-24
**Status**: COMPLETE ✅

## Overview

Safety & Permits — Phase 1 (PTW + LOTO). Added Permit to Work and Lockout/Tagout capabilities to the CMMS, the highest-value HSE entry point. Planners can now issue, approve, and track work permits with isolation procedures.

## Deliverables

| Artifact | Path | Status |
|----------|------|--------|
| Migration | `supabase/migrations/20260527000001_safety_permits.sql` | ✅ Created (717 lines) |
| Test Suite | `supabase/tests/database/safety_permits_test.sql` | ✅ Created (839 lines, 50 pgTAP tests) |

### Migration Contents (717 lines)

- **3 ENUMs**: `permit_status` (7 states), `loto_status` (4 states), `device_type` (4 values)
- **1 ALTER TABLE**: Added `SAFETY_OFFICER` to `user_profiles` role CHECK constraint (DROP/ADD pattern)
- **5 Tables**: `permit_types`, `work_permits`, `permit_tasks`, `lockout_tagout`, `tagout_devices`
- **2 FSM Triggers**:
  - `fn_validate_permit_fsm` — 7-state PTW lifecycle (REQUESTED→APPROVED→ACTIVE→COMPLETED + REJECTED/CANCELLED/EXPIRED terminals) with gas test gate on APPROVED→ACTIVE
  - `fn_validate_loto_fsm` — 4-state LOTO lifecycle (PLANNED→LOCKED→VERIFIED→REMOVED) with two-person rule (verified_by != locked_by)
- **1 Auto-expiry trigger**: `fn_permit_auto_expiry` on work_permits (passive — fires on next UPDATE)
- **5 Audit triggers**: Reuses existing `audit_trigger_func()` on all 5 tables
- **RLS policies**: 20 policies (4 per table) via `get_user_role()` — ADMIN/SAFETY_OFFICER ALL, PLANNER SELECT/INSERT/UPDATE, TECHNICIAN SELECT
- **Seed data**: 7 permit types (HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION)
- **Indexes**: 15 indexes on FK columns and status columns
- **Spanish COMMENTS**: All tables, columns, triggers, and functions documented in Spanish

### Test Suite (50 pgTAP tests)

| Category | Tests | Description |
|----------|-------|-------------|
| Schema | 20 | Table existence, ENUM values, column types, FK references, defaults, CHECK constraints |
| PTW FSM | 10 | Full lifecycle, backward rejection, gas test gate, auto-expiry, invalid values |
| LOTO FSM | 8 | Full lifecycle, skip verification, two-person rule, backward rejection |
| RLS | 8 | TECHNICIAN read-only, PLANNER INSERT/UPDATE/DELETE, SAFETY_OFFICER ALL, ADMIN ALL |
| Cascade | 4 | permit_tasks ON DELETE CASCADE, tagout_devices ON DELETE CASCADE |

## Verification

**Result**: PASS ✅ (Standard mode)

### Critical Issues (2 — both FIXED during verification)

1. Gas test gate was on incorrect transition (APPROVED→APPROVED instead of APPROVED→ACTIVE) → MOVED to correct transition
2. Non-UUID IDs in test INSERTs → Replaced all with valid UUIDs

### Warnings (3 — all acceptable for Phase 1)

- FK reference naming: `col_is_fk` uses different schema qualifier pattern from existing tests
- No test for `device_type` ENUM validation (spec scenario exists but not tested)
- Auto-expiry requires 2-step UPDATE (by design — passive trigger)

### Spec Compliance

- **permit-to-work**: 6/6 requirements covered, 5/5 scenarios testable
- **lockout-tagout**: 4/4 requirements covered, 5/5 scenarios testable
- Client-Driven architecture: NO auto-creation triggers ✅
- PTW→WO relationship: INFORMATIONAL (no restrictive triggers) ✅

## Engram Artifact References

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Proposal | #671 | `sdd/safety-permits/proposal` |
| Spec | #676 | `sdd/safety-permits/spec` |
| Design | #681 | `sdd/safety-permits/design` |
| Tasks | #683 | `sdd/safety-permits/tasks` |
| Verify Report | #695 | `sdd/safety-permits/verify-report` |
| Archive Report | (current) | `sdd/safety-permits/archive-report` |

## Archive Contents

```
openspec/changes/archive/2026-05-24-safety-permits/
├── archive-report.md        (this file)
├── design.md                (technical design, 626 words)
├── exploration.md           (initial exploration)
├── proposal.md              (change proposal)
├── tasks.md                 (task breakdown)
├── verify-report.md         (verification results)
└── specs/
    ├── permit-to-work/
    │   └── spec.md          (PTW specification)
    └── lockout-tagout/
        └── spec.md          (LOTO specification)
```

## Decisions with Rationale

| Decision | Rationale |
|----------|-----------|
| Single migration file (not 3) | All tables are new with no data dependencies; simplifies deployment |
| Passive auto-expiry (BEFORE UPDATE, no pg_cron) | Avoids infrastructure dependency (pg_cron extension); acceptable caveat documented |
| DROP/ADD pattern for SAFETY_OFFICER role | Existing CHECK constraint from inventory migration needed clean modification |
| Gas test gate on APPROVED→ACTIVE | Logical: gas test is a pre-activation safety check, not an approval condition |
| Two-person rule in LOTO (verified_by != locked_by) | Industry standard for safety-critical isolation procedures |
| PTW→WO as informational FK (no restrictive triggers) | Client-Driven philosophy: WO lifecycle should not auto-block; planner discretion |
| 7 permit_status states | Covers core workflow (REQUESTED→APPROVED→ACTIVE→COMPLETED) with realistic terminals (REJECTED, CANCELLED, EXPIRED) |
| No auto-creation triggers | Consistent with Client-Driven architecture — server validates, never creates |

## Future Work Items

### PTW→WO Restrictive Triggers (Deferred)
- **Status**: Documented in Engram as "FUTURO: Agregar restricción PTW→WO en lifecycle"
- **Description**: Currently PTW→WO relationship is informational (WO can proceed without a permit). Future phase may add restrictive triggers (e.g., block WO lifecycle transition if WO type requires permit and none is ACTIVE).

### pg_cron Sweep for Orphaned ACTIVE Permits
- **Status**: Suggestion from verification report
- **Description**: Auto-expiry is currently passive (fires on next UPDATE). A pg_cron job could bulk-expire orphaned ACTIVE permits on a schedule.

### Phase 2 — Incidents, Hazards, Risk Assessment
- **Status**: Planned (separate change)
- **Description**: Incidents reporting, hazard identification, and risk assessment tables.

### Device_type ENUM Validation Test
- **Status**: Missing test coverage
- **Description**: Spec scenario exists but no pgTAP test verifies that invalid `device_type` values are rejected. Should be added in a future cleanup pass.

## SDD Cycle Complete

The change has been fully planned (proposal → spec → design → tasks), implemented (migration + tests), verified (50 pgTAP tests pass), and archived. Ready for subsequent phases.
