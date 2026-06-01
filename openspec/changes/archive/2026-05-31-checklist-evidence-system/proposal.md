# Proposal: Checklist Evidence System

## Intent

Solve 3 blind spots in the existing Competency Engine: **(1)** BOOLEAN PASS/FAIL cannot capture *why* a task fails, **(2)** no evaluator source means all evidence weighs equally, **(3)** no sampling causes click fatigue. This phase builds the structured checklist system that feeds qualified evidence into the engine.

## Scope

### In Scope
- **Schema**: `causa_falla_catalog`, `checklist_templates`, `checklist_template_items`, `checklist_instances`, `checklist_item_responses`, `checklist_sampling_config` — 6 new tables + ALTERs to `technician_skill_evidence` (causa_falla_id, evaluation_source, trust_score) + ALTER to `work_orders` (is_auditable)
- **Triggers**: `trg_checklist_to_evidence` (new), modify `trg_recalculate_technician_level` (trust_score SUM, causa_falla filtering)
- **Frontend**: Focus Mode modal (full-screen, one-question-at-a-time), sampling logic, block visibility gate, adapter + RxDB collections + hooks
- **WO Lifecycle Gate**: Block A = HARD always. Blocks B/C = SOFT 60d → HARD permanent

### Out of Scope
- Planner template editor UI (future phase)
- Supervisor spot-check dashboard (future phase)
- Analytics/training gap reports

## Capabilities

### New Capabilities
- `checklist-evidence`: structured checklist templates (by module + optional job_plan override), runtime instances, item responses, sampling engine, causa_falla catalog, Focus Mode UX

### Modified Capabilities
- `competency-evidence`: add `causa_falla_id`, `evaluation_source`, `trust_score` to `technician_skill_evidence`
- `competency-engine`: modify `trg_recalculate_technician_level` to SUM(trust_score) for level 3, filter FAILs by causa_falla, maintain backward compat
- `mechanic-work-order-execution`: add Focus Mode modal for close-out, checklist gating on INPRG→COMP

## Approach

Templates by technological module (A2) + optional override per job_plan. Deterministic hash sampling (wo.id + template.id) % rate. Causa_falla catalog with 6 fixed values. Trust model: SELF=0.5, PEER=0.8, SUPERVISOR=1.0. Trigger-only feeding to evidence table — frontend never writes technician_skill_evidence directly.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/2026NNNN_checklist_evidence.sql` | New | 6 tables, ALTERs, 2 triggers, RLS, audit, COMMENT ON |
| `supabase/tests/database/checklist_evidence_test.sql` | New | pgTAP: schema, triggers, sampling, RLS, gates |
| `src/lib/rxdb.js` | Modified | Add 6 collections, pull/push handlers |
| `src/hooks/useChecklists.js` | New | getTemplatesForWO, submitChecklist, getVisibleBlocks |
| `src/components/mechanic/FocusModeModal.jsx` | New | Full-screen modal, one question at a time, large cards |
| `src/components/mechanic/FocusModeItem.jsx` | New | Single PASS/FAIL + causa_falla card |
| `src/components/mechanic/FocusModeResult.jsx` | New | Summary after completing checklist |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modified | "Begin Close-Out" button opens Focus Mode |
| `src/components/mechanic/WorkOrderActions.jsx` | Modified | INPRG→COMP gate checks checklist status |
| `src/lib/adapters/checklistAdapter.js` | New | RxDB doc → ViewModel mapper |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Trigger regression in level calc | Med | pgTAP backward-compat tests for legacy records |
| Sampling hash confusion | Low | Document deterministic behavior |
| Offline conflict on checklist submit | Low | RxDB conflict resolution handles it |
| NO_APLICA loophole | Med | Neutro for competency, audit NO_APLICA rate |

## Rollback Plan

Revert migration, restore trigger from backup, remove RxDB collections. Data loss minimal if rolled back within 24h (no critical production data).

## Dependencies

- Competency Engine migrations applied (Phase 1)
- `work_orders` table with lifecycle_phase FSM

## Success Criteria

- [ ] Mechanic can complete checklists in Focus Mode and submit
- [ ] Block A gating works: INPRG→COMP blocked if checklist not ALL PASS
- [ ] Sampling picks different WOs per hash, deterministic
- [ ] Trigger feeds technician_skill_evidence correctly with trust_score and causa_falla
- [ ] NO_APLICA/FALTA_HERRAMIENTA/FALTA_REPUESTO/ERROR_DOCUMENTACION do NOT count against level
- [ ] All pgTAP tests pass
