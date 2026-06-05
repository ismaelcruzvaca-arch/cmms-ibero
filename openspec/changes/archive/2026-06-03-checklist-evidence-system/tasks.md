# Tasks: Checklist Evidence System

> 🟢 **IMPLEMENTED AND DEPLOYED.** Migration `20260529000001_checklist_evidence.sql` (758 lines) covers all tasks below.
> All tasks are marked [x] — this is a retrospective artifact.

---

## Phase 1: Database — Migration

### [x] 1.1 Migration Sections 1-4 — 6 new tables + seed data

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Acceptance**:
  - `causa_falla_catalog` table exists with 6 seed rows (BRECHA_CONOCIMIENTO, FALTA_HERRAMIENTA, DESVIACION_DISCIPLINARIA, FALTA_REPUESTO, ERROR_DOCUMENTACION, NO_APLICA)
  - `checklist_templates` table with FKs to `technological_modules`, `job_plans`; block_type CHECK ('A','B','C'); sampling_rate (0-100); unique partial indexes for module-wide and job_plan-specific
  - `checklist_template_items` with FK CASCADE, item_type CHECK ('PASS_FAIL','MEASUREMENT','YES_NO','TEXT'), UNIQUE(template_id, step_sequence)
  - `checklist_instances` with FKs to work_orders, user_profiles, checklist_templates, assets; evaluator_source CHECK ('SELF','SUPERVISOR','PEER'); status CHECK ('IN_PROGRESS','COMPLETED','VOID')
  - `checklist_item_responses` with FK CASCADE, status CHECK ('PASS','FAIL','NA','SKIPPED'), optional causa_falla_id
  - `checklist_sampling_config` with FKs, block_type CHECK, default_sampling_rate (0-100), UNIQUE(module_id, job_plan_id, block_type)
  - All tables have COMMENT ON (Spanish)
  - Seed uses `ON CONFLICT (code) DO NOTHING` for idempotency

### [x] 1.2 Migration Sections 5-6 — ALTER existing tables

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Acceptance**:
  - `technician_skill_evidence`: +3 nullable columns — `evaluation_source TEXT CHECK`, `causa_falla_id UUID FK`, `trust_score NUMERIC CHECK (0-1)` DEFAULT 1.0
  - `work_orders`: +2 columns — `is_auditable BOOLEAN DEFAULT false`, `audit_reason TEXT`
  - Both use `ADD COLUMN IF NOT EXISTS` for idempotency

### [x] 1.3 Migration Section 7 — trg_checklist_to_evidence

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Acceptance**:
  - SECURITY DEFINER function, AFTER UPDATE ON checklist_instances WHEN (NEW.status = 'COMPLETED')
  - Iterates item responses, aggregates: if ANY FAIL (non-NO_APLICA) → status=false
  - NO_APLICA override: FAIL + NO_APLICA → treated as PASS (does not set v_any_fail)
  - Inserts ONE aggregated row per instance (not per item)
  - Block→nivel: A→2, B→3, C→4
  - trust_score: SELF=0.5, PEER=0.8, SUPERVISOR=1.0

### [x] 1.4 Migration Section 8 — Replace trg_recalculate_technician_level

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Acceptance**:
  - Level 3: `COUNT(*)` replaced with `SUM(COALESCE(trust_score, 1.0))`
  - Excludes PASS with causa_falla IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION)
  - Threshold remains >= 5
  - Legacy NULL trust_score = 1.0 (backward compat)

### [x] 1.5 Migration Sections 9-10 — RLS + audit triggers

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Acceptance**:
  - RLS enabled on all 6 new tables with `get_user_role()` policies per matrix
  - TECHNICIAN restricted to own checklist_instances (`technician_id = auth.uid()`)
  - Audit triggers on `checklist_instances` and `checklist_item_responses` using existing `audit_trigger_func()`

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | 6 tables + seed data | ✅ Implemented |
| 1.2 | ALTER technician_skill_evidence + work_orders | ✅ Implemented |
| 1.3 | trg_checklist_to_evidence trigger | ✅ Implemented |
| 1.4 | Replace trg_recalculate_technician_level | ✅ Implemented |
| 1.5 | RLS + audit triggers | ✅ Implemented |

**Note**: The archived design (2026-05-31) included additional tasks for RxDB collections, a `useChecklists.js` hook, a `trg_validate_checklist_gate` trigger, Focus Mode frontend components (FocusModeModal/Card/Progress/Result), and WorkOrderDrawer modifications. Those tasks are tracked separately under the mechanic work order execution capability. This migration covers only the **database layer** of the checklist evidence system.
