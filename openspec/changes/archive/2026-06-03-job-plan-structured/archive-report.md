# Archive Report: job-plan-structured

**Archived**: 2026-06-03
**Mode**: hybrid

## Change Summary

Expand `job_plans` from basic template to Maximo/SAP-level structured plans with labor requirements by trade, safety requirements (permits/LOTO/PPE), snapshot tables for generated WOs, and supporting columns across related tables.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| preventive-condition-core | Updated | Added 3 columns (asset_type_id, is_active, updated_at) to job_plans; added checklist_templates.job_plan_task_id requirement; extended RLS to cover new tables; added 2 new scenarios |
| pm-engine-automata | Updated | Added 4 new requirements: Clone labor, Clone safety, Attach checklists, Set estimated costs |
| job-plan-safety | Created | New domain spec — safety requirement catalog linked to job plans |
| job-plan-labor | Created | New domain spec — trade-based labor estimation with headcount |

## Tasks Completeness

- Phase 1 (Schema Migration): 8/8 ✅
- Phase 2 (PM Engine Extension): 6/6 ✅
- Phase 3 (Tests): 3/3 ✅
- **Total: 17/17 tasks complete**

## Implementation Artifacts

| Artifact | Lines |
|----------|-------|
| `supabase/migrations/20260531000001_job_plan_structured.sql` | 335 |
| `supabase/migrations/20260531000002_pm_engine_extend.sql` | 191 |
| `supabase/tests/database/job_plan_structured_test.sql` | 357 |

## Verdict

All tasks complete. Implementation artifacts present. SDD cycle closed.
