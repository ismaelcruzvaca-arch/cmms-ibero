# Proposal: Condition Monitoring Base Metrology

## Intent

CMMS lacks a real condition monitoring foundation. Current `preventive-condition-core` has only simple meter thresholds. IIoT Mantenimiento sends FeatureSet v0.2 payloads with multi-feature vibration/temperature data — the CMMS has nowhere to store them and no way to compute a meaningful Health Index. This change builds the missing EAV feature catalog, edge ingest, and metrology layer to turn raw features into actionable HI with degradation velocity.

## Scope

### In Scope
- **Sub-phase A (Foundation)**: `condition_feature_definitions`, `condition_windows`, `condition_feature_values`, `condition_events` tables + `ingest-condition` / `ingest-events` Edge Functions + FeatureSet v0.2 TypeScript contract + pgTAP tests (~30 assertions)
- **Sub-phase B (Metrology + HI)**: `condition_threshold_catalog` with ISO 10816/20816 seed data + regime classification + quality flag system G0-G3 + `compute_health_index()` with piecewise linear zone mapping + `compute_degradation_velocity()` rolling regression + `trg_condition_event_to_wo` trigger + `condition_event_id` FK in work_orders + pgTAP tests (~40 assertions)

### Out of Scope
- ❌ Kalman filters / sensor fusion → Phase 2
- ❌ RUL prediction → Phase 3
- ❌ Adaptive/learned baselines → Phase 2
- ❌ FFT processing (edge responsibility)
- ❌ Real-time streaming (edge handles low-latency)

## Capabilities

### New Capabilities
- `condition-data-ingest`: FeatureSet v0.2 HTTP ingest, EAV feature catalog, windows, quality-gated feature values, regime classification at boundary
- `condition-health-index`: Multi-feature HI with ISO 10816/20816 zone mapping, quality modifiers, dHI/dt via rolling regression, uncertainty propagation
- `condition-events`: Event log with lifecycle (open → linked_to_wo → closed → dismissed), event-driven work order generation

### Modified Capabilities
- `preventive-condition-core`: Work orders gain `condition_event_id` FK; new `trg_condition_event_to_wo` parallels existing meter-threshold CBM trigger with HI+dHI/dt logic

## Approach

Two stacked PRs targeting `main` sequentially. **Sub-phase A** delivers the storage and ingest infrastructure. **Sub-phase B** adds the computation layer. PR B depends on PR A's schema. Both include their own pgTAP tests.

Key design: piecewise linear HI from ISO zone boundaries (A=1.0, B=0.7, C=0.2, D=0.0), multiplicative quality modifiers (G0=1.0 → G3=0.0), regime classification from load_pct+rpm at ingest, and dHI/dt via linear regression over 168h rolling window.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | 3 migrations: condition_feature_schema, threshold_catalog, metrology_hi |
| `supabase/functions/ingest-condition/` | New | FeatureSet v0.2 HTTP endpoint |
| `supabase/functions/ingest-events/` | New | Condition event ingestion |
| `supabase/tests/database/` | New | ~70 pgTAP assertions |
| `openspec/specs/condition-data-ingest/` | New | Capability spec |
| `openspec/specs/condition-health-index/` | New | Capability spec |
| `openspec/specs/condition-events/` | New | Capability spec |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| FeatureSet contract mismatch with real IIoT devices | Med | Strict TypeScript types + EF boundary validation, reject malformed payloads |
| ISO threshold data incomplete for all machine types | Med | Seed common types (pumps, motors, fans, compressors); missing types use conservative defaults |
| Regime misclassification from unreliable load_pct/rpm | Med | Require operational_context in payload; default mapping for unknown regimes |
| dHI/dt false positives during operational transients | Med | Min 5 consecutive readings in same regime before computing slope |
| Scope creep from dual sub-phase scope | Low | Stacked PRs enforce boundary; PR 1 ships foundation before PR 2 starts |

## Rollback Plan

**Per migration atomicity**: each migration is reversible. Sub-phase A: `DROP TABLE condition_feature_definitions, condition_windows, condition_feature_values, condition_events CASCADE` + delete Edge Functions via Supabase CLI. Sub-phase B: `DROP FUNCTION compute_health_index, compute_degradation_velocity` + `DROP TRIGGER trg_condition_event_to_wo` + `ALTER TABLE work_orders DROP COLUMN condition_event_id` + DELETE from condition_threshold_catalog. Stacked PRs mean PR 1 can roll back independently of PR 2.

## Dependencies

- `preventive-condition-core` schema (meter_readings, measure_points, work_orders) must be deployed
- Supabase project with Edge Functions enabled
- pgTAP extension installed in test database

## Success Criteria

- [ ] Sub-phase A: all ~30 pgTAP assertions pass (schema, RLS, EF validation, FeatureSet v0.2 round-trip)
- [ ] Sub-phase B: all ~40 pgTAP assertions pass (threshold catalog, regime classification, HI computation, dHI/dt, event-to-WO trigger)
- [ ] `ingest-condition` accepts a valid FeatureSet v0.2 payload and stores parsed values in condition_feature_values
- [ ] `compute_health_index()` returns correct piecewise linear output for all 4 ISO zones (A=1.0, B≤0.7, C≤0.2, D=0.0)
- [ ] `compute_degradation_velocity()` returns stable slope with R² for ≥5 data points in 168h window
- [ ] `trg_condition_event_to_wo` creates a work order when HI < 0.5 AND dHI/dt > 3%/day
- [ ] Edge Functions can be invoked via Supabase REST API
