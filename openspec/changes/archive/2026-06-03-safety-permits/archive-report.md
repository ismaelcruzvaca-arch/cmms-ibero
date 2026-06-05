# Archive Report: safety-permits

**Archived**: 2026-06-03
**Previous archive**: `openspec/changes/archive/2026-05-24-safety-permits/`

## Summary

Safety & Permits (PTW + LOTO) — sistema de Permisos de Trabajo y Bloqueo/Etiquetado con FSM en PostgreSQL. Implementado en una migración única con 3 ENUMs, 5 tablas, triggers FSM, RLS, audit triggers y 50 pgTAP tests.

## Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Proposal | `openspec/changes/archive/2026-06-03-safety-permits/proposal.md` | ✅ |
| Spec | `openspec/changes/archive/2026-06-03-safety-permits/spec.md` | ✅ |
| Design | `openspec/changes/archive/2026-06-03-safety-permits/design.md` | ✅ |
| Tasks | `openspec/changes/archive/2026-06-03-safety-permits/tasks.md` | ✅ (4/4 tasks complete) |
| Archive Report | `openspec/changes/archive/2026-06-03-safety-permits/archive-report.md` | ✅ |

## Delta Specs Sync

No delta specs to sync — no `specs/` directory existed for this change. Spec was a single `spec.md` at the change root.

## Verification

All 4 tasks marked complete:
- Phase 1: Database Foundation ✅
- Phase 2: FSM Triggers ✅
- Phase 3: Cross-Cutting ✅
- Phase 4: Security ✅

## Tasks Completed

| # | Task | Status |
|---|------|--------|
| 1.1 | Migration `20260527000001_safety_permits.sql` — ENUMs, alter user_profiles, 5 tablas, seed data | ✅ |
| 1.2 | 50 pgTAP tests (Schema, PTW FSM, LOTO FSM, RLS, Cascade) | ✅ |
| 2.1 | PTW FSM: auto-expiry, validate transitions (REQUESTED→APPROVED→ACTIVE→COMPLETED, REJECTED, CANCELLED, EXPIRED, gas test gate) | ✅ |
| 2.2 | LOTO FSM: forward-only PLANNED→LOCKED→VERIFIED→REMOVED, two-person rule | ✅ |
| 3.1 | `set_safety_updated_at()` + updated_at triggers | ✅ |
| 3.2 | Audit triggers on all 5 tables via `audit_trigger_func()` | ✅ |
| 4.1 | RLS on all 5 tables — 25 policies (ADMIN/SAFETY_OFFICER=ALL, PLANNER=CRUD-no-DELETE, TECHNICIAN=SELECT) | ✅ |

## Files Changed (from proposal)

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260527000001_safety_permits.sql` | Create | 717 lines: ENUMs, 5 tablas, triggers, RLS, seed |
| `supabase/tests/database/safety_permits_test.sql` | Create | 50 pgTAP tests |
| `user_profiles` | Modify | Added `SAFETY_OFFICER` to role CHECK |

## SDD Cycle

- Proposal → Spec → Design → Tasks → Apply (all 4 tasks) → Archive
- State: **Complete**
