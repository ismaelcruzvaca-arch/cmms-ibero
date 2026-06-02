# Tasks: Condition Monitoring Base Metrology

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2000 (PR1 ~950, PR2 ~1050) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1: Catalog+Ingest → PR2: Computation+Rules+Lifecycle |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## PR 1 — Foundation Catalog + Ingest

- [x] T-1.1: Mig 1 — `condition_feature_definitions` DDL + seed 12 features with default_weight
- [x] T-1.2: Mig 2 — `condition_analysis_methods` DDL + seed 12 methods across 5 categories with validation_status
- [x] T-1.3: Mig 3 — `condition_source_capabilities` DDL + FK→methods + UNIQUE(source_id,can_produce,method_key) + source_type CHECK
- [x] T-1.4: Mig 4a — `condition_windows` + `condition_feature_values` + `condition_events` DDL + indexes + FKs **(windows + feature_values done in PR 1c; condition_events + condition_event_sources done in PR 1d)**
- [x] T-1.5: Mig 4b — `condition_threshold_catalog` DDL + seed ISO 10816/20816 for 4 asset_classes × 2 mountings + generic fallback (9 rows, all bench_validated)
- [x] T-1.6: Mig 4c — RLS on 7 PR1 tables: SELECT authenticated, INSERT/UPDATE/DELETE by role (ADMIN/PLANNER catalogs, ADMIN events)
- [x] T-1.7: `ingest-condition` EF — POST FeatureSet v0.2: validate 11 mandatory fields, soft-validate method (force G2 if missing), hard-validate feature FK, check source capabilities (reject unregistered, force G2 if ∉active/field_trial), upsert window+insert fv **(PR 1c — Edge Function local file ready; Supabase deploy blocked by platform)**
- [x] T-1.8: `ingest-events` EF — POST validate event_type/severity/asset_id, INSERT condition_events **(PR 1d — Edge Function local file ready; Supabase deploy blocked by platform)**
- [x] T-1.9: pgTAP PR1 (parcial — catálogos) — schema+constraints+seed counts, CHECKs, FK readiness, RLS (39 assertions en condition_catalogs_test.sql)

## PR 2 — Computation + Rules + Lifecycle

- [x] T-2.1: Mig 5a — `condition_analysis_results` + `condition_rules` + `condition_event_sources` DDL + indexes + FKs **(condition_analysis_results + condition_rules done in PR 2a; condition_event_sources was already created in PR 1d)**
- [x] T-2.2: Mig 5b — ALTER work_orders ADD condition_event_id FK→events; ALTER events ADD FK rule_id→rules
- [x] T-2.3: Mig 5c — `trg_enforce_validation_lifecycle` function + triggers on methods, thresholds, sources, rules, analysis_results (draft→candidate→bench_validated→field_trial→active→deprecated; rejected→draft; deprecated→candidate)
- [x] T-2.4: Mig 5d — `compute_health_index()`: piecewise linear ISO zones (A=1.0, B=0.85 mid, C=0.45 mid, D=0.093) × quality modifiers (G0=1.0,G1=0.8,G2=0.5,G3=0.0) × weighted avg per default_weight, contextual threshold lookup (feature_definition_id+method_key+asset_class+regime)
- [x] T-2.5: Mig 5e — `compute_degradation_velocity()`: 168h rolling regression via regr_slope/regr_r2, min 5 pts same regime, R²≥0.5 gate, slope convertido a HI/día (×86400)
- [x] T-2.6: Mig 5f — `evaluate_condition_rules()`: match active/field_trial rules by asset_class+feature+method+regime, evaluate threshold/trend/compound, gate severity≤warning if method draft/candidate, insert events+sources **(PR 2d — function + helper + tests)**
- [x] T-2.7: Mig 5g — `trg_condition_event_to_wo`: AFTER INSERT on events, critical→WO (CBM,WAPPR), event→linked_to_wo, anti-spam por condition_event_id
- [x] T-2.8: Mig 5h — Views: v_condition_data_quality, v_condition_rule_performance, v_condition_metrology_status **(PR 2d — 3 views with Spanish comments, column comments)**
- [x] T-2.9: Mig 5i — RLS on PR2 tables by role (ADMIN for analysis_results, PLANNER/ADMIN for rules) **(condition_analysis_results + condition_rules RLS done in PR 2a; remaining tables in later slices)**
- [x] T-2.10: `compute-hi` EF — POST invoke HI+dHI/dt+rules per asset, store in analysis_results **(PR 2d — Edge Function local file ready; Supabase deploy blocked by platform)**
- [x] T-2.11: pgTAP PR2 — HI zones+modifiers+G3-only→NULL, dHI/dt edge cases (<5pts,low R²), rules (threshold/trend/compound+quality gate+method cap), triggers (critical→WO,warning→no WO,invalid transitions blocked), views queryable (~143 assertions total: 50 compute + 42 triggers + 18 health_index + 33 rules_views) **(PR 2d: 33 assertions condition_rules_views_test.sql)**
