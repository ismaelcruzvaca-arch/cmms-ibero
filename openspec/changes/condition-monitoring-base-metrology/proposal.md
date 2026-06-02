# Proposal: Condition Monitoring Base Metrology

## Architectural Dictamen

```
DICTAMEN:
Arquitectura APROBADA para SDD y desarrollo base del módulo CBM.

NO aprobada como sistema validado de monitoreo industrial.

Condiciones para aprobación industrial plena:
1. FeatureSet v0.2 formal con metadata de método (method_key, version, params, uncertainty)
2. Implementar catálogos de métodos (condition_analysis_methods) y capacidades de fuente (condition_source_capabilities)
3. Registrar incertidumbre, calidad y contexto operativo en cada feature value
4. Definir condition_rules con aplicabilidad por activo/régimen/método
5. Validar con banco o datos reales antes de decisiones de mantenimiento críticas
```

## Intent

CMMS lacks a real condition monitoring foundation. Current `preventive-condition-core` has only simple meter thresholds on `meter_readings`. IIoT Mantenimiento sends FeatureSet v0.2 payloads with multi-feature vibration/temperature data — the CMMS has nowhere to store them and no way to compute a meaningful Health Index. This change builds the foundation: EAV feature catalog, method registry, source capabilities bridge, edge ingest, contextualized thresholds, analysis results store, and a Health Index + degradation velocity computation layer. Plus the **validation lifecycle and continuous improvement framework** so the system can be audited and evolved even before real hardware arrives.

### Architecture Principle

```
Edge / IIoT:   Adquisición + Procesamiento (ISO 13374 Bloques 1-2) → FeatureSet trazable
CMMS:          Detección + Reglas + Eventos + OT (ISO 13374 Bloques 3-6)
```

**"El edge mide, el CMMS decide."** Pero con una condición: el CMMS solo puede decidir si sabe **cómo se calculó cada feature**. Un valor sin método es un número huérfano; con método es evidencia auditable.

## Scope

### In Scope

#### Sub-phase A — Foundation Catalog + Ingest (PR 1)
- `condition_feature_definitions` — EAV feature catalog (feature_key, unit, category, description)
- `condition_analysis_methods` — **NEW** scientific method registry (RMS, FFT band energy, Hilbert envelope, linear regression, Kalman filter, model residual, manual observation, weighted HI, etc.)
- `condition_source_capabilities` — **NEW** bridge: what each source/sensor can produce, with which method, sample rate, expected quality, validation status
- `condition_windows` — time-window segmentation for batch feature ingestion
- `condition_feature_values` — quality-gated feature storage with method metadata (method_key, method_version, parameters, quality_flag, uncertainty, confidence, operational_context)
- `condition_events` — event log with lifecycle (open → linked_to_wo → closed → dismissed)
- `condition_threshold_catalog` — contextualized thresholds (asset_class + feature_key + method_key + regime + measurement_location + severity + standard_reference)
- `ingest-condition` Edge Function — FeatureSet v0.2 HTTP endpoint with enriched contract validation
- `ingest-events` Edge Function — event ingestion endpoint
- FeatureSet v0.2 TypeScript contract — enriched with method metadata
- pgTAP tests (~45 assertions)

#### Sub-phase B — Computation + Rules + Lifecycle (PR 2)
- `condition_analysis_results` — **NEW** derived analytics store (HI, Kalman states, residuals, trend slopes, regression R², RUL placeholder)
- `condition_rules` — **NEW** rule engine: evaluates features + analysis results + quality flags + context + duration + trend
- `compute_health_index()` — piecewise linear HI from ISO zone boundaries with quality modifiers
- `compute_degradation_velocity()` — dHI/dt via rolling regression (168h window, min 5 points, R² threshold)
- `condition_event_sources` — links events to the rule/source that triggered them
- `trg_condition_event_to_wo` — event-driven work order generation with HI+dHI/dt criteria
- `validation_status` fields on methods, thresholds, rules, and sources — lifecycle workflow (draft → candidate → bench_validated → field_trial → active → deprecated)
- `condition_event_id` FK in work_orders
- Continuous improvement metrics views (data quality, rule performance, maintenance outcomes)
- pgTAP tests (~55 assertions)

### Out of Scope
- ❌ Kalman filters / sensor fusion computation → Phase 2
- ❌ RUL prediction models → Phase 3
- ❌ Adaptive/learned baselines (machine learning) → Phase 2
- ❌ FFT/wavelet processing (edge responsibility, not CMMS)
- ❌ Real-time streaming infrastructure (edge handles low-latency)
- ❌ Full GUM uncertainty propagation (Phase 2 — Phase 1 captures uncertainty when provided, Phase 2 computes it)

## Capabilities

### New Capabilities

| Capability | Description |
|---|---|
| `condition-method-catalog` | `condition_analysis_methods` — registry of scientific methods (RMS, FFT, Hilbert, Kalman, regression, etc.) with input requirements, output features, default parameters, validation status |
| `condition-source-capabilities` | `condition_source_capabilities` — bridge between hardware/sources and FeatureSet. Declares what each source can produce, with which method, sample rate, expected quality, and validation lifecycle |
| `condition-data-ingest` | FeatureSet v0.2 HTTP ingest with enriched contract (method metadata mandatory), EAV feature catalog, windows, quality-gated feature values with regime classification |
| `condition-thresholds` | `condition_threshold_catalog` with ISO 10816/20816 seed data, contextualized by asset_class + feature_key + method_key + regime + measurement_location + severity |
| `condition-analysis-results` | `condition_analysis_results` — derived analytics (HI, Kalman states, residuals, trends, dHI/dt, R²) separated from raw feature values |
| `condition-rules` | `condition_rules` — evaluates features + analysis results + quality flags + duration + trend + context. Rules are versioned and have validation lifecycle |
| `condition-health-index` | Multi-feature HI with ISO zone mapping, quality modifiers, dHI/dt via rolling regression |
| `condition-events` | Event log with lifecycle, event-to-WO trigger, rule/source attribution |
| `condition-validation-lifecycle` | **NEW** — every method, threshold, rule, and source has a `validation_status` field (draft → candidate → bench_validated → field_trial → active → deprecated). Continuous improvement metrics views |

### Modified Capabilities
- `preventive-condition-core`: Work orders gain `condition_event_id` FK; new `trg_condition_event_to_wo` replaces simple meter-threshold CBM trigger with HI+dHI/dt+rule logic

## Approach

Two stacked PRs targeting `main` sequentially. Sub-phase A delivers storage, catalog, and ingest. Sub-phase B adds computation, rules, and lifecycle. PR B depends on PR A's schema.

### Data Model — Complete

```
┌──────────────────────────────────────────────────────────────┐
│ CATALOGS (zero hardware dependency)                           │
│  condition_feature_definitions  (feature_key, unit, category) │
│  condition_analysis_methods     (method_key, category, ...)   │
│  condition_threshold_catalog    (asset_class, feature, ...)   │
├──────────────────────────────────────────────────────────────┤
│ HARDWARE BRIDGE (filled when hardware arrives)                │
│  condition_source_capabilities  (source_id, can_produce, ...) │
├──────────────────────────────────────────────────────────────┤
│ INGEST — FeatureSet v0.2 Enriched                            │
│  condition_windows              (window metadata)             │
│  condition_feature_values       (value + method + quality)    │
├──────────────────────────────────────────────────────────────┤
│ ANALYTICS DERIVED                                            │
│  condition_analysis_results     (HI, Kalman, residuals, ...)   │
├──────────────────────────────────────────────────────────────┤
│ DECISION LAYER                                               │
│  condition_rules                (rules x feature x method)    │
│  condition_events               (event log → OT)              │
│  condition_event_sources        (rule/source attribution)     │
└──────────────────────────────────────────────────────────────┘
```

### FeatureSet v0.2 — Enriched Contract

```json
{
  "external_window_id": "edge_001:BANDA-TR-01:2026-06-01T10:00:00Z:v2",
  "asset_id": "BANDA-TR-01",
  "source_id": "edge_001",
  "source_type": "edge",
  "window_start": "2026-06-01T10:00:00Z",
  "window_end": "2026-06-01T10:00:01Z",
  "pipeline_version": "0.2.0",
  "config_version": "1.0.0",
  "operational_context": {
    "regime": "nominal",
    "rpm": 1780,
    "load_pct": 72
  },
  "features": [
    {
      "measurement_point_id": "mp_motor_de_h",
      "feature_key": "vibration.rms",
      "value": 4.2,
      "unit": "mm/s",
      "quality_flag": "G0",
      "method_key": "rms_velocity_window",
      "method_version": "0.1.0",
      "parameters": {
        "window_s": 1.0,
        "filter": "10-1000Hz"
      },
      "uncertainty": 0.25,
      "confidence": 0.95,
      "sample_count": 25600
    }
  ]
}
```

**Mandatory fields**: external_window_id, asset_id, source_id, window_start, window_end, feature_key, value, unit, quality_flag, method_key, method_version

**Optional but strongly recommended**: parameters, uncertainty, confidence, measurement_point_id, operational_context, sample_count

### Key Design Decisions

1. **Piecewise linear HI from ISO zones**: A=1.0, B=0.7, C=0.2, D=0.0 — mapped per feature, then weighted average across features
2. **Multiplicative quality modifiers**: G0=1.0, G1=0.8, G2=0.5, G3=0.0 — quality flags gate feature contribution to HI
3. **Regime classification**: from operational_context (load_pct + rpm) at ingest; unknown regimes use conservative defaults
4. **dHI/dt via rolling regression**: 168h window, min 5 consecutive readings in same regime, R² ≥ 0.5 required for slope to be actionable
5. **Rules are versioned and contextualized**: not `vibration.rms > 7.1` but `feature_key=vibration.rms AND method_key=rms_velocity_window AND regime=nominal AND asset_class=centrifugal_pump → threshold > X`
6. **Every entity has a validation lifecycle**: methods, thresholds, rules, and sources move through draft → candidate → bench_validated → field_trial → active → deprecated

### Validation & Continuous Improvement Framework

#### Lifecycle States

```
draft ────────→ candidate ────────→ bench_validated ────────→ field_trial ────────→ active
                     │                     │                      │                    │
                     └─────────────────────┴──────────────────────┴────→ deprecated  ←┘
                                                                       rejected
```

- **draft**: Defined but not yet ready for review
- **candidate**: Proposed for validation, ready for bench testing
- **bench_validated**: Tested with synthetic/controlled data
- **field_trial**: Deployed on a real asset, but NO automatic critical decisions
- **active**: Fully validated, can generate events and OTs under approved rules
- **deprecated**: Retired (method changed, source removed, threshold outdated)
- **rejected**: Failed validation

#### Continuous Improvement Metrics

| Category | Metrics |
|---|---|
| **Data Quality** | % G0 / G1 / G2 / G3, sample loss rate, latency, duplicates |
| **Rule Performance** | events generated, false positives, confirmed events, repeated events |
| **Maintenance Outcomes** | OTs created by CBM, OTs with confirmed finding, OTs discarded, time-to-response |
| **Metrology** | sensors past calibration, declared uncertainty, drift detected, sources with missing uncertainty |
| **Model/Algorithm** | method_version tracked, rule_version tracked, threshold_version tracked, HI drift, R² history |

#### Testing Strategy (Pre-Data Phase)

Since we do NOT have real IIoT data yet, the continuous improvement framework is validated with:

1. **Synthetic data generation**: pgTAP tests with crafted FeatureSet payloads covering all ISO zones, quality flags, regime transitions
2. **Edge case simulation**: G3-only windows, missing operational_context, method_version mismatch, uncertainty boundary values
3. **Regression guard**: HI and dHI/dt computation tested against hand-calculated expected values
4. **Lifecycle transitions**: validation_status state machine enforced by constraints
5. **Bench validation step**: before any rule goes `active`, it MUST pass bench_validated with synthetic data matching expected asset_class behavior

When IIoT hardware arrives, the framework already exists — just fill `condition_source_capabilities` and run the same tests with real data.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/migrations/` | New | 4 migrations: feature_catalog_schema, method_catalog_schema, source_capabilities, metrology_compute |
| `supabase/functions/ingest-condition/` | New | FeatureSet v0.2 HTTP endpoint with enriched contract |
| `supabase/functions/ingest-events/` | New | Condition event ingestion |
| `supabase/functions/compute-hi/` | New | Health Index + dHI/dt scheduled computation |
| `supabase/tests/database/` | New | ~100 pgTAP assertions (45 PR1 + 55 PR2) |
| `openspec/specs/condition-method-catalog/` | New | Capability spec |
| `openspec/specs/condition-source-capabilities/` | New | Capability spec |
| `openspec/specs/condition-data-ingest/` | New | Capability spec |
| `openspec/specs/condition-thresholds/` | New | Capability spec |
| `openspec/specs/condition-analysis-results/` | New | Capability spec |
| `openspec/specs/condition-rules/` | New | Capability spec |
| `openspec/specs/condition-health-index/` | New | Capability spec |
| `openspec/specs/condition-events/` | New | Capability spec |
| `openspec/specs/condition-validation-lifecycle/` | New | Capability spec |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| FeatureSet v0.2 contract mismatch with real IIoT devices | Med | Strict TypeScript types + EF boundary validation. Enriched contract is backward-compatible (new fields optional for edge, mandatory for CMMS storage). Reject malformed payloads with explicit error. |
| IIoT doesn't provide method metadata (method_key, version, params) | Med | Accept payloads without method metadata into a `raw` quality tier (G2), flag for review. Rules using those features require `method_missing=true` override. Push for contract compliance with IIoT team. |
| ISO threshold data incomplete for all machine types | Med | Seed common types (pumps, motors, fans, compressors, turbines). Missing types use conservative defaults and `validation_status=bench_validated` until field data available. |
| Regime misclassification from unreliable operational_context | Med | Require operational_context in payload; default mapping for unknown regimes. Rules can specify `regime=any` until context is reliable. |
| dHI/dt false positives during operational transients | Med | Min 5 consecutive readings in same regime + R² ≥ 0.5 before computing slope. |
| Scope creep from multi-entity design | Med | Stacked PRs enforce boundary. PR 1 ships catalogs + ingest before PR 2 starts. Each PR has independent rollback. |
| Validation lifecycle adds complexity before we have data | Low | Lifecycle states are simple CHECK constraints. No automation yet — manual promotion through states. Automation comes in Phase 2 when we have real data patterns. |
| Method catalog may be incomplete for future signal types | Low | Methods table is extensible — INSERT new rows, no schema change. Unknown methods in payloads are accepted and flagged for review. |

## Rollback Plan

**Per migration atomicity**: each migration is reversible.

**Sub-phase A rollback**: `DROP TABLE condition_feature_definitions, condition_analysis_methods, condition_source_capabilities, condition_windows, condition_feature_values, condition_events, condition_threshold_catalog CASCADE` + delete Edge Functions via Supabase CLI.

**Sub-phase B rollback**: `DROP FUNCTION compute_health_index, compute_degradation_velocity` + `DROP TRIGGER trg_condition_event_to_wo` + `DROP TABLE condition_analysis_results, condition_rules, condition_event_sources CASCADE` + `ALTER TABLE work_orders DROP COLUMN condition_event_id`.

Stacked PRs mean PR 1 can roll back independently of PR 2.

## Dependencies

- `preventive-condition-core` schema (meter_readings, measure_points, work_orders) must be deployed
- Supabase project with Edge Functions enabled
- pgTAP extension installed in test database

## Success Criteria

- [ ] Sub-phase A: all ~45 pgTAP assertions pass (schema, RLS, EF validation, FeatureSet v0.2 enriched round-trip, method catalog, source capabilities)
- [ ] Sub-phase B: all ~55 pgTAP assertions pass (threshold catalog, regime classification, HI computation, dHI/dt, rules evaluation, event-to-WO trigger, lifecycle state transitions)
- [ ] `ingest-condition` accepts enriched FeatureSet v0.2 payload and stores parsed values in `condition_feature_values` with full method metadata
- [ ] `condition_analysis_methods` seeded with ≥10 methods (RMS, FFT band energy, Hilbert envelope, linear regression, Kalman filter, model residual, window average, peak, crest factor, manual observation, weighted HI)
- [ ] `condition_source_capabilities` supports sources with unknown hardware (source_type=manual, source_type=edge, source_type=portable) and validation_status lifecycle
- [ ] `condition_threshold_catalog` seeded with ISO 10816/20816 thresholds for ≥4 asset classes, contextualized by method_key and regime
- [ ] `compute_health_index()` returns correct piecewise linear output for all 4 ISO zones (A=1.0, B≤0.7, C≤0.2, D=0.0) with quality modifiers applied
- [ ] `compute_degradation_velocity()` returns stable slope with R² for ≥5 data points in 168h window
- [ ] `condition_rules` can evaluate: `feature_value > threshold` AND `quality_flag ≥ minimum` AND `duration ≥ N windows` AND `method_key matches`
- [ ] `trg_condition_event_to_wo` creates a work order when an active rule fires with severity requiring WO generation
- [ ] All entities with `validation_status` enforce valid state transitions (cannot go from draft directly to active)
- [ ] Edge Functions can be invoked via Supabase REST API
- [ ] Continuous improvement metrics views are queryable (data quality %, rules fired, events per source)
