# Archive Report: pm-engine-extend

**Date**: 2026-06-03
**Status**: ARCHIVED ✅
**Artifact Store Mode**: hybrid (filesystem + Engram)

---

## Executive Summary

Extended `generate_due_preventive_work_orders()` beyond material inheritance to clone labor, safety, and checklist data from job plans during PM WO generation. Added cost estimation (hours, parts, labor) from cloned snapshots. All 6 tasks completed in a single migration (`20260531000002_pm_engine_extend.sql`).

**⚠️ Known gap**: R5 (Floating-clock `is_floating` support) was defined in the spec and design but NOT implemented in the migration — step g uses fixed-clock recalculation only (original behavior preserved). This should be addressed in a follow-up change.

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| pm-engine-automata | Updated | 4 new requirements merged (R1–R4), 1 scenario corrected (task-level exclusion), acceptance criteria updated |

### Requirements Added to Main Spec

| Requirement | Description | Scenario |
|-------------|-------------|----------|
| Clone job_plan_labor on WO Generation | `job_plan_labor` → `work_order_labor_estimates` | Labor estimates cloned to WO |
| Clone job_plan_safety on WO Generation | `job_plan_safety` → `work_order_safety_requirements` | Safety requirements cloned to WO |
| Attach Checklist Templates on WO Generation | `checklist_templates` → `checklist_instances` (PENDING) | Plan-level instantiated; Task-level excluded |
| Set Work Order Estimated Costs | `estimated_hours`, `estimated_parts_cost`, `estimated_labor_cost` | Costs computed from cloned data |

### Requirements NOT Merged

| Requirement | Reason |
|-------------|--------|
| R5: Floating-clock recalculation for `is_floating = true` | Not implemented in migration — step g uses fixed-clock only |

---

## Archive Contents

All located at `openspec/changes/archive/2026-06-03-pm-engine-extend/`:

| File | Description |
|------|-------------|
| `proposal.md` | ✅ Intent, scope, approach, risks, rollback plan |
| `spec.md` | ✅ 5 requirements (R1–R5), 8 scenarios, states machine |
| `design.md` | ✅ Architecture decisions, data flow, checklist matching matrix, migration plan |
| `tasks.md` | ✅ 6/6 tasks complete |

### Implementation Artifact

| Artifact | Path | Status |
|----------|------|--------|
| Migration | `supabase/migrations/20260531000002_pm_engine_extend.sql` | ✅ Created and deployed |

---

## Verification Status

**No verify-report.md exists** — the change was not formally verified. All 6 tasks are marked [x] in `tasks.md`.

### Implementation Checklist

| Feature | Migration | Status |
|---------|-----------|--------|
| System user seed (`00000000-0000-0000-0000-000000000000`) | Lines 14–19 | ✅ |
| Function scaffold with WO insert + material inheritance (steps a–b) | Lines 21–108 | ✅ |
| Labor cloning (step c) | Lines 110–114 | ✅ |
| Safety cloning (step d) | Lines 116–120 | ✅ |
| Checklist template attachment (step e) | Lines 122–147 | ✅ |
| Cost calculation (step f) | Lines 149–174 | ✅ |
| Floating-clock `is_floating` support (R5) | Not implemented | ❌ |

---

## Known Gaps (Post-Archive)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Floating-clock (`is_floating`) not implemented | Floating PM schedules advance from `next_target_date` instead of `last_completion_date` | Create follow-up change to implement R5 per spec and design |
| No pgTAP tests for new features | Regression risk for labor/safety/checklist cloning | Add tests covering the 4 new requirements and all edge cases |
| No verify-report.md generated | No formal verification record | Verify report should be created in follow-up |

---

## Source of Truth Updated

The following main spec now reflects the new behavior:

- `openspec/specs/pm-engine-automata/spec.md` — updated with labor cloning, safety cloning, checklist attachment, cost estimation requirements

---

## SDD Cycle Complete

The change has been fully planned, implemented, and archived.

Ready for the next change.
