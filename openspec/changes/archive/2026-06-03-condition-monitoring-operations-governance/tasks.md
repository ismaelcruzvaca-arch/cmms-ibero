# Tasks: Operations, Governance & Continuous Improvement (SDD 5)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,700 (PR 1: ~900, PR 2: ~800) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Backend) → PR 2 (Frontend) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base Branch |
|------|------|-----------|-------------|
| 1 | Backend governance (tables, functions, triggers, pgTAP) | PR 1 | feature/sdd5-governance |
| 2 | Frontend operations (hooks, components, Vitest) | PR 2 | PR 1 branch |

## PR 1 — Backend Governance

### Phase 1: Tables DDL (Migration 00018)

- [x] 1.1 `condition_automation_policies` — add policy_version INT, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ, created_by TEXT, approved_by TEXT to design schema
- [x] 1.2 `condition_diagnosis_feedback` — replace was_recommendation_useful BOOLEAN with recommendation_usefulness TEXT CHECK (useful, not_useful, not_executed, superseded); keep feedback_status independent
- [x] 1.3 `condition_audit_log` — table per design; RLS: SELECT for authenticated, INSERT via function only, NO UPDATE/DELETE policies; comment "append-only at application level"
- [x] 1.4 `condition_daily_metrics` — table per design with UNIQUE(metric_date, asset_id)
- [x] 1.5 ALTER `maintenance_recommendations` — +status expired, +reviewed_by, +reviewed_at, +dismissed_reason, +superseded_by FK self, +work_order_id FK work_orders(id) ON DELETE SET NULL, extend status CHECK
- [x] 1.6 Composite indexes: condition_diagnoses(asset_id, diagnosis_status, created_at), condition_analysis_results(asset_id, analysis_type, window_end)
- [x] 1.7 RLS policies: TECHNICIAN INSERT+SELECT feedback; PLANNER full CRUD policies; ADMIN full CRUD; all authenticated SELECT audit_log

### Phase 2: SQL Functions (Migration 00019)

- [ ] 2.1 `evaluate_automation_policy(p_diagnosis_id UUID)` — returns policy metadata; checks min_confidence, min_completeness, repeat_dismissal gate 30d, field_trial → never auto-OT
- [ ] 2.2 `generate_recommendation_v2(p_diagnosis_id UUID)` — reads policies via evaluate_automation_policy; sets status from policy; logs audit entry; v1 deprecated
- [ ] 2.3 `compute_source_quality_stats()` — returns g0/g1/g2/g3 pct, last_data_at, dead_letter_count per source
- [ ] 2.4 `compute_daily_metrics(p_date DATE DEFAULT CURRENT_DATE)` — idempotent upsert, accepts any past date for backfill
- [ ] 2.5 `convert_recommendation_to_wo(p_recommendation_id UUID)` — check no open WO for same diagnosis exists; atomic INSERT WO + UPDATE rec + audit
- [ ] 2.6 `expire_stale_recommendations()` — batch expire suggested/review_required past due_window
- [ ] 2.7 `log_audit_entry(...)` — manual INSERT for ADMIN overrides

### Phase 3: Triggers + Seeds + Cron (Migration 00020)

- [x] 3.1 `trg_maint_rec_audit` — BEFORE UPDATE OF status ON maintenance_recommendations; captures before/after states via log_audit_entry()
- [x] 3.2 `trg_policy_audit` — AFTER INSERT/UPDATE/DELETE ON condition_automation_policies; action=policy_created/updated/deleted
- [x] 3.3 `trg_feedback_audit` — AFTER INSERT ON condition_diagnosis_feedback; action=diagnosis_feedback_submitted
- [x] 3.4 `trg_feedback_summary` — AFTER INSERT OR UPDATE ON condition_diagnosis_feedback → UPDATE condition_diagnoses.feedback_status + feedback_notes
- [x] 3.5 Seed 2 policies: conservative (review required, eval_order=10) + permissive (auto-confirm ≥0.85, eval_order=20)
- [x] 3.6 pg_cron job: `SELECT cron.schedule('compute-daily-metrics', '5 0 * * *', 'SELECT compute_daily_metrics(CURRENT_DATE - INTERVAL \'1 day\')')` wrapped in DO block with extension check

### Phase 4: pgTAP Tests (≥50 assertions)

- [x] 4.1 Schema: policies table (policy_version, valid_from/valid_to, UNIQUE(policy_key,policy_version))
- [x] 4.2 Schema: feedback table (recommendation_usefulness, feedback_status CHECK)
- [x] 4.3 Schema: audit_log (action, entity_type columns)
- [x] 4.4 Schema: daily_metrics (UNIQUE metric_date+asset_id)
- [x] 4.5 ALTER recommendations (reviewed_by, work_order_id, status includes expired)
- [x] 4.6 evaluate_automation_policy (fallback for non-existent, repeat_dismissal_gate, contradictory_count)
- [x] 4.7 generate_recommendation_v2 (returns NULL for non-existent diagnosis)
- [x] 4.8 compute_source_quality_stats (9 output columns)
- [x] 4.9 compute_daily_metrics (idempotent, past-date param, 0 for empty date)
- [x] 4.10 convert_recommendation_to_wo (reject non-approved, reject duplicate WO for same diagnosis)
- [x] 4.11 expire_stale_recommendations (returns 0 when none stale)
- [x] 4.12 Audit triggers (4 triggers exist, feedback_audit + policy_audit + maint_rec_audit + feedback_summary)
- [x] 4.13 Feedback summary trigger (feedback_status updated, feedback_notes populated)
- [x] 4.14 log_audit_entry (manual insert works, returns UUID)
- [x] 4.15 RLS (anon blocked from INSERT policies+audit, authenticated can SELECT, anon can SELECT metrics)
- [x] 4.16 Policy seeds (8 assertions: key, eval_order, requires_approval, is_active, version)

## PR 2 — Frontend Operations

### Phase 1: Hooks

- [ ] 5.1 `useDashboardMetrics()` — parallel queries: critical assets, diagnoses by FM, top 5 RUL, pending recs, quality stats RPC, stale sources, dead-letter counts; separate asset vs source errors
- [x] 5.2 `useRecommendationList({ status, priority })` — filtered query with JOINs diagnosis+FM; approve/dismiss/supersede/convert actions
- [x] 5.3 `useDiagnosisFeedback({ diagnosisId })` — INSERT feedback, fetch existing feedback, submit with validation

### Phase 2: Components

- [ ] 6.1 `Dashboard.jsx` — 7 MUI tiles: asset count (navigable), FM breakdown, RUL top 5 (red <7d), pending recs, quality %, stale sources, dead-letter; distinguish "asset failing" vs "source degraded"
- [x] 6.2 `RecommendationList.jsx` — filterable table (status, priority), approve/dismiss/supersede/convert actions gated by role
- [x] 6.3 `FeedbackForm.jsx` — expandable in DiagnosisPanel; fields: feedback_status, recommendation_usefulness, actual_failure_mode/component/cause, technician_observation
- [x] 6.4 `PolicyManagementPanel.jsx` — CRUD table + PolicyEditor dialog for conditions JSONB; PLANNER/ADMIN gated

### Phase 3: Modifications

- [ ] 7.1 `App.jsx` — Dashboard as sub-tab 0; shift indices; drill-down navigation from tiles
- [ ] 7.2 `SourceManagementPanel.jsx` — add quality badge (dominant G0-G3 %), stale icon, dead-letter badge
- [ ] 7.3 `DiagnosisPanel.jsx` — embed FeedbackForm in expandable row for active/confirmed diagnoses; "Generar OT" calls v2
- [ ] 7.4 `RecommendationCard.jsx` — deprecate with comment; keep for backward compat

### Phase 4: Vitest Tests (≥12)

- [ ] 8.1 Dashboard renders 7 tiles; loading state; click navigates
- [ ] 8.2 Dashboard separates asset vs source degraded tiles
- [ ] 8.3 RecommendationList filters by status; empty state; approve visible for PLANNER, hidden for TECHNICIAN
- [ ] 8.4 RecommendationList dismiss requires reason; convert blocked if status ≠ approved
- [ ] 8.5 FeedbackForm validation blocks without feedback_status; submit succeeds
- [ ] 8.6 PolicyManagementPanel lists, creates, edits policies
- [ ] 8.7 SourceManagementPanel shows quality badge and stale indicator
- [ ] 8.8 Dashboard performance <2s with mock data

## Test Scenarios (sdd-verify must cover all 10)

| # | Scenario | Phase to Verify |
|---|----------|-----------------|
| 1 | HITL policy blocks auto-OT if confidence low | pgTAP 4.6 |
| 2 | HITL policy blocks auto-OT if evidence_completeness low | pgTAP 4.6 |
| 3 | field_trial never auto-OT | pgTAP 4.6 |
| 4 | recommendation approved → can convert to WO | pgTAP 4.10 |
| 5 | recommendation dismissed → cannot convert to WO | pgTAP 4.10 |
| 6 | recommendation superseded → closed | pgTAP 4.5 |
| 7 | feedback confirmed → updates diagnosis summary columns | pgTAP 4.13 |
| 8 | feedback rejected → does NOT delete diagnosis, just marks it | pgTAP 4.13 |
| 9 | audit log creates entry on approve/dismiss/policy change | pgTAP 4.12 |
| 10 | daily metrics can recalculate a specific past date | pgTAP 4.9 |
