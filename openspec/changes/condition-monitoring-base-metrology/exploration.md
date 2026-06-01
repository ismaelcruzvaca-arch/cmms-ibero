# Exploration: Condition Monitoring Base Metrology

## Current State

### What Actually Exists in the Codebase

The current CMMS has a **basic CBM schema** from the `preventive-condition-core-phase-1` and `pm-rcm-engine-phase-1` changes:

- **4 PM/CBM tables**: `job_plans`, `pm_schedules`, `meters`, `measure_points`, `meter_readings`
- **CBM Alert Trigger** (`trg_meter_reading_cbm`): BEFORE INSERT on `meter_readings` — compares reading_value against 4 quadrants (upper/lower, warning/critical), sets `is_alert_triggered`, and creates CBM work orders on critical breaches with anti-spam deduplication.
- **PM Engine Automata** (`generate_due_preventive_work_orders()`): Scans `pm_schedules`, generates PM work orders with hierarchical suppression and material inheritance.
- **Work Orders** (ISO 14224 schema): includes `meter_id` FK and `job_plan_id` FK for traceability.
- **Assets** table with `criticality` (A/B/C), `equipment_id`, ISO 14224 failure taxonomy columns.

### What Does NOT Exist Yet (Foundation Gap)

The following are **NOT present** in the codebase despite being described as "Phase 1 already implemented":

1. ❌ **`condition_feature_definitions`** table — No EAV catalog for vibration/pressure/temperature features.
2. ❌ **`condition_windows`** table — No time-window segmentation for FFT/feature data.
3. ❌ **`condition_feature_values`** table — No quality-gated feature value storage.
4. ❌ **`condition_events`** table — No event log.
5. ❌ **`ingest-condition`** Edge Function — No REST endpoint for FeatureSet v0.2 payloads.
6. ❌ **`ingest-events`** Edge Function — No event ingestion endpoint.
7. ❌ **`compute_health_index()`** — No function exists (only the CBM trigger evaluates simple thresholds).
8. ❌ **`trg_condition_event_to_wo`** — No event-to-work-order trigger.
9. ❌ **FeatureSet v0.2 contract** — No payload schema defined in code.
10. ❌ **Quality flags (G0-G3)** — No flag system implemented.
11. ❌ **pgTAP tests** — Only 4 CBM trigger tests exist, not 57.

The existing CBM system uses `meter_readings` with simple threshold comparisons (warning/critical limits on `measure_points`). There is NO multi-feature ingestion, NO health index computation, NO quality flags, NO metrological correction.

### What This Phase Must Build

This change therefore has a **dual scope**:
1. **Foundation**: Build the missing EAV feature catalog, windows, feature values, events tables, and edge functions.
2. **Metrology Layer**: Add thresholds per standard, regime-aware normalization, quality-flag correction, a real health index, and dHI/dt.

---

## Affected Areas

- `supabase/migrations/20260601000001_condition_feature_schema.sql` — New tables (feature_definitions, windows, feature_values, events)
- `supabase/migrations/20260601000002_condition_threshold_catalog.sql` — Threshold standards table
- `supabase/migrations/20260601000003_condition_metrology_hi.sql` — compute_health_index() replacement, quality gating
- `supabase/functions/ingest-condition/index.ts` — New Edge Function
- `supabase/functions/ingest-events/index.ts` — New Edge Function
- `supabase/tests/database/` — pgTAP tests (est. 60-80 assertions)
- `openspec/specs/condition-data-ingest/spec.md` — New spec
- `openspec/specs/condition-health-index/spec.md` — New spec
- `openspec/specs/condition-events/spec.md` — New spec

---

## Investigated Standards / Research

### ISO Threshold Standards (Report 2)

**ISO 10816** (now ISO 20816 series): Mechanical vibration — Evaluation of machine vibration by measurements on non-rotating parts. Defines vibration severity zones per machine class:

| Class | Machine Type | Power/Speed | Zone A (Good) | Zone B (Allowable) | Zone C (Unsatisfactory) | Zone D (Danger) |
|-------|-------------|-------------|---------------|-------------------|------------------------|-----------------|
| I | Small machines (≤15 kW) | Any | ≤0.71 mm/s | ≤1.8 mm/s | ≤4.5 mm/s | >4.5 mm/s |
| II | Medium machines (15-75 kW) | Any | ≤1.12 mm/s | ≤2.8 mm/s | ≤7.1 mm/s | >7.1 mm/s |
| III | Large machines (≥75 kW) on rigid support | 120-15000 rpm | ≤1.8 mm/s | ≤4.5 mm/s | ≤11.2 mm/s | >11.2 mm/s |
| IV | Large machines on flexible support | 120-15000 rpm | ≤2.8 mm/s | ≤7.1 mm/s | ≤18.0 mm/s | >18.0 mm/s |

**ISO 20816-1:2016** — Supersedes ISO 10816. Same zones but adds:
- Vibration velocity (mm/s RMS) as primary metric
- Acceleration monitoring for high-frequency bearing faults
- Segmented by machine type (pumps, compressors, turbines, fans) in parts 2-9
- Regime consideration: measurement at rated speed and steady-state load

**ISO 2372** (historical, now ISO 10816): Defines vibration severity criteria for machines with power 0.75-300 kW.

**ISO 17359:2018** — Condition monitoring and diagnostics of machines. Provides the overall framework for selecting parameters, measurement methods, and assessment criteria.

### Metrology Standards (Reports 1, 2)

- **ISO/IEC 17025**: Laboratory competence — requires calibration certificates with uncertainty, traceable to national standards.
- **ISO 10012**: Measurement management systems — defines instrument inventory, calibration intervals, quality documentation.
- **JCGM 100 (GUM)**: Guide to the Expression of Uncertainty in Measurement — Type A (statistical) and Type B (specification-based) uncertainty evaluation.
- **ISO 16063**: Methods for calibration of vibration transducers.
- **OIML/ILAC G24**: Guidelines for determination of calibration intervals based on risk and historical data.

### Health Index Models (Reports 5, 7)

**ISO 55000** defines Asset Health Index (AHI) as "a score designed to reflect or characterize the condition of the asset and its likely performance."

**Three approaches** for HI computation:

1. **Weighted distance from thresholds** (most practical for Phase 1):
   ```
   HI(t) = Σ w_i · q_i · f(x_i(t))
   ```
   where f(x_i) maps feature value to [0,1] health score based on distance from threshold bands, w_i are weights, q_i are quality modifiers.

2. **Z-score / deviation from baseline**:
   ```
   HI(t) = 1 - |x(t) - μ| / (k · σ)
   ```
   where μ, σ are baseline statistics per feature per regime. Simple but requires historical baseline.

3. **Stochastic degradation model** (Phase 3 territory):
   Weibull, Wiener, or Gamma processes for RUL prediction. Too complex for Phase 1.

### Quality Flag Systems (Report 6)

From the data governance research:
- **G0 (Good)**: Valid reading, calibration current, no anomalies
- **G1 (Calibration Warning)**: Sensor within m% of calibration expiry or uncertainty > threshold
- **G2 (Suspect)**: Outlier detected, cross-sensor inconsistency, or marginal range
- **G3 (Invalid)**: Hardware fault, out-of-range, calibration expired

Quality flags propagate to HI as multiplicative modifier q_i ∈ [0,1]:
- G0 → q = 1.0
- G1 → q = 0.8 (or e^(-λ·d) where d = days past calibration threshold)
- G2 → q = 0.5
- G3 → q = 0.0 (exclude from HI)

---

## Deep Analysis per Topic

### 1. Thresholds

**Problem**: Current `measure_points` table has only warning/critical per meter (simple upper/lower). Need per-feature, per-asset-type, per-regime thresholds from ISO standards.

**Recommended approach**: Create a `condition_threshold_catalog` table:

```sql
CREATE TABLE condition_threshold_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_definition_id UUID NOT NULL REFERENCES condition_feature_definitions(id),
  asset_category TEXT NOT NULL,         -- 'PUMP', 'MOTOR', 'COMPRESSOR', 'FAN', 'GEARBOX'
  power_range_min NUMERIC,              -- kW or HP
  power_range_max NUMERIC,
  mounting_type TEXT,                   -- 'RIGID', 'FLEXIBLE'
  regime TEXT NOT NULL,                 -- 'STOPPED', 'STARTUP', 'IDLE', 'PARTIAL_LOAD', 'FULL_LOAD', 'OVERLOAD'
  zone_a_max NUMERIC,                   -- Good threshold
  zone_b_max NUMERIC,                   -- Allowable threshold
  zone_c_max NUMERIC,                   -- Unsatisfactory threshold
  -- D is everything above zone_c_max (Danger)
  iso_standard TEXT NOT NULL,           -- 'ISO_10816_3', 'ISO_20816_1', 'ISO_20816_2', 'ISO_2372', etc.
  source_reference TEXT,                -- Citation or standard clause
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This enables queries like:
```sql
SELECT * FROM condition_threshold_catalog
WHERE feature_definition_id = 'vibration_rms_hv'
  AND asset_category = 'PUMP'
  AND power_range_min <= 75
  AND regime = 'FULL_LOAD'
  AND mounting_type = 'RIGID';
```

**ISO data to seed**: All 4 machine classes from ISO 10816-3 (now ISO 20816-3:2022), plus pump-specific thresholds from ISO 10816-7/ISO 20816-3, and fan thresholds from ISO 10816-3.

**Key insight**: Vibration thresholds are measured in mm/s RMS (velocity). Acceleration monitoring for bearing faults uses m/s² with different bands. These must be separate feature definitions.

### 2. Regime-Aware Normalization

**Problem**: Same vibration at 50% load vs 100% load means different things. Current system ignores operational context entirely.

**Approach**: Two-stage normalization

**Stage 1 — Regime classification** (done at ingest):
```
regime:
  - STOPPED:    rpm < 5% rated OR load_pct < 5%
  - STARTUP:    rpm changing > 10%/min
  - IDLE:       loaded < 10% but at rated speed
  - PARTIAL_LOAD: load_pct between 10-80%
  - FULL_LOAD:  load_pct >= 80%
  - OVERLOAD:   load_pct > 105%
```

**Stage 2 — Feature normalization by regime**:
For each feature f in regime R with baseline μ_R and deviation σ_R:
```
z_score(f) = (x_f - μ_R) / σ_R
normalized_contribution = 1 / (1 + e^(-k · (z_score(f) - z_critical)))
```

This sigmoid mapping gives smooth transition from healthy (→1) to critical (→0).

**Baseline approach for Phase 1**: Use standard thresholds from ISO as implicit baselines. Future phases (Phase 2, Kalman) will learn adaptive baselines.

**Math**:
```
regime_adjusted_value = x_f * (load_pct_ref / load_pct_actual)^α
```
where α depends on feature type (0.5-1.0 for vibration since vibration ∝ √speed typically, 0.7-1.0 for temperature).

### 3. Metrological Correction

**Current gap**: Quality flags don't exist in the schema. The G0-G3 flags must be:
1. Stored alongside each feature value
2. Used to modulate the feature's contribution to HI
3. Propagated from sensor calibration records

**Recommended model**:

```
HI_weighted = Σ (w_i * q_i * normalized_feature_i) / Σ (w_i * q_i)
```

where:
- `w_i` = weight of feature i (domain expert configurable)
- `q_i` = quality modifier based on G flag
- `normalized_feature_i` = the regime-normalized value of feature i

**Quality modifier calculation**:

| Flag | Criteria | q_i |
|------|----------|-----|
| G0 | Calibration valid, no anomalies | 1.0 |
| G1 | Calibration within 90% of expiry OR uncertainty > 2× baseline | 1.0 - 0.2 · (days_past_warning / warning_window) |
| G2 | Statistical outlier detected (3σ), or cross-sensor inconsistency | 0.5 |
| G3 | Calibration expired, hardware fault, out-of-range | 0.0 (exclude) |

For G1, the modifier decays linearly from the first calibration warning date. This is stored in a `calibration_warning_days` config parameter (default 30).

**Uncertainty propagation**: Each feature reading carries its uncertainty σ_i (from calibration cert). The HI uncertainty becomes:
```
σ_HI = sqrt( Σ (w_i · q_i · σ_i)² ) / Σ (w_i · q_i)
```
This means HI is reported as a range, not a point value. Example: `HI = 0.72 ± 0.08`.

### 4. Health Index Design

**The current approach is a toy**. Weighted sum of raw values is not a real HI. Here is the recommended design:

**HI Formula** (inspired by ISO 55000 AHI and research from Reports 5, 7):

```
HI(t) = 0 ≤ Σ w_i · q_i · h_i(x_i, regime) ≤ 1
```

Where h_i(x_i, regime) is the **feature health score**:

```
h_i(x, regime) = {
  1.0                                    if x ≤ zone_A(regime)       -- Good
  1.0 - 0.3 · (x - zone_A) / (zone_B - zone_A)  if x ∈ (zone_A, zone_B]   -- Allowable
  0.7 - 0.5 · (x - zone_B) / (zone_C - zone_B)  if x ∈ (zone_B, zone_C]   -- Unsatisfactory
  0.2 - 0.2 · (x - zone_C) / (zone_D - zone_C)  if x ∈ (zone_C, zone_D]   -- Danger (but not failed)
  0.0                                    if x > zone_D              -- Failed
}
```

This creates a piecewise linear mapping from ISO threshold zones to [0,1], where:
- Zone A (Good) → h = 1.0
- Zone B boundary → h = 0.7
- Zone C boundary → h = 0.2
- Zone D boundary → h = 0.0

**HI Interpretation**:
| HI Range | Meaning | Action |
|----------|---------|--------|
| 0.80-1.00 | Healthy | None |
| 0.60-0.79 | Monitor | Increase inspection frequency |
| 0.30-0.59 | Warning | Plan intervention |
| 0.10-0.29 | Critical | Immediate work order |
| 0.00-0.09 | Failed | Emergency shutdown |

**HI Weights (domain-configurable)**:
| Feature Group | Default Weight | Rationale |
|--------------|----------------|-----------|
| Vibration RMS (overall) | 0.35 | Best general fault indicator |
| Vibration peak/crest factor | 0.15 | Bearing/impact detection |
| Temperature | 0.20 | Thermal degradation |
| Pressure/Temperature delta | 0.15 | Process health |
| Band frequency analysis | 0.15 | Specific fault signatures |

### 5. dHI/dt (Degradation Velocity)

**Approach**: Compute the first derivative of HI over a rolling window.

**Method**:
```sql
dHI_dt = (HI(t) - HI(t - Δt)) / Δt
```

Rolling linear regression over last N valid points (N ≥ 5, default window = 7 days or 168 hours):
```
HI(t) = a + b·t → dHI/dt = b (slope coefficient)
```

**dHI/dt thresholds** (% HI change per day):

| dHI/dt Range | Severity | Action |
|-------------|----------|--------|
| |b| < 1%/day | Stable | None |
| 1%/day ≤ |b| < 3%/day | Mild degradation | Flag for review |
| 3%/day ≤ |b| < 10%/day | Accelerating | Schedule inspection |
| |b| ≥ 10%/day | Critical degradation | Immediate alert |

**Implementation**: New SQL function `compute_degradation_velocity(asset_id UUID, window_hours INT DEFAULT 168)`:
1. Fetch HI values for asset over window
2. Fit linear regression (HI ~ epoch_timestamp)
3. RETURN slope coefficient and R² (confidence)

When both HI < 0.5 AND dHI/dt > 3%/day → trigger condition event.

### 6. Gap Analysis

| Concern | Current State (Phase 1) | Required for Real CBM | Gap |
|---------|------------------------|----------------------|-----|
| **Feature catalog** | Only generic `measure_points` with simple numeric thresholds | Per-feature EAV definitions with units, norm ranges, feature type | ❌ Not built |
| **Threshold standards** | `measure_points` has warning/critical NUMERIC columns | ISO 10816/20816 per machine class, power, mounting, regime | ❌ Not built (4 zones needed, not 2) |
| **Regime awareness** | No regime concept exists | Load_pct, rpm, regime classification needed at ingest and computation | ❌ Not built |
| **Quality flags** | No quality system exists | G0-G3 with calibration status, outlier detection | ❌ Not built |
| **Health Index** | No HI computed | Multi-feature regime-aware HI with ISO threshold mapping | ❌ Not built |
| **dHI/dt** | No degradation velocity | Rolling slope computation with alert thresholds | ❌ Not built |
| **Edge Function ingest** | Only `meter_readings` INSERT via API | `ingest-condition` with FeatureSet v0.2 payload validation | ❌ Not built |
| **Work order integration** | Simple threshold-based CBM trigger | Event-driven from HI thresholds with dHI/dt acceleration | ❌ Not built |
| **pgTAP tests** | 4 tests (basic CBM trigger) | 60-80 tests for schema, functions, triggers, EFs | ❌ Not built |
| **Feature windows** | No time-window segmentation | FFT windows stored with frequency bands | ❌ Not built |

---

## Recommendation

### Architecture Decision

**Build this as TWO sequential sub-phases within one SDD change:**

**Sub-phase A: Foundation** (Schema + EFs)
1. Create `condition_feature_definitions` (EAV catalog)
2. Create `condition_windows` (FFT time windows)
3. Create `condition_feature_values` (quality-gated readings)
4. Create `condition_events` (event log)
5. Create `ingest-condition` Edge Function (FeatureSet v0.2)
6. Create `ingest-events` Edge Function
7. Define FeatureSet v0.2 TypeScript contract
8. pgTAP tests for foundation

**Sub-phase B: Metrology + HI** (Computation)
1. Create `condition_threshold_catalog` with ISO 10816/20816 seed data
2. Regime classification logic (ingest or compute step)
3. Regime-aware normalization function
4. Quality flag system (G0-G3) with calibration status
5. New `compute_health_index()` — proper HI with ISO zone mapping
6. `compute_degradation_velocity()` — dHI/dt
7. `trg_condition_event_to_wo` — event-driven work order generation
8. pgTAP tests for metrology layer

### Key Design Decisions

| Decision | Option Chosen | Rationale |
|----------|--------------|-----------|
| HI formula | Piecewise linear from ISO zones | Traceable to standards, interpretable, no historical data needed |
| Quality modifier | Multiplicative q_i in [0,1] | Matches Kalman R matrix concepts from Report 4; simple to implement |
| Regime normalization | Regime-classified baseline with load correction factor | No historical data available for learning; standards provide zonal thresholds per regime |
| Threshold storage | Separate catalog table with FK to feature_definitions | Normalized, queryable, seedable with ISO data |
| dHI/dt method | Rolling linear regression | Robust to noise, gives confidence (R²), works with as few as 5 points |
| HI range | Continuous [0,1] | ISO 55000 compliant, maps to 5 discrete action levels for CMMS integration |

### What NOT to do in Phase 1 (defer to Phase 2/3)

- ❌ Kalman filters for sensor fusion → Phase 2
- ❌ RUL prediction → Phase 3
- ❌ Adaptive/learned baselines → Phase 2 (Kalman)
- ❌ FFT processing in the CMMS (edge does FFT, CMMS receives features) → Already architectural
- ❌ Real-time streaming architecture → Edge handles low-latency

---

## Risks

1. **FeatureSet v0.2 contract alignment** — If real IIoT devices send different payloads, we may have contract mismatch. Mitigation: define contract as TypeScript types, validate at Edge Function boundary, reject malformed payloads with clear error messages.

2. **ISO threshold data completeness** — Seeding the full ISO 10816/20816 catalog requires careful data entry. A partial seed (only common machine types: pumps, motors, fans, compressors) is acceptable for MVP. Missing machine types can use conservative defaults.

3. **False alarms from regime misclassification** — If operational context (load_pct, rpm) is unreliable, regime classification will be wrong. Mitigation: require `operational_context` in FeatureSet v0.2, reject payloads without it, and provide default regime mapping for unknown regimes.

4. **Quality gating over-suppression** — Too aggressive G1/G2 modifiers may make HI insensitive to real degradation. Mitigation: conservative defaults (G1 → q=0.8, G2 → q=0.5) with configurable parameters. Monitor fraction of G3 readings as a data quality KPI.

5. **dHI/dt false positives on non-stationary data** — Rollouts, maintenance, or operational changes cause transient HI jumps. Mitigation: require minimum 5 consecutive valid readings in the same regime before computing dHI/dt; ignore windows with regime changes.

6. **pgTAP test complexity** — Edge Function testing requires HTTP-level tests. Mitigation: use pgTAP for database layer only; test Edge Functions with separate integration tests (Deno test suite).

7. **Scope creep** — The "foundation" + "metrology" scope is large for a single change. Risk of mid-change expansion. Mitigation: enforce the two sub-phase structure, deliver Sub-phase A first (schema+EFs), then Sub-phase B (computation). Each sub-phase should be a reviewable PR with its own pgTAP tests.

---

## Ready for Proposal
**Yes** — proceed to proposal. The investigation is complete with clear findings, recommended approach, and risk mitigations. The dual scope (foundation + metrology) is well understood and can be broken into two sequential sub-phases.
