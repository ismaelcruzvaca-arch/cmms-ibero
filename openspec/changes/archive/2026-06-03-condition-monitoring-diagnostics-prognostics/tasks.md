# Tasks: Diagnostics, Degradation Models & Prognostics (SDD 4)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1100 (700 backend + 400 frontend) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Backend) → PR 2 (Frontend) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend: diagnostic catalogs + functions | PR 1 | ~700 LOC, stacked to main. 2 migrations, 4 SQL functions, ALTERs, seeds, pgTAP |
| 2 | Frontend: diagnosis UI components | PR 2 | ~400 LOC, stacked to main (depends on PR 1 schema). DiagnosisPanel, RulGauge, RecommendationCard, subtab |

## PR 1 — Backend (~700 LOC)

### Phase 1: Diagnostic Catalogs (Migration 1)

- [x] T-1.1 `condition_failure_mode_catalog` DDL + 12 seeds (pump.cavitation, pump.suction_restriction, rotating.misalignment, rotating.unbalance, bearing.outer_race_defect, bearing.inner_race_defect, impeller.damage, seal.leakage, electrical.stator_fault, sensor.stuck_signal, sensor.dropout, sensor.drift)
- [x] T-1.2 `fmea_cbm_cross_reference` DDL + 3 seeds linking CBM modes to existing FMEA modes (pump.cavition→FMEA-CAV-001, rotating.misalignment→FMEA-MAL-002, bearing.outer_race_defect→FMEA-BRG-003)
- [x] T-1.3 `diagnostic_evidence_matrix` DDL + 2 complete patterns (pump.cavitation: pressure.residual< -2.0 required + vibration.high_frequency>=7.1 required, temperature.bearing>75 supporting, pressure.discharge>=85 contradictory; rotating.unbalance: vibration.1x_rpm>=4.5 required + vibration.radial>=5.0 required, vibration.phase_stability<=10 supporting, vibration.harmonics>5 contradictory)
- [x] T-1.4 `condition_pf_curves` DDL + 3 defaults (bearing.outer_race_defect=30d, rotating.misalignment=60d, pump.cavitation=14d)

### Phase 2: Diagnostic Functions (Migration 2)

- [x] T-1.5 `condition_diagnoses` DDL with evidence_summary JSONB, diagnosis_status lifecycle (candidate→field_trial→active→confirmed/rejected/superseded), linked_event_id/linked_work_order_id FKs. RLS: SELECT authenticated, INSERT/UPDATE PLANNER/ADMIN
- [x] T-1.6 `maintenance_recommendations` DDL with lifecycle gates — field_trial diagnosis always requires_confirmation=true; active+confidence≥0.7 can convert to WO
- [x] T-1.7 `compute_diagnosis_confidence()` — scoring: evidence_present_ratio (0.4), required_evidence_met (0.3), contradictory_penalty (0-0.3)×quality_mod×freshness×regime_match. Missing evidence NOT penalized. Returns TABLE(confidence NUMERIC, breakdown JSONB)
- [x] T-1.8 `compute_rul_linear()` — gates: slope>0, R²≥0.5, samples≥10, regime consistent, quality G0/G1, threshold defined, diagnosis confidence>0.5. Stores in analysis_results with rul_low/ru_high uncertainty interval ±20%
- [x] T-1.9 `generate_recommendation()` — creates recommendation from diagnosis + PF-curve + RUL. field_trial→suggested+requires_confirmation=true; active+confidence≥0.7→can bypass confirmation
- [x] T-1.10 `get_intervention_window()` — PF-curve helper returning pf_interval, inspection_interval, intervention_window_days

### Phase 3: Integration & EXTEND

- [x] T-1.11 Extended `evaluate_condition_rules()` — new evaluation_type='diagnostic' loads evidence matrix, evaluates patterns, calls compute_diagnosis_confidence(), creates condition_diagnosis (NOT event) if confidence≥threshold. Nested DECLARE/BLOCK for ELSIF
- [x] T-1.12 ALTERs — condition_events ADD diagnosis_id FK + failure_mode_id FK; condition_rules evaluation_type CHECK extended with 'diagnostic'
- [x] T-1.13 ALTER `trg_condition_event_to_wo_func()` — field_trial gate: if event linked to field_trial diagnosis, skip WO even if severity=critical
- [x] T-1.14 Seed 2 diagnostic rules (draft): cavitation pattern + unbalance pattern

### Phase 4: Testing

- [x] T-1.15 pgTAP `condition_diagnostic_functions_test.sql` (~28 assertions): diagnoses schema (6), functions exist (4), confidence scoring (4), RUL gates (4), recommendation lifecycle (2), ALTERs (4), RLS (3), seed rules (2), CHECK constraints (2)

## PR 2 — Frontend (~400 LOC)

### Phase 1: Hooks & Data

- [x] T-2.1 `src/hooks/useDiagnoses.js` — queries active diagnoses for asset with failure mode catalog JOIN + confidence breakdown via RPC
- [x] T-2.2 `src/hooks/useRul.js` — queries latest RUL estimate from analysis_results for asset, formats interval

### Phase 2: UI Components

- [x] T-2.3 `src/components/condition/DiagnosisPanel.jsx` — MUI table: failure_mode_name, confidence gauge (red<0.5, yellow<0.7, green≥0.7) with breakdown tooltip, status badge, expandable evidence row, linked event count. "Generar OT" button gated on active+confidence≥0.7
- [x] T-2.4 `src/components/condition/RulGauge.jsx` — visual gauge with gradient zones (green>30d/yellow 7-30d/red<7d), interval text "XX–YY días", confidence label, empty state "Sin estimación RUL disponible"
- [x] T-2.5 `src/components/condition/RecommendationCard.jsx` — MUI Card: priority chip, WO type badge, action text, due_window, requires_confirmation chip. "Confirmar y crear OT" button. Empty: "Sin recomendaciones activas"

### Phase 3: Integration

- [x] T-2.6 `src/App.jsx` — add "Diagnóstico" subtab after "Tendencias" (index 5 PLANNER/ADMIN, index 3 others). Composes RulGauge + DiagnosisPanel + RecommendationCard

### Phase 4: Testing

- [x] T-2.7 Vitest ~24 assertions (10 new + 14 existing TrendChart): DiagnosisPanel renders table + empty + loading + error + disabled button, RulGauge renders zones + null + loading, RecommendationCard renders card + empty + badge

## Spec Coverage

| Spec | Requirements | Tasks |
|------|-------------|-------|
| condition-failure-mode-catalog | FMC-001–005 | T-1.1 |
| fmea-cbm-cross-reference | FCX-001–003 | T-1.2 |
| diagnostic-evidence-matrix | DEM-001–005 | T-1.3 |
| diagnostic-confidence-scoring | DSC-001–004 | T-1.7 |
| condition-diagnoses | CDG-001–005 | T-1.5 |
| condition-pf-curves | PFC-001–003 | T-1.4 |
| maintenance-recommendations | REC-001–004 | T-1.6, T-1.9 |
| condition-rules (delta SDD 4) | CRUL-D4-001–003 | T-1.11, T-1.12, T-1.14 |
| condition-events (delta SDD 4) | CEVT-D4-001, REQ-CEVT-003 mod | T-1.12, T-1.13 |
| condition-health-index | (degradation_velocity reuse) | T-1.8 (slope as input) |
| condition-trend-regression | REQ-TRND-001–004 | T-1.8 (trend_slope input) |
| condition-analysis-results | REQ-CAR-001–004 | T-1.8 (rul_estimate storage) |
