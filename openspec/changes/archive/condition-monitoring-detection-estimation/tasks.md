# Tasks: Detection, Adaptive Baselines, Residuals & State Estimation (SDD 3)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950 (600 backend + 350 frontend) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Backend ~600 LOC) → PR 2 (Frontend ~350 LOC) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend — migrations, functions, rules, HI, pgTAP | PR 1 | Base main; ~600 LOC — if >400, chain into 2 slices |
| 2 | Frontend — TrendChart, hook, subtab, vitest | PR 2 | Base main; ~350 LOC, standalone |

## Phase 1: Foundation — Migration 1

- [x] **T-1.1** Create `20260602100012_condition_baselines.sql` — `condition_baselines` table with: all columns, CHECK constraints (baseline_status lifecycle, regime, rpm_band, load_band, quality_filter), UNIQUE(asset_id+feature+method+mp+regime+rpm+load+version), unique partial index for active-only per context, RLS (SELECT=authenticated, INSERT/UPDATE/DELETE=PLANNER/ADMIN), auto `updated_at` trigger
- [x] **T-1.2** Create `20260602100013_condition_bootstrap_seed.sql` — 3 draft baselines (BANDA-TR-01 FULL_LOAD mean=2.3/std=0.4, BANDA-TR-01 PARTIAL_LOAD mean=1.8/std=0.3, TOS-MOT-01 FULL_LOAD mean=1.4/std=0.3) + 40 condition_windows across both assets + feature_values covering normal, degradation, step change, G2/G3, mixed quality patterns

## Phase 2: Compute Functions — Migration 2

- [x] **T-2.1** Create `20260602100014_condition_detection_functions.sql` — `is_baseline_learnable(p_asset_id)`: gates for active events, significant trend (R²>0.5), sustained residual (last 5 z>2), G2/G3 flood (>10 in 7d)
- [x] **T-2.2** `compute_baselines()` — rolling stats per (asset+feature+method+regime+rpm+load): AVG/STDDEV/PERCENTILE_CONT, EWMA update for existing active baselines (α=0.1), insert new draft baselines with next version; regime-aware grouping; learning policy gates
- [x] **T-2.3** `compute_baseline_residual()` — type A residual (value−mean), z-score with stddev=0 guard (min 0.01), regime fallback via normalized euclidean distance, stores in `condition_analysis_results` with deviation_level + baseline_version + approximate flag
- [x] **T-2.4** `compute_kalman_1d()` — scalar Kalman: predict (x,P), innovation/gain/update, Q/R from method defaults or params, stores state_variance/innovation/innovation_variance/kalman_gain in dedicated columns, init from baseline mean or first measurement
- [x] **T-2.5** `compute_feature_trend()` — linear regression via regr_slope/intercept/r2, gates: <5 samples skip, regime mix >1 skip, G2/G3 >50% skip, regime_consistency <80% skip; R²<0.3 → confidence=0.0
- [x] **T-2.6** ALTER `condition_analysis_results` — ADD 4 Kalman columns (state_variance, innovation, innovation_variance, kalman_gain); ALTER `condition_rules` evaluation_type CHECK to add 'z_score_threshold','innovation_threshold','trend_significance','compound_anomaly'
- [x] **T-2.7** Bootstrap seed rules: 3 INSERTs (RMS Z>3 Sostenido, RMS Innovación Alta, RMS Tendencia Significativa)

## Phase 3: Rules Extension & Adaptive HI

- [x] **T-3.1** Extend `evaluate_condition_rules()` — implement evaluation_type='residual' (z-score ≥ min_z_score for duration_windows), 'innovation_threshold' (|innovation| > threshold × √variance for N consecutive), 'trend' (per-feature with min_r2 + condition), 'z_score_threshold', 'trend_significance', 'compound_anomaly'; event message with explainability JSONB (REQ-DEXP-001), `condition_event_sources.contribution_type` column
- [x] **T-3.2** Extend `compute_health_index()` — parameter `zone_source` ('iso'|'adaptive'); adaptive zones = mean+1σ/2σ/3σ from active baseline (sample_count≥30); `get_applicable_thresholds()` function with precedence: baseline ≥30 samples → baseline thresholds, else ISO fallback; metadata with threshold_source/baseline_version

## Phase 4: Frontend — TrendChart & Subtab

- [x] 4.1 `npm install recharts` in package.json
- [x] 4.2 Create `src/components/condition/charts/TrendChart.jsx` — recharts ComposedChart with: HI line (blue), baseline bands (±1σ yellow, ±2σ red), feature scatter (quality-colored dots), event markers (red triangles), 7d/30d/90d date selector, custom regime/quality tooltip, empty states for no-baseline / no-data
- [x] 4.3 Create `src/hooks/useFeatureTrends.js` — Supabase REST queries: condition_analysis_results (health_index), condition_feature_values JOIN windows, condition_baselines active, condition_events; returns { hiData, featureData, baseline, events, isLoading, error }
- [x] 4.4 Modify `src/App.jsx` — add "Tendencias" tab after Dead-Letter tab, render TrendChart with asset selection, updated computed index logic

## Phase 5: Testing

- [x] **T-5.1** Create `supabase/tests/database/condition_baselines_detection_test.sql` — pgTAP ~60 assertions: schema (10), bootstrap seed (6), is_baseline_learnable (6), compute_baselines stats + EWMA (8), compute_baseline_residual z-score + outlier (6), compute_kalman_1d convergence + drift (6), compute_feature_trend gates + R² confidence (6), evaluate_condition_rules residual (4), compute_health_index adaptive (4), get_applicable_thresholds (4), seed rules (3), CHECK extension (2), type checks (2)
- [x] 5.2 Create `src/components/condition/__tests__/TrendChart.test.jsx` — 12 tests covering loading, error, empty states, feature mode, HI mode, date selector, event markers, chart container
- [x] 5.3 Create `src/hooks/__tests__/useFeatureTrends.test.js` — 6 tests covering shape, data loading, HI mode, featureKey filter, error handling, empty assetId

## Spec Coverage

| Spec | Status | Tasks |
|------|--------|-------|
| condition-baseline-management | T-1.1, T-1.2 | 1.1, 1.2 |
| condition-baseline-learning-policy | T-1.3 (gates) | 2.1, 2.2 |
| condition-regime-aware-baselines | T-1.3 (regime) | 2.2, 2.3 |
| condition-trend-regression | T-1.6 | 2.5 |
| condition-residual-analysis | T-1.4 | 2.3 |
| condition-state-estimation | T-1.5 | 2.4 |
| condition-anomaly-detection-rules | T-1.7 | 3.1 |
| condition-detection-explainability | T-1.7 (message) | 3.1 |
| condition-analysis-results (delta) | T-1.4, T-1.5 | 2.3, 2.4, 2.6 |
| condition-rules (delta) | T-1.7 | 2.6, 3.1 |
| condition-health-index (delta) | T-1.8 | 3.2 |
| condition-thresholds (delta) | T-1.8 (precedence) | 3.2 |

## Implementation Order

1. **Migration 1** (base table + seed data) — no dependencies, must come first
2. **Migration 2** (compute functions + ALTERs + seed rules) — depends on condition_baselines table
3. **Rules & Adaptive HI** — depends on compute functions existing
4. **pgTAP tests** — after all backend changes
5. **Frontend** — independent of backend order (can be parallel after npm install)

## Risk Notes

- PR 1 at ~600 LOC exceeds 400-line budget. If >400 after assembly, split: slice A = migration 1 + is_baseline_learnable + compute_baselines + compute_baseline_residual (~350 LOC); slice B = compute_kalman_1d + compute_feature_trend + rules extension + adaptive HI + pgTAP (~250 LOC). Both stack to main.
- `condition_event_sources.contribution_type` column — add via ALTER TABLE, verify no existing view breaks.
- Frontend is standalone ~350 LOC, fits single PR.
