# Proposal: Performance, Continuous Improvement & Model Governance (SDD 6)

## Intent

SDD 6 closes the operational MBC (Monitor → Diagnose → Prognose → decide → Act → Verify) cycle. SDD 1-5 build detection, estimation, diagnosis, recommendation, and governance — but the loop stays open because **we never measure if predictions were right**. This change creates the infrastructure to measure performance, audit outcomes, compare predictions vs reality, detect noisy rules, and propose controlled improvements. No auto-tuning; the system proposes, humans decide.

> **Frase guía**: "Medir, auditar, comparar y proponer mejoras controladas. No más algoritmos."

## Architecture Decisions

| # | Option | Decision |
|---|--------|----------|
| 1 | Outcome tracking: separate table vs extending `condition_diagnosis_feedback` | **Separate `condition_outcomes` table.** SDD 5 feedback is "technician says during WO closure"; SDD 6 outcome is "operational truth post-WO" with confirmed failure mode, component, and status. Different lifecycle, different data, different consumers. |
| 2 | Prediction snapshots: new table vs JSONB params in analysis_results | **New `condition_prediction_snapshots`** for RUL calibration. Dedicated schema (rul_low/mid/high, confidence, method_key, method_version, actual_outcome_id) avoids polluting `condition_analysis_results` with runtime metadata. |
| 3 | Change proposals: new table vs in-place versioning | **New `condition_change_proposals`** with lifecycle (draft→review→approved→active→rolled_back). In-place versioning loses audit trail of WHY a change happened and WHO approved it. |
| 4 | DRL enforcement: hard check vs convention | **Documented convention** (spec-level). Hard gates would block all development before data exists. Each spec declares `min_drl: N`; runtime enforcement deferred until DRL 4+ data is available. |
| 5 | Metrics computation: pg_cron vs on-demand | **Same as SDD 5**: pg_cron daily + manual backfill function. `compute_performance_metrics()` scheduled at 00:10. On-demand for ad-hoc analysis. |

## Scope

### In Scope (8 capabilities)

| # | Capability | DRL | Schema change? |
|---|------------|-----|----------------|
| 1 | **condition-outcome-tracking** — Formal operational truth: actual_failure_mode, actual_component, confirmed_status, failure_date, technician_notes, reviewed_by | 2 | `condition_outcomes` table (new) |
| 2 | **diagnostic-performance-metrics** — confirmed_rate, rejection_rate, feedback_coverage, performance by FM/rule/source | 2 | `condition_performance_metrics` table (new), `compute_performance_metrics()` function |
| 3 | **false-positive-false-negative-review** — Detect noisy rules, useless events, missed detections (corrective WO without prior diagnosis in 30/60/90d window) | 1-2 | Views + function on existing tables |
| 4 | **recommendation-effectiveness** — Approved, dismissed, converted_to_wo, useful, not_useful, repeated, ignored | 1 | Views + metrics on `maintenance_recommendations` |
| 5 | **rul-calibration** — Compare prediction vs actual: bias, underestimate_rate, overestimate_rate, confidence calibration | 1 | `condition_prediction_snapshots` table (new) |
| 6 | **model-registry-governance** — `condition_degradation_models` with lifecycle draft→candidate→field_trial→active→deprecated. Models: linear, piecewise_linear, exponential. Weibull/Gamma/Wiener as candidates only. Each model declares min DRL. | 3-4 | `condition_degradation_models` table (new) |
| 7 | **change-control-workflow** — `condition_change_proposals` for thresholds, rules, baselines, HITL policies, RUL methods. Lifecycle with diff, justification, approval, rollback, version. | 3 | `condition_change_proposals` table (new) |
| 8 | **improvement-proposal-engine** — System generates data-driven proposals ("80% FP → review threshold"; "RUL underestimates 70% → adjust uncertainty"). Lifecycle: draft→review→approved→active. | 1 | `condition_improvement_proposals` table (new) |

### Out of Scope

| Item | Reason |
|------|--------|
| ML model training/retraining | No ML in roadmap. Models = deterministic degradation curves. |
| Auto-tuning without human review | Guiding principle: system proposes, humans decide. |
| Weibull/Gamma/Wiener as productive models | Declared as candidates only. Need DRL 6+ to go active. |
| Real-time performance dashboards | SDD 6 builds data. UI for performance analytics deferred to SDD 7. |

## Approach

5 PRs per exploration findings, ordered by DRL readiness:

| PR | Capabilities | DRL | Risk |
|----|-------------|-----|------|
| **PR 1** (Model Registry + Change Control) | 6, 7 | 3-4 | Low — schema exists, builds on SDD 4-5 validation lifecycle |
| **PR 2** (Outcome Tracking + Performance Metrics) | 1, 2 | 2 | Low-Med — schema + compute functions |
| **PR 3** (FP/FN Review + Recommendation Effectiveness) | 3, 4 | 1-2 | Med — needs corrective WO data + diagnosis window logic |
| **PR 4** (RUL Calibration) | 5 | 1 | Med-High — most data-dependent; may produce 0 meaningful comparisons for months |
| **PR 5** (Improvement Proposal Engine) | 8 | 1 | Med — capstone that consumes all other capabilities' metrics |

Each PR includes: migration + pgTAP tests (≥20 assertions) + seed data (where applicable).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | +5 migrations | One per PR, incremental |
| `supabase/tests/database/` | +5 test files | pgTAP for each new table/function |
| `src/hooks/` | +3 hooks | `useOutcomeTracking`, `usePerformanceMetrics`, `useChangeProposals` |
| `src/components/condition/` | +2 panels | OutcomesPanel, ProposalsPanel (read-only dashboards deferred) |
| `condition_daily_metrics` (SDD 5) | Extended | New metric columns for outcome counts |
| `condition_audit_log` (SDD 5) | Extended | New action types: `change_proposed`, `change_approved`, `model_promoted` |
| `condition_baselines` (SDD 3) | Impacted | Change proposals can update baselines via controlled workflow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Metrics on empty data show 0s, not errors | High | Spec: all metrics functions return 0/NULL with zero rows, no errors. UI shows "no data" not "0% confirmed". |
| RUL calibration meaningless for months | High | PR 4 designed as data infrastructure only. Banner: "Requires N confirmed outcomes for calibration." |
| Change control adds friction to ops | Medium | Proposals are OPTIONAL for most changes in v1. Mandatory only for thresholds, baselines, and model promotions. |
| PR 3 FN detection produces false positives | Medium | 30/60/90d windows are configurable. FN flag is advisory, not automatic. |
| Model lifecycle overlap with SDD 5 validation_status | Medium | Harmonized in PR 1: `validation_status` governs ALL condition entities; `condition_degradation_models` adds model-specific lifecycle on top. |

## Rollback Plan

Per-PR rollback:
1. Revert migration (DROP TABLE/COLUMN/VIEW in reverse order)
2. Remove corresponding hook/component (if applied before UI deferred)
3. Re-seed SDD 5 automation policies if change_proposals modified them
4. No data loss for SDD 1-5 tables — all SDD 6 tables are additive

## Dependencies

- **SDD 5** `condition_daily_metrics`, `condition_diagnosis_feedback`, `maintenance_recommendations` — all must exist and have >0 rows
- **SDD 4** `condition_rules`, `condition_thresholds`, `condition_analysis_results` — rule + threshold IDs used in change proposals
- **SDD 3** `condition_baselines` — baseline versioning used by change control
- **pg_cron** extension — already installed (SDD 5 dependency)

## DRL Reference

| Level | Description | Used by |
|-------|-------------|---------|
| DRL 0 | Sin datos reales | — |
| DRL 1 | Datos mock/sintéticos | PR 3, 4, 5 |
| DRL 2 | Datos reales sin eventos confirmados | PR 2 |
| DRL 3 | Datos reales con baseline estable | PR 1 |
| DRL 4 | Datos reales con eventos y feedback técnico | Post-SDD 6 |
| DRL 5 | Datos reales con fallas confirmadas | Post-SDD 6 |
| DRL 6 | Datos suficientes para modelo estadístico validado | Weibull/Gamma/Wiener |

Each degradation model in `condition_degradation_models` declares `min_drl: INT`. Models are not promotable to `active` unless DRL >= min_drl (convention-enforced at spec level, not hard gate).

## Success Criteria

- [ ] `condition_outcomes` table stores operational truth with FK to work_orders
- [ ] `compute_performance_metrics()` runs daily via pg_cron without errors on empty data
- [ ] FP/FN review detects corrective WOs without prior diagnosis in configurable window
- [ ] `condition_prediction_snapshots` stores RUL predictions linked to actual outcomes
- [ ] `condition_degradation_models` seeded with linear/piecewise_linear/exponential; Weibull/Gamma/Wiener as candidates
- [ ] `condition_change_proposals` supports lifecycle with diff and rollback
- [ ] `condition_improvement_proposals` generates at least 1 non-trivial proposal type (noisy rule detection)
- [ ] pgTAP ≥100 assertions across all 5 PRs
- [ ] No regression in SDD 1-5 specs or existing pgTAP tests
