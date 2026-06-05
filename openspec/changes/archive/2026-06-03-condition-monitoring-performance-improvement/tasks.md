# Tasks: Performance, Continuous Improvement & Model Governance (SDD 6)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Total estimated changed lines | ~2000 (5 PRs) |
| 400-line budget risk | High per PR |
| Chained PRs recommended | Yes |
| Suggested split | 5 PRs (capabilities grouped by DRL readiness) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes (each PR is a self-contained slice)
Chain strategy: feature-branch-chain
400-line budget risk: High within each PR

---

## PR 1 — Model Registry + Change Control + Data Readiness (DRL 3-4)

### Phase 1: Migration 00021 — Tables + Seeds

- [x] T-1.1 Create `condition_degradation_models` DDL (model_key UNIQUE, model_type CHECK, validation_status CHECK, min_data_readiness_level 0-6, parameters_schema JSONB, version, indexes)
- [x] T-1.2 Create `condition_model_applicability` DDL (FK to models, UNIQUE model+failure_mode+asset_class, min_samples, min_r_squared)
- [x] T-1.3 Create `condition_change_proposals` DDL (14 entity types, impact_summary JSONB, before/after_state JSONB, lifecycle status, indexes)
- [x] T-1.4 Add RLS policies + Spanish COMMENTs on all 3 tables
- [x] T-1.5 Seed 6 models (linear_extrapolation active/DRL2, piecewise_linear+exponential candidate/DRL4, weibull+gamma+wiener draft/DRL6)
- [x] T-1.6 Verify all 3 tables, 6 seeds, indexes, RLS on remote

### Phase 2: Migration 00022 — Functions + Views

- [x] T-2.1 Create `assess_data_readiness(p_asset_id TEXT DEFAULT NULL)` — RETURNS TABLE with evidence breakdown (sample_count, time_span_days, g0g1_ratio, has_baseline, has_events, has_feedback, has_confirmed_outcomes, missing_features). DRL 0-6 progressive logic.
- [x] T-2.2 Create `condition_data_readiness` VIEW — SELECT * FROM assess_data_readiness() for bulk queries
- [x] T-2.3 Create `compare_change_proposal(p_proposal_id UUID)` — returns JSONB diff with changed_keys, before/after, total counts, and summary
- [x] T-2.4 Create `rollback_change(p_proposal_id UUID)` — returns UUID (new proposal id). Captures current state, creates new rollback proposal, marks original as rolled_back, logs to audit_log. Dynamic SQL maps entity_type→table.

### Phase 3: Migration 00023 — Triggers

- [x] T-3.1 Create `trg_model_status_audit` — BEFORE UPDATE OF validation_status: validates transitions (draft→candidate/superseded, candidate→field_trial/rejected/superseded, field_trial→active/rejected/superseded, active→deprecated/superseded, deprecated→superseded, rejected→draft), DRL hard gate for active promotion, logs to audit_log
- [x] T-3.2 Create `trg_change_proposal_audit` — BEFORE UPDATE OF status: validates transitions (draft→review/rejected, review→approved/rejected, approved→active, active→rolled_back, rejected→draft), logs to audit_log
- [x] T-3.3 Verify triggers work end-to-end — valid transitions accepted, invalid transitions raise P0001, audit entries created

### Phase 4: pgTAP Tests (~31 assertions)

- [x] T-4.1 Schema tests: 3 tables, UNIQUE constraints, CHECK constraints, indexes (10)
- [x] T-4.2 Seed tests: 6 models with correct statuses and DRL (6)
- [x] T-4.3 Function tests: assess_data_readiness, compare_change_proposal, rollback_change (6)
- [x] T-4.4 Trigger tests: valid transitions, invalid rejects, trigger existence (6)
- [x] T-4.5 RLS tests: anon INSERT blocked, authenticated SELECT allowed (3)

---

## PR 2 — Outcomes + Performance Metrics + FP/FN Review (DRL 2)

### Phase 1: Migration 00024 — condition_outcomes table

- [x] T-5.1 Create `condition_outcomes` DDL (FK to diagnoses + work_orders, confirmed_status CHECK, evidence_quality, indexes)
- [x] T-5.2 Add RLS (SELECT authenticated, INSERT via SECURITY DEFINER, ADMIN UPDATE)
- [x] T-5.3 Create `record_condition_outcome()` SECURITY DEFINER function

### Phase 2: Migration 00025 — Performance Functions + Views

- [x] T-6.1 Create `compute_performance_metrics()` — confirmed_rate, rejection_rate, feedback_coverage, per-FM, per-rule, per-source
- [x] T-6.2 Create `compute_false_positives()` — diagnoses with rejected feedback/outcome
- [x] T-6.3 Create `condition_missed_detections` VIEW — CM WOs without prior diagnosis (30/60/90d window)
- [x] T-6.4 Create `condition_noisy_rules` VIEW — rules with FP rate > 50% or confirmed < 10%
- [x] T-6.5 Create `condition_performance_by_fm`, `by_rule`, `by_source` VIEWs
- [x] T-6.6 ALTER condition_daily_metrics +3 outcome columns; extend compute_daily_metrics()
- [x] T-6.7 Verify all functions and views on remote

### Phase 3: pgTAP Tests (~40 assertions)

- [ ] T-7.1 Schema + RLS tests for condition_outcomes (20) — exists from PR 2a
- [x] T-7.2 Function + view tests for performance metrics (20)

---

## PR 3 — Recommendation Effectiveness (DRL 1-2)

### Phase 1: Views (no new tables)

- [x] T-8.1 Create `condition_rec_effectiveness` VIEW — approved/dismissed/converted/useful/not_useful rates
- [x] T-8.2 Create `condition_rec_by_priority` VIEW — breakdown by priority level
- [x] T-8.3 Create `condition_rec_by_policy` VIEW — effectiveness per HITL policy used
- [x] T-8.4 Verify all views return correct structure with 0s (not errors) for empty data

### Phase 2: pgTAP Tests (~15 assertions)

- [x] T-9.1 View schema tests (5)
- [x] T-9.2 Behavioral tests with empty data (5)
- [x] T-9.3 Behavioral tests with seed data (5)

---

## PR 4 — RUL Calibration (DRL 1)

### Phase 1: Migration 00027 — condition_prediction_snapshots table

- [x] T-10.1 Create `condition_prediction_snapshots` DDL (19 columns, FKs to diagnoses + models + outcomes, indexes, prediction_type CHECK)
- [x] T-10.2 Add RLS (SELECT authenticated, INSERT by function only, ADMIN UPDATE actual_outcome_id)
- [x] T-10.3 Verify table on remote

### Phase 2: Migration 00028 — Functions

- [x] T-11.1 Create `compute_rul_calibration(p_asset_id TEXT DEFAULT NULL)` — bias, MAPE, under/overestimate rates, confidence calibration
- [x] T-11.2 Create `link_rul_outcomes(p_snapshot_id UUID DEFAULT NULL)` — links snapshots to confirmed outcomes
- [x] T-11.3 Create `condition_prediction_calibration` VIEW
- [x] T-11.4 Modify `compute_rul_linear()` — INSERT snapshot row on successful RUL computation (CREATE OR REPLACE)

### Phase 3: pgTAP Tests (~24 assertions)

- [x] T-12.1 Schema tests for snapshots (8)
- [x] T-12.2 Function tests: calibration, linking, linear modification (10)
- [x] T-12.3 RLS behavioral tests (3)
- [x] T-12.4 View tests (3)

---

## PR 5 — Improvement Proposal Engine (DRL 1, Capstone)

### Phase 1: Migration 00028c — condition_improvement_proposals table

- [x] T-13.1 Create `condition_improvement_proposals` DDL (proposal_key UNIQUE, proposal_type CHECK, lifecycle status, FK to change_proposals, indexes)
- [x] T-13.2 Add RLS (SELECT authenticated, INSERT via SECURITY DEFINER, PLANNER approve/reject, ADMIN implement/supersede)

### Phase 2: Migration 00029 — Functions

- [x] T-14.1 Create `generate_improvement_proposals()` — scans 5 sources (noisy rules, low performance, RUL bias, low quality, DRL increase), dedup, creates draft proposals
- [x] T-14.2 Create `assess_improvement_opportunities(p_asset_id TEXT DEFAULT NULL)` — preview mode, STABLE, returns TABLE without writing

### Phase 3: pgTAP Tests (~16 assertions)

- [x] T-15.1 Schema tests: table, columns, CHECK, UNIQUE, indexes (6)
- [x] T-15.2 Function tests: generate + preview (4)
- [x] T-15.3 RLS + no-auto-advance tests (4)
- [x] T-15.4 Dedup + edge case tests (2)

---

## Summary

| PR | Focus | DRL | Migrations | Objects | Tests |
|----|-------|:---:|:----------:|:-------:|:-----:|
| 1 | Model Registry + Change Control | 3-4 | 3 (00021-00023) | 3 tables, 3 fn, 1 view, 2 trg | ~55 |
| 2 | Outcomes + Metrics + FP/FN | 2 | 2 (00024-00025) | 1 table, 3 fn, 6 views | ~40 |
| 3 | Recommendation Effectiveness | 1-2 | 0 (views only) | 3 views | ~15 |
| 4 | RUL Calibration | 1 | 2 (00027-00028) | 1 table, 2 fn+1 mod, 1 view | ~24 |
| 5 | Improvement Proposal Engine | 1 | 2 (00028c-00029) | 1 table, 2 fn | ~16 |
| **Total** | **5 PRs** | **1-4** | **9 migrations** | **6 tables, 13 fn, 11 views, 2 trg** | **~150** |
