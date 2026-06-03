# Proposal: Structured Job Plans (job-plan-structured)

## Intent

Expand `job_plans` from a basic template (code, description, hours) to a full class-world Job Plan matching Maximo Task Lists and SAP PM Task Lists. Missing: labor estimation by trade, safety requirements (permits/LOTO/PPE), asset type filtering, task-level checklist linking, and PM→WO auto-generation of those new structures.

## Scope

### In Scope

- **job_plan_labor**: trade, headcount, estimated hours per job plan (connects to labor_records for wrench time, competency engine for min levels)
- **job_plan_safety**: permits, LOTO, PPE requirements per job plan (connects to PTW/LOTO module)
- **job_plans.asset_type_id**: FK to asset_types for type-filtering which plans apply to which assets
- **checklist_templates.job_plan_task_id**: granular FK to job_plan_tasks (beyond current module-level override)
- **PM→WO generation extension**: enhance `generate_due_preventive_work_orders()` to clone labor → labor cost estimate, safety → WO safety requirements, checklists → PENDING checklist instances

### Out of Scope

- Frontend for planner to edit labor/safety/task-checklist links (deferred)
- Analytics on estimated vs actual labor (wrench time dashboard deferred)
- WO safety requirements runtime lifecycle (clone only — execution is future)

## Capabilities

### New Capabilities

- `job-plan-labor`: trade-based labor estimation with headcount and planned hours per job plan
- `job-plan-safety`: safety requirement catalog (permits, LOTO procedures, PPE) linked to job plans

### Modified Capabilities

- `preventive-condition-core`: add `asset_type_id` column to `job_plans`, new `job_plan_labor` + `job_plan_safety` tables, task-level FK on `checklist_templates`, extend PM→WO generation to clone labor + safety + checklists

## Approach

Two sequential migrations:
1. **Schema**: CREATE `job_plan_labor`, `job_plan_safety`; ALTER `job_plans` ADD `asset_type_id`; ALTER `checklist_templates` ADD `job_plan_task_id`; RLS, audit, COMMENT ON per existing patterns
2. **Function extension**: Modify `generate_due_preventive_work_orders()` to also INSERT into new WO-linked tables (labor_cost_estimates, wo_safety_requirements, checklist_instances)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/2026NNNN_job_plan_structured.sql` | New | 2 tables, 2 ALTERs, RLS, audit, comments |
| `supabase/tests/database/job_plan_structured_test.sql` | New | pgTAP: schema, FK, RLS, PM→WO extension |
| PM engine function | Modified | Extend WO generation with labor + safety + checklists |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Extended PM→WO function fails mid-flight | Low | Already wraps in single function; test with pgTAP rollback |
| Existing checklist_templates.job_plan_id semantics break | Low | New FK is nullable + independent — backward compatible |
| asset_type_id FK fails on existing rows | Low | FK is nullable; existing plans get NULL (generic) |

## Rollback Plan

Revert the schema migration; DROP new tables, DROP new columns; restore original `generate_due_preventive_work_orders()` from git. No data loss if rolled back within 24h (new tables empty).

## Dependencies

- PTW/LOTO module (safety-permits) must be applied
- Preventive core schema (job_plans, job_plan_tasks, job_plan_materials) must exist
- Checklist-evidence schema must exist (checklist_templates, checklist_instances)

## Success Criteria

- [ ] `job_plan_labor` stores trade + headcount + hours, FK to job_plans
- [ ] `job_plan_safety` stores permits/LOTO/PPE, FK to job_plans
- [ ] `job_plans.asset_type_id` filters plan applicability
- [ ] `checklist_templates.job_plan_task_id` links to task (nullable, backward compat)
- [ ] PM→WO generation clones labor + safety + checklists into new WO
- [ ] All pgTAP tests pass, RLS per role enforced
