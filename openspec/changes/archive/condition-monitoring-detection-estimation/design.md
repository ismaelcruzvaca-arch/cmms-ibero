# Design: Detection, Adaptive Baselines, Residuals & State Estimation (SDD 3)

## Technical Approach

**SQL-only compute layer + React frontend extension.** All new detection logic lives in PL/pgSQL functions within 2 idempotent migrations. The existing `evaluate_condition_rules()` engine extends with 4 new evaluation types, and `compute_health_index()` gains adaptive zone support. Frontend adds a recharts TrendChart under a new "Tendencias" subtab.

No new Edge Functions — the existing `compute-hi` EF calls the new RPCs.

## Architecture Decisions

### Decision: Baselines as first-class table vs JSONB within analysis_results

| Option | Tradeoff |
|--------|----------|
| Standalone `condition_baselines` table | +Schema-enforced lifecycle, versioning, FK integrity; +RLS granular; +Indexable columns |
| Store in `condition_analysis_results` | −No lifecycle states (no draft/candidate/active/frozen); −No versioning; −Harder to query active baseline per context |
| **Decision** | `condition_baselines` table. Aligns with proposal governance model and auditing requirements. |

### Decision: asset_id type = TEXT (not UUID)

**Choice**: `asset_id TEXT NOT NULL` in condition_baselines, matching assets.id type.
**Rationale**: Existing `assets.id` is `TEXT PRIMARY KEY` (migration `20260501000000`). All other condition tables (`condition_windows`, `condition_events`, `condition_analysis_results`) use `asset_id TEXT`. Consistency avoids type coercion bugs.

### Decision: Kalman 1D state persisted in condition_analysis_results columns + JSONB

**Choice**: Dedicated columns (`state_variance`, `innovation`, `innovation_variance`, `kalman_gain`) for indexable querying, plus JSONB `parameters` for Q/R/method_version.
**Rationale**: REQ-CAR-D3-006 requires column-level storage for efficient queries. JSONB alone would force expensive jsonb_each lookups.

### Decision: recharts for TrendChart

**Choice**: recharts `LineChart` + `ReferenceArea`/`ReferenceLine` for baseline bands.
**Rationale**: Already recommended in proposal; aligns with existing React 19 stack. **Prerequisite**: `npm install recharts` (not currently in package.json).

### Decision: evaluation_type CHECK constraint modified — not dropped

**Choice**: ALTER CHECK constraint to add new types rather than dropping and recreating.
**Rationale**: Dropping a CHECK constraint requires CASCADE. Using `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...` in a DO block with IF EXISTS guard is safer. However, PostgreSQL cannot alter CHECK constraints in place. The migration will drop/add the constraint inside a transaction, ensuring no data loss since existing rows already satisfy the superset.

## Migration Plan

### Migration 1: `20260602110000_condition_baselines.sql`

| Section | Content |
|---------|---------|
| Schema | `condition_baselines` table with all columns, indexes, RLS |
| Bootstrap seed | ~3 baselines (draft) for 2 assets across 2 regimes |

### Migration 2: `20260602110001_condition_detection_functions.sql`

| Section | Content |
|---------|---------|
| ALTER | `condition_analysis_results`: +4 Kalman columns |
| ALTER | `condition_rules`: evaluation_type CHECK extended |
| Function | `is_baseline_learnable()` — gates |
| Function | `compute_baselines()` — rolling stats + EWMA |
| Function | `compute_baseline_residual()` — type A residual |
| Function | `compute_kalman_1d()` — scalar Kalman filter |
| Function | `compute_feature_trend()` — per-feature linear regression |
| Modify | `evaluate_condition_rules()` — 4 new evaluation types |
| Modify | `compute_health_index()` — adaptive zone support |
| Seed data | Bootstrap condition_windows + feature_values (30-50 rows) |
| Seed data | SDD 3 anomaly detection rules (3 seed rules) |

## Schema Design: condition_baselines

```sql
CREATE TABLE IF NOT EXISTS public.condition_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  measurement_point_id TEXT,
  regime TEXT NOT NULL CHECK (regime IN ('STOPPED','STARTUP','IDLE','PARTIAL_LOAD','FULL_LOAD','OVERLOAD')),
  rpm_band TEXT NOT NULL CHECK (rpm_band IN ('0-500','500-1000','1000-1500','1500-2000','2000+')),
  load_band TEXT NOT NULL CHECK (load_band IN ('0-25%','25-50%','50-75%','75-100%')),
  mean DOUBLE PRECISION NOT NULL,
  stddev DOUBLE PRECISION NOT NULL,
  median DOUBLE PRECISION,
  mad DOUBLE PRECISION,
  p95 DOUBLE PRECISION,
  p99 DOUBLE PRECISION,
  sample_count INT NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  baseline_status TEXT NOT NULL DEFAULT 'draft' CHECK (baseline_status IN (
    'draft','candidate','active','frozen','needs_review','deprecated'
  )),
  baseline_version INT NOT NULL DEFAULT 1,
  quality_filter TEXT NOT NULL DEFAULT 'G0' CHECK (quality_filter IN ('G0','G1','G2','G3')),
  created_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_id, feature_definition_id, method_key, measurement_point_id,
         regime, rpm_band, load_band, baseline_version)
);

-- Unique index: only ONE active baseline per context
CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_active_unique
  ON public.condition_baselines(asset_id, feature_definition_id, method_key,
                                COALESCE(measurement_point_id,''), regime, rpm_band, load_band)
  WHERE baseline_status = 'active';
```

**RLS**: `SELECT` → authenticated (all roles), `INSERT/UPDATE/DELETE` → PLANNER/ADMIN.

### Baseline lifecycle transitions

```
draft ───→ candidate ───→ active ───→ frozen
  ↑            ↑              │            │
  │            └──── needs_review ←────────┘
  │                            │
  └───────────────────────→ deprecated
```

## SQL Functions Design

### compute_baselines(p_asset_id TEXT, p_feature_key TEXT DEFAULT NULL, p_method_key TEXT DEFAULT NULL)

**Pseudocode**:
```
FOR EACH (feature_key, method_key, regime, rpm_band, load_band) WITH G0/G1 data:
    IF NOT is_baseline_learnable(asset_id) → skip asset entirely
    FILTER windows: quality_flag IN ('G0','G1')
                   AND source is active/field_trial
                   AND NOT late_data
                   AND NOT during active event
    IF no windows qualify → skip

    -- Existing baseline check
    SELECT active baseline for this context
    IF baseline exists AND status = 'active':
        -- EWMA update
        new_mean = 0.9 * old_mean + 0.1 * new_sample_mean
        new_stddev = SQRT(0.9 * old_var + 0.1 * new_sample_var)
        UPDATE existing baseline SET mean, stddev, sample_count += n, quality_filter
    ELSE:
        -- Fresh calculation
        SELECT AVG(value), STDDEV(value), PERCENTILE_CONT(0.5) etc.
        INSERT new baseline as 'draft' with next baseline_version
```

### is_baseline_learnable(p_asset_id TEXT) RETURNS BOOLEAN

**Pseudocode**:
```
-- Any active event for asset?
IF EXISTS (SELECT 1 FROM condition_events
           WHERE asset_id = p_asset_id AND status IN ('open','linked_to_wo'))
THEN RETURN false;

-- Significant trend active for any feature?
IF EXISTS (SELECT 1 FROM condition_analysis_results
           WHERE asset_id = p_asset_id AND analysis_type = 'trend_slope'
             AND r_squared > 0.5 AND ABS(result_value) > 0.001
             AND window_end > NOW() - INTERVAL '7 days')
THEN RETURN false;

-- Sustained residual? (last 5 windows with z > 2)
IF (SELECT COUNT(*) FROM condition_analysis_results
    WHERE asset_id = p_asset_id AND analysis_type = 'residual'
      AND result_value > 2.0  -- z_score > 2
      AND window_end > NOW() - INTERVAL '7 days') >= 5
THEN RETURN false;

-- Too many G2/G3 in recent windows?
IF (SELECT COUNT(*) FROM condition_feature_values fv
    JOIN condition_windows w ON fv.window_id = w.id
    WHERE w.asset_id = p_asset_id
      AND fv.quality_flag IN ('G2','G3')
      AND w.window_end > NOW() - INTERVAL '7 days') > 10
THEN RETURN false;

RETURN true;
```

### compute_baseline_residual(p_asset_id TEXT, p_window_id UUID DEFAULT NULL)

**Pseudocode**:
```
-- Get the window's regime context
SELECT operational_context->>'regime' INTO v_regime
FROM condition_windows WHERE id = p_window_id;

-- Resolve rpm_band, load_band from window context
v_rpm_band := assign_band(operational_context->>'rpm', 'rpm');
v_load_band := assign_band(operational_context->>'load_pct', 'load');

FOR EACH feature_value in this window:
    -- Find matching baseline (active), fallback to nearest regime if missing
    SELECT mean, stddev, baseline_version INTO v_bl
    FROM condition_baselines
    WHERE asset_id = p_asset_id
      AND feature_definition_id = fv.feature_definition_id
      AND method_key = fv.method_key
      AND regime = v_regime
      AND rpm_band = v_rpm_band
      AND load_band = v_load_band
      AND baseline_status = 'active';

    IF NOT FOUND THEN
        -- Fallback: nearest regime by euclidean distance
        SELECT mean, stddev, baseline_version INTO v_bl
        FROM condition_baselines
        WHERE asset_id = p_asset_id
          AND feature_definition_id = fv.feature_definition_id
          AND method_key = fv.method_key
          AND baseline_status = 'active'
        ORDER BY normalized_rpm_distance + normalized_load_distance
        LIMIT 1;
        v_approximate := true;
    END IF;

    v_residual := fv.value - v_bl.mean;
    v_z_score := v_residual / NULLIF(GREATEST(v_bl.stddev, 0.01), 0);
    v_deviation := CASE WHEN ABS(v_z_score) < 2 THEN 'normal'
                        WHEN ABS(v_z_score) < 3 THEN 'warning'
                        ELSE 'critical' END;

    INSERT INTO condition_analysis_results (
      asset_id, feature_definition_id, analysis_type, method_key, method_version,
      parameters, result_value, result_unit, confidence,
      window_end, input_window_ids, validation_status
    ) VALUES (
      p_asset_id, fv.feature_definition_id, 'residual', 'adaptive_baseline', '1.0.0',
      jsonb_build_object('residual_type','A','deviation_level',v_deviation,
                         'baseline_mean',v_bl.mean,'baseline_stddev',v_bl.stddev,
                         'baseline_version',v_bl.baseline_version,
                         'regime',v_regime,'approximate',v_approximate,
                         'z_score',v_z_score,'residual',v_residual),
      v_z_score, 'z_score',
      CASE v_deviation WHEN 'normal' THEN 0.9 WHEN 'warning' THEN 0.7 ELSE 0.5 END,
      v_window_end, ARRAY[p_window_id], 'active'
    );
```

### compute_kalman_1d(p_asset_id TEXT, p_feature_key TEXT, p_Q NUMERIC DEFAULT 0.01, p_R NUMERIC DEFAULT 1.0)

**Pseudocode**:
```
-- Get method defaults if Q/R not provided
SELECT default_parameters->>'kalman_q', default_parameters->>'kalman_r'
INTO v_q, v_r
FROM condition_analysis_methods WHERE method_key = 'kalman_filter';
v_q := COALESCE(p_Q, v_q::NUMERIC, 0.01);
v_r := COALESCE(p_R, v_r::NUMERIC, 1.0);

-- Get last state from previous kalman_state result
SELECT result_value AS x_prev,
       (parameters->>'state_variance')::NUMERIC AS p_prev
FROM condition_analysis_results
WHERE asset_id = p_asset_id
  AND feature_definition_id = fd.id
  AND analysis_type = 'kalman_state'
ORDER BY window_end DESC LIMIT 1;

IF NOT FOUND THEN
    -- Initialize: try baseline mean, else first measurement
    x_prev := COALESCE(baseline_mean, first_measurement);
    p_prev := v_r;  -- Initial uncertainty = measurement noise
END IF;

FOR EACH measurement z in time order:
    -- PREDICT (constant velocity model: x stays same, P grows by Q)
    x_pred := x_prev;
    p_pred := p_prev + v_q;

    -- UPDATE
    innovation := z - x_pred;
    innovation_variance := p_pred + v_r;
    kalman_gain := p_pred / NULLIF(innovation_variance, 0);
    x_est := x_pred + kalman_gain * innovation;
    p_est := (1 - kalman_gain) * p_pred;
    confidence := 1 - p_est / NULLIF(p_est + v_r, 0);

    INSERT INTO condition_analysis_results (
      asset_id, feature_definition_id, analysis_type, method_key, method_version,
      result_value, parameters, confidence, window_end, validation_status,
      state_variance, innovation, innovation_variance, kalman_gain
    ) VALUES (
      p_asset_id, fd.id, 'kalman_state', 'kalman_filter', '1.0.0',
      x_est,
      jsonb_build_object('Q',v_q,'R',v_r,'method_version','1.0'),
      confidence, v_window_end, 'active',
      p_est, innovation, innovation_variance, kalman_gain
    );

    x_prev := x_est;
    p_prev := p_est;
```

### compute_feature_trend(p_asset_id TEXT, p_feature_key TEXT, p_method_key TEXT DEFAULT NULL, p_lookback INT DEFAULT 20)

**Pseudocode**:
```
-- Get last N feature_values for this asset+feature
-- Check gates first:
-- 1. < 5 samples → return NULL
-- 2. Regime mix > 1 distinct regime → skip
-- 3. >50% G2/G3 → skip

SELECT COUNT(*), COUNT(DISTINCT operational_context->>'regime')
INTO v_count, v_regimes
FROM condition_feature_values fv
JOIN condition_windows w ON fv.window_id = w.id
JOIN condition_feature_definitions fd ON fv.feature_definition_id = fd.id
WHERE w.asset_id = p_asset_id AND fd.feature_key = p_feature_key
  AND (p_method_key IS NULL OR fv.method_key = p_method_key)
ORDER BY w.window_end DESC LIMIT p_lookback;

IF v_count < 5 OR v_regimes > 1 THEN RETURN; END IF;
IF pct_g2g3 > 50 THEN RETURN; END IF;

-- Linear regression using PostgreSQL aggregates
SELECT regr_slope(fv.value, EXTRACT(EPOCH FROM w.window_end)),
       regr_intercept(fv.value, EXTRACT(EPOCH FROM w.window_end)),
       regr_r2(fv.value, EXTRACT(EPOCH FROM w.window_end)),
       COUNT(*)
INTO v_slope, v_intercept, v_r2, v_n
FROM ... (same CTE);

-- Regime consistency
v_consistency := max_regime_count / v_n;
IF v_consistency < 0.8 THEN RETURN; END IF;

-- Store
INSERT INTO condition_analysis_results (
  asset_id, feature_definition_id, analysis_type, method_key, method_version,
  result_value, result_unit, r_squared, confidence,
  parameters, window_end, validation_status
) VALUES (
  p_asset_id, fd.id, 'trend_slope', 'linear_regression', '1.0.0',
  v_slope * 86400, -- convert to /day
  fd.unit || '/day',
  v_r2,
  CASE WHEN v_r2 >= 0.3 THEN 0.8 ELSE 0.0 END,
  jsonb_build_object('slope_raw',v_slope,'intercept',v_intercept,
                     'sample_count',v_n,'regime_consistency',v_consistency,
                     'lookback_windows',p_lookback),
  v_window_end, 'active'
);
```

## Evaluate Rules Extension

### Extend evaluation_type CHECK

```sql
-- Extend CHECK in a DO block (idempotent)
ALTER TABLE public.condition_rules DROP CONSTRAINT IF EXISTS condition_rules_evaluation_type_check;
ALTER TABLE public.condition_rules ADD CONSTRAINT condition_rules_evaluation_type_check
  CHECK (evaluation_type IN (
    'threshold','trend','compound','residual',
    'z_score_threshold','innovation_threshold','trend_significance','compound_anomaly'
  ));
```

### New evaluation logic inside evaluate_condition_rules()

**evaluation_type = 'z_score_threshold'**:
```
-- Read latest residual results for this feature
SELECT result_value AS z_score, parameters->>'deviation_level'
FROM condition_analysis_results
WHERE asset_id = p_asset_id
  AND feature_definition_id = fd.id
  AND analysis_type = 'residual'
  AND method_key = 'adaptive_baseline'
ORDER BY window_end DESC
LIMIT v_duration;

-- Count consecutive windows with z_score >= min_z_score
IF consecutive_count >= duration_windows THEN
    condition_met := true;
END IF;
```

**evaluation_type = 'innovation_threshold'**:
```
-- Read latest kalman_state results
SELECT innovation, innovation_variance
FROM condition_analysis_results
WHERE asset_id = p_asset_id
  AND analysis_type = 'kalman_state'
ORDER BY window_end DESC
LIMIT v_duration;

-- Check if |innovation| > min_innovation_sigma * SQRT(innovation_variance) for N consecutive windows
```

**evaluation_type = 'trend_significance'**:
```
SELECT result_value AS slope, r_squared, confidence
FROM condition_analysis_results
WHERE asset_id = p_asset_id
  AND feature_definition_id = fd.id
  AND analysis_type = 'trend_slope'
ORDER BY window_end DESC LIMIT 1;

IF confidence > 0.5 AND r_squared >= min_r_squared AND ABS(slope) >= min_slope_abs THEN
    condition_met := true;
END IF;
```

**evaluation_type = 'compound_anomaly'**:
Reuses `evaluate_compound_conditions()` pattern but checks against z_score_threshold + trend_significance + innovation_threshold sub-evaluations.

### Explainability

Event `message` stores JSONB structure:
```json
{
  "feature_key": "vibration.rms",
  "deviation_type": "z_score",
  "deviation_value": 3.5,
  "baseline_version": 2,
  "rule_name": "RMS Z>3 Sostenido",
  "regime": "FULL_LOAD",
  "approximate": false,
  "source_window_ids": ["uuid-1","uuid-2","uuid-3"],
  "additional_context": {
    "deviation_level": "critical",
    "z_scores": [3.2, 3.5, 3.1],
    "duration_windows": 3
  }
}
```

`condition_event_sources` INSERT includes:
- `analysis_result_id` → residual/kalman_state/trend_slope result IDs
- New column: `contribution_type TEXT CHECK (IN ('primary','contributing','contextual'))`

## Adaptive HI Logic

### compute_health_index() extension

Add parameter: `p_zone_source TEXT DEFAULT 'iso'`

```
IF p_zone_source = 'adaptive' THEN
    -- Find active baseline for this (asset, feature, method, regime)
    SELECT mean, stddev INTO v_bl
    FROM condition_baselines
    WHERE asset_id = p_asset_id
      AND feature_definition_id = rec.feature_definition_id
      AND method_key = rec.method_key
      AND regime = v_regime
      AND baseline_status = 'active';

    IF FOUND AND v_bl.sample_count >= 30 THEN
        zone_a_max := v_bl.mean + 1 * v_bl.stddev;
        zone_b_max := v_bl.mean + 2 * v_bl.stddev;
        zone_c_max := v_bl.mean + 3 * v_bl.stddev;
    ELSE
        -- Fallback to ISO
        zone_a_max := v_thr.zone_a_max;
        -- ... mark fallback in metadata
    END IF;
END IF;
```

### Threshold resolution precedence (REQ-CTHR-D3-005)

New helper function `get_applicable_thresholds()` implements:
1. Check `condition_baselines` active with `sample_count >= 30` for this (asset, feature, method, regime)
2. If found → return adaptive thresholds (mean+1σ, +2σ, +3σ)
3. If not found → fallback to `condition_threshold_catalog` ISO thresholds
4. Metadata includes `threshold_source` ('baseline'|'iso') and `baseline_version`

## Bootstrap Seed Data Design

### Assets for seed data
Referenced by TEXT id (no real FK — existing condition tables use TEXT asset_id):
- `BANDA-TR-01` — Transportadora (centrifugal_pump class)
- `TOS-MOT-01` — Motor de tostador (electric_motor class)

### Condition windows (30-50 rows)

| Pattern | Windows | Description |
|---------|---------|-------------|
| Normal operation (FULL_LOAD) | 20 | vibration.rms ~2.3±0.3, quality G0 |
| Normal operation (PARTIAL_LOAD) | 10 | vibration.rms ~1.8±0.2, quality G0 |
| Gradual degradation | 10 | vibration.rms 2.3→3.0 over 10 windows (linear drift) |
| Step change | 3 | vibration.rms jumps from 2.5→4.0, then stays high |
| G2/G3 quality | 4 | Mix of G2 and G3 flags (tests learning policy) |
| Mixed G0/G1 quality | 3 | Some G1 in otherwise G0 series |

### Feature values per window
At minimum: `vibration.rms`, `temperature.bearing`. Use `rms_velocity_window` / `window_average` as method_key.

### Baselines (seed)
3 baselines inserted as `draft`:
1. BANDA-TR-01, vibration.rms, rms_velocity_window, FULL_LOAD (mean=2.3, std=0.4)
2. BANDA-TR-01, vibration.rms, rms_velocity_window, PARTIAL_LOAD (mean=1.8, std=0.3)
3. TOS-MOT-01, vibration.rms, rms_velocity_window, FULL_LOAD (mean=1.4, std=0.3)

### Seed rules (3 INSERTs)
1. `RMS Z>3 Sostenido` — z_score_threshold, min_z_score=3.0, duration_windows=3, severity=warning
2. `RMS Innovación Alta` — innovation_threshold, min_innovation_sigma=3.0, duration_windows=3, severity=warning
3. `RMS Tendencia Significativa` — trend_significance, min_r_squared=0.5, min_slope_abs=0.01, severity=warning

## Frontend Design

### TrendChart component (`src/components/condition/TrendChart.jsx`)

**Props**: `assetId`, `featureKey`, `methodKey` (optional), `days` (default 30)

**Renders** (recharts):
- `LineChart` with time X-axis, value Y-axis
- `ReferenceArea` for baseline bands: mean±1σ (green/#4caf50), ±2σ (yellow/#ff9800), ±3σ (red/#f44336)
- `ReferenceLine` at z=2 (orange dashed) and z=3 (red dashed) threshold lines
- `Line` for feature_value time-series (blue)
- `Scatter` for event markers (red X at event timestamps)
- Custom tooltip showing regime, quality_flag, z-score

**Date selector**: 7d / 30d / 90d buttons at top.

### TrendChart empty state
- No baseline → show feature line only with note "Sin línea base disponible"
- No data → "Sin datos de condición para este activo"

### useFeatureTrends hook (`src/hooks/useFeatureTrends.js`)

**Returns**: `{ featureValues, baseline, events, residuals, loading, error }`

**Queries**:
```sql
-- feature values
SELECT fv.*, w.window_end, w.operational_context
FROM condition_feature_values fv
JOIN condition_windows w ON fv.window_id = w.id
WHERE w.asset_id = $1 AND fv.feature_definition_id = $2
ORDER BY w.window_end DESC LIMIT 90;

-- active baseline
SELECT * FROM condition_baselines
WHERE asset_id = $1 AND feature_definition_id = $2
  AND baseline_status = 'active';

-- events for timeline
SELECT * FROM condition_events
WHERE asset_id = $1 ORDER BY created_at;
```

### App.jsx — "Tendencias" subtab

Add after "Dead-Letter" tab:
```jsx
<Tab label="Tendencias" />
```

In the conditional render section, add case for the new subtab index:
```jsx
if (conditionSubTab === tendenciasIdx) return <TrendChart assetId={...} />;
```

This requires updating the computed index logic to account for the new tab.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260602110000_condition_baselines.sql` | Create | `condition_baselines` table + indexes + RLS + seed data |
| `supabase/migrations/20260602110001_condition_detection_functions.sql` | Create | All compute functions + evaluate_rules extension + bootstrap seed |
| `src/components/condition/TrendChart.jsx` | Create | recharts TrendChart with baseline bands, event markers |
| `src/hooks/useFeatureTrends.js` | Create | Supabase queries for trend data |
| `src/App.jsx` | Modify | +1 subtab "Tendencias" in Monitoreo de Condición |
| `package.json` | Modify | Add `recharts` dependency |
| `supabase/tests/database/condition_baselines_detection_test.sql` | Create | ~60 pgTAP assertions |
| `src/**/*.test.jsx` | Create | Vitest tests for TrendChart + useFeatureTrends |

## Testing Strategy

### pgTAP: `condition_baselines_detection_test.sql` (~60 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema | 10 | Table exists, columns, CHECK constraints, indexes, RLS policies |
| Baseline lifecycle | 8 | INSERT draft, promote to candidate/active, versioning |
| Learning policy gates | 12 | G2/G3 excluded, active event blocks, trend blocks, residual blocks |
| compute_baselines | 8 | Stats calculated correctly, EWMA update, regime-aware |
| compute_baseline_residual | 6 | z-score correct, stddev=0 guard, approximate flag, deviation levels |
| compute_kalman_1d | 6 | State converges, innovation tracks drift, Q/R configurable |
| compute_feature_trend | 6 | Gates: <5 samples, mixed regime, G2/G3 >50%, R² confidence |
| evaluate_condition_rules | 4 | z_score_threshold fires, trend_significance fires, R² low blocks |
| No regression | 0 | Skipped — existing 542 assertions untouched |

### Vitest (frontend)

| Test | What |
|------|------|
| TrendChart renders with data | Baseline bands, feature line, event markers visible |
| TrendChart empty state | Shows "Sin línea base disponible" |
| useFeatureTrends | Returns correct shape, loads data from Supabase mock |

## Open Questions

- [ ] **recharts not in package.json** — needs `npm install recharts` before frontend work. Verify version compatibility with React 19.
- [ ] **`condition_event_sources.analysis_result_id`** — FK to `condition_analysis_results` exists only as UUID nullable. Should the migration add the formal FK? Current code checks for it in PR 2a migration but it's never finalized.
- [ ] **`contribution_type` column** for `condition_event_sources` — needed for explainability REQ-DEXP-002. Must be added via ALTER TABLE. Is there a risk of breaking existing views?
- [ ] **Kalman initialization** — if no baseline exists for an asset+feature, the Kalman initial state could use the first available measurement. Need to confirm this edge case handling.
- [ ] **Rebaseline post-maintenance** trigger — the proposal mentions detecting OT closure with `intervention_type='bearing_replacement'`. This requires a trigger on `work_orders` or polling. SSDD 3 is SQL-only, so this may be deferred.
