# Design: Diagnostics, Degradation Models & Prognostics (SDD 4)

## Technical Approach

**Diagnostic SQL engine + cross-referenced FMEA.** All new logic lives in PL/pgSQL within 2 idempotent migrations. SDD 3's `evaluate_condition_rules()` extends with `evaluation_type = 'diagnostic'` that loads `diagnostic_evidence_matrix` patterns instead of thresholds, calls `compute_diagnosis_confidence()` for multi-factor scoring, and inserts into `condition_diagnoses` (NOT `condition_events`). RUL uses linear extrapolation from `compute_feature_trend()` results with gates (R² ≥ 0.5, samples ≥ 10, slope > 0). Maintenance recommendations are generated from diagnosis + confidence + PF-curves. FMEA in RxDB remains authoritative — `fmea_cbm_cross_reference` bridges domains.

No new Edge Functions. React adds DiagnosisPanel, RulGauge, RecommendationCard under a new "Diagnóstico" subtab.

## Architecture Decisions

### Decision: degradation_models catalog → skip for MVP

| Option | Tradeoff |
|--------|----------|
| Dedicated `condition_degradation_models` table | +Schema-enforced model registry; —No consumer yet (RUL uses linear_extrapolation hardcoded) |
| Inline in `compute_rul_linear()` with parameters JSONB | +Simplicity; —Harder to extend to Weibull/Gamma later |
| **Decision** | Omit `condition_degradation_models` table in SDD 4. RUL uses `linear_extrapolation` method_key referencing `condition_analysis_methods`. Model catalog deferred to SDD 5 or when second model type is needed. |

### Decision: diagnosis_feedback_loop → minimal columns in condition_diagnoses

| Option | Tradeoff |
|--------|----------|
| Separate feedback table | +Normalized; —Over-engineered for MVP (single FK, few columns) |
| Columns in `condition_diagnoses` + linked WO | +Simpler queries; —Mixes feedback with diagnosis state |
| **Decision** | Feedback stored on `condition_diagnoses` as `linked_work_order_id` + `feedback_status` TEXT CHECK (confirmed/rejected/partial) + `feedback_notes`. A separate table only if feedback needs versioning/multiple evaluations. |

### Decision: condition_analysis_results stores RUL (not a separate table)

**Choice**: `condition_analysis_results` already has `analysis_type = 'rul_estimate'` in its CHECK constraint. RUL results reuse this table with dedicated columns (`result_value`, `parameters JSONB`, `confidence`, `r_squared`).
**Rationale**: Zero new tables for RUL. The existing `condition_analysis_results` schema supports `rul_estimate` type with full metadata in `parameters`. Only the `result_unit` and `confidence` columns are needed.

### Decision: asset_class TEXT (not FK) in failure_mode_catalog

**Choice**: `asset_class TEXT NOT NULL` matching the pattern from `condition_baselines` and `condition_threshold_catalog`.
**Rationale**: `asset_class` is a TEXT classification across the condition domain, not a formal FK. All existing condition tables use `asset_id TEXT` and `asset_class TEXT` without FK constraints, keeping the schema flexible for multi-source asset data.

### Decision: severity_default as TEXT CHECK (not INT)

**Choice**: `severity_default TEXT CHECK (low/medium/high/critical)` matching existing `condition_events.severity` domain.
**Rationale**: The proposal specified INT 1-5, but the existing codebase uses TEXT severity everywhere (`info/warning/critical`). Consistency with `condition_events` avoids type conversion bugs. A scoring function can map TEXT↔INT for RPN calculations.

## Migration Plan

### Migration 1: `YYYYMMDDHHMMSS_condition_diagnostic_catalogs.sql`

| Section | Content |
|---------|---------|
| Schema | `condition_failure_mode_catalog`, `fmea_cbm_cross_reference`, `diagnostic_evidence_matrix`, `condition_pf_curves` |
| Indexes | All PK, FK, and search indexes |
| RLS | SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN |
| Seed | ≥10 failure modes, ≥3 cross-references, ≥2 evidence matrix patterns, ≥3 PF-curves |

### Migration 2: `YYYYMMDDHHMMSS_condition_diagnostic_functions.sql`

| Section | Content |
|---------|---------|
| Schema | `condition_diagnoses`, `maintenance_recommendations` |
| ALTER | `condition_events`: +diagnosis_id FK, +failure_mode_id FK |
| ALTER | `condition_rules`: evaluation_type CHECK extended with 'diagnostic' |
| Function | `compute_diagnosis_confidence()` — multi-factor scoring |
| Function | `compute_rul_linear()` — linear extrapolation with gates |
| Function | `generate_recommendation()` — recommendation from diagnosis |
| Function | `get_intervention_window()` — PF-curve helper |
| Modify | `evaluate_condition_rules()` — 'diagnostic' evaluation type |
| Modify | `trg_condition_event_to_wo_func()` — diagnosis field_trial gate |
| Seed | 2 diagnostic seed rules |

## Schema Design

### condition_failure_mode_catalog

```sql
CREATE TABLE IF NOT EXISTS public.condition_failure_mode_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_mode_key TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  failure_mechanism TEXT,
  typical_causes TEXT[] DEFAULT '{}',
  typical_effects TEXT[] DEFAULT '{}',
  severity_default TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity_default IN ('low', 'medium', 'high', 'critical')),
  detectability TEXT NOT NULL DEFAULT 'medium'
    CHECK (detectability IN ('easy', 'medium', 'hard')),
  iso14224_taxonomy_ref TEXT,
  fmea_ref TEXT,
  validation_status TEXT NOT NULL DEFAULT 'seed'
    CHECK (validation_status IN ('draft', 'seed', 'bench_validated', 'field_validated', 'superseded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(failure_mode_key)
);

COMMENT ON TABLE public.condition_failure_mode_catalog
  IS 'Catálogo CBM de modos de falla por asset_class. Separado del FMEA de diseño en RxDB.';

CREATE INDEX IF NOT EXISTS idx_fmc_asset_class
  ON public.condition_failure_mode_catalog(asset_class);

CREATE INDEX IF NOT EXISTS idx_fmc_validation
  ON public.condition_failure_mode_catalog(validation_status);
```

**Seed data** (≥10 modes):

| failure_mode_key | asset_class | severity_default | detectability |
|---|---|---|---|
| `pump.cavitation` | centrifugal_pump | critical | medium |
| `rotating.misalignment` | centrifugal_pump | high | medium |
| `rotating.unbalance` | centrifugal_pump | high | easy |
| `bearing.outer_race` | centrifugal_pump | high | medium |
| `bearing.inner_race` | electric_motor | high | hard |
| `impeller.damage` | centrifugal_pump | critical | medium |
| `seal.leakage` | centrifugal_pump | high | easy |
| `electrical.stator_fault` | electric_motor | critical | hard |
| `sensor.stuck` | sensor | high | easy |
| `sensor.drift` | sensor | medium | hard |

### fmea_cbm_cross_reference

```sql
CREATE TABLE IF NOT EXISTS public.fmea_cbm_cross_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id) ON DELETE CASCADE,
  fmea_failure_mode_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL
    CHECK (relationship_type IN ('same_as', 'related_to', 'evidence_for', 'supersedes', 'unknown')),
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(condition_failure_mode_id, fmea_failure_mode_id)
);

COMMENT ON TABLE public.fmea_cbm_cross_reference
  IS 'Puente entre modos de falla CBM (PostgreSQL) y FMEA (RxDB). Sin migración completa de FMEA.';

CREATE INDEX IF NOT EXISTS idx_fmea_cross_condition
  ON public.fmea_cbm_cross_reference(condition_failure_mode_id);

CREATE INDEX IF NOT EXISTS idx_fmea_cross_fmea
  ON public.fmea_cbm_cross_reference(fmea_failure_mode_id);
```

**Seed**: 3+ cross-references linking pump.cavitation, rotating.misalignment, bearing.outer_race to existing RxDB FMEA failure modes (keys like `FMEA-001` — confirmed during seed INSERT).

### diagnostic_evidence_matrix

```sql
CREATE TABLE IF NOT EXISTS public.diagnostic_evidence_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  condition_type TEXT NOT NULL DEFAULT 'threshold'
    CHECK (condition_type IN ('threshold', 'residual', 'trend')),
  evidence_role TEXT NOT NULL DEFAULT 'supporting'
    CHECK (evidence_role IN ('required', 'supporting', 'contradictory')),
  op TEXT NOT NULL DEFAULT '>'
    CHECK (op IN ('>', '>=', '<', '<=', '=', 'between')),
  value_low NUMERIC,
  value_high NUMERIC,
  logical_operator TEXT DEFAULT 'AND'
    CHECK (logical_operator IN ('AND', 'OR')),
  min_quality TEXT DEFAULT 'G2'
    CHECK (min_quality IN ('G0', 'G1', 'G2', 'G3')),
  min_confidence NUMERIC DEFAULT 0.0 CHECK (min_confidence >= 0 AND min_confidence <= 1),
  required_regime TEXT,
  window_count INT DEFAULT 1,
  weight NUMERIC DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.diagnostic_evidence_matrix
  IS 'Patrones de evidencia multi-feature para cada modo de falla. Soporta required/supporting/contradictory evidence.';

CREATE INDEX IF NOT EXISTS idx_dem_failure_mode
  ON public.diagnostic_evidence_matrix(failure_mode_id);

CREATE INDEX IF NOT EXISTS idx_dem_feature
  ON public.diagnostic_evidence_matrix(feature_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dem_fm_feature_role_unique
  ON public.diagnostic_evidence_matrix(failure_mode_id, feature_key, evidence_role, op, COALESCE(value_low, 0));
```

**Seed**: ≥2 complete patterns (e.g., pump.cavitation with vibration.rms high + pressure.discharge low as required, temperature.steady as supporting, flow.normal as contradictory).

### condition_diagnoses

```sql
CREATE TABLE IF NOT EXISTS public.condition_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id),
  diagnosis_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (diagnosis_status IN ('candidate', 'field_trial', 'active', 'confirmed', 'rejected', 'superseded')),
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  evidence_summary JSONB DEFAULT '{}',
  supporting_result_ids UUID[] DEFAULT '{}',
  contradictory_result_ids UUID[] DEFAULT '{}',
  source_window_ids UUID[] DEFAULT '{}',
  linked_event_id UUID REFERENCES public.condition_events(id) ON DELETE SET NULL,
  linked_work_order_id UUID,
  feedback_status TEXT
    CHECK (feedback_status IN ('confirmed', 'rejected', 'partial')),
  feedback_notes TEXT,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_diagnoses
  IS 'Diagnósticos de condición — hipótesis de falla con evidencia, confianza y trazabilidad. Separada de condition_events.';

CREATE INDEX IF NOT EXISTS idx_diag_asset ON public.condition_diagnoses(asset_id);
CREATE INDEX IF NOT EXISTS idx_diag_status ON public.condition_diagnoses(diagnosis_status);
CREATE INDEX IF NOT EXISTS idx_diag_fm ON public.condition_diagnoses(failure_mode_id);
CREATE INDEX IF NOT EXISTS idx_diag_event ON public.condition_diagnoses(linked_event_id);
```

**RLS**: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN. Matches `condition_baselines` pattern.

### condition_pf_curves

```sql
CREATE TABLE IF NOT EXISTS public.condition_pf_curves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class TEXT NOT NULL,
  failure_mode_key TEXT NOT NULL,
  potential_failure_point TEXT,
  functional_failure_point TEXT,
  pf_interval_days INTEGER NOT NULL CHECK (pf_interval_days > 0),
  inspection_interval_days INTEGER CHECK (inspection_interval_days > 0),
  intervention_window_days INTEGER CHECK (intervention_window_days > 0),
  confidence NUMERIC DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  validation_status TEXT DEFAULT 'seed'
    CHECK (validation_status IN ('draft', 'seed', 'bench_validated', 'field_validated', 'superseded')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(asset_class, failure_mode_key)
);

COMMENT ON TABLE public.condition_pf_curves
  IS 'Curvas P-F que definen intervalos entre detección potencial (P) y falla funcional (F) por asset_class + failure_mode.';

CREATE INDEX IF NOT EXISTS idx_pf_asset_class ON public.condition_pf_curves(asset_class);
CREATE INDEX IF NOT EXISTS idx_pf_fm ON public.condition_pf_curves(failure_mode_key);
```

**Seed**: bearing.outer_race (30d), rotating.misalignment (60d), pump.cavitation (14d).

### maintenance_recommendations

```sql
CREATE TABLE IF NOT EXISTS public.maintenance_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID NOT NULL REFERENCES public.condition_diagnoses(id) ON DELETE CASCADE,
  recommended_action TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_window_days INTEGER,
  work_order_type TEXT DEFAULT 'CBM'
    CHECK (work_order_type IN ('CBM', 'PM', 'CM', 'INSPECTION')),
  required_parts JSONB DEFAULT '[]',
  required_skills TEXT[] DEFAULT '{}',
  requires_confirmation BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.maintenance_recommendations
  IS 'Recomendaciones de mantenimiento generadas desde diagnóstico + confianza + RUL + PF-curva + criticidad.';

CREATE INDEX IF NOT EXISTS idx_mr_diag ON public.maintenance_recommendations(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_mr_priority ON public.maintenance_recommendations(priority);
```

## SQL Functions

### compute_diagnosis_confidence(p_asset_id, p_failure_mode_key)

```sql
CREATE OR REPLACE FUNCTION public.compute_diagnosis_confidence(
  p_asset_id TEXT,
  p_failure_mode_key TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fm_id UUID;
  v_total_evidence INT;
  v_matching_evidence INT;
  v_required_total INT;
  v_required_met INT;
  v_contradictory_total INT;
  v_contradictory_matched INT;
  v_quality_sum NUMERIC := 0;
  v_quality_count INT := 0;
  v_evidence_present_ratio NUMERIC;
  v_required_met_ratio NUMERIC;
  v_contradictory_neg NUMERIC;
  v_quality_mod NUMERIC;
  v_final_confidence NUMERIC;
  rec RECORD;
BEGIN
  -- Resolver failure_mode_id
  SELECT id INTO v_fm_id
  FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = p_failure_mode_key;

  IF v_fm_id IS NULL THEN
    RETURN 0.0;
  END IF;

  -- Cargar evidencia de la matriz
  FOR rec IN
    SELECT dem.*, cfv.value, cfv.quality_flag, cfv.confidence AS fv_confidence
    FROM public.diagnostic_evidence_matrix dem
    LEFT JOIN LATERAL (
      SELECT cfv.value, cfv.quality_flag, cfv.confidence
      FROM public.condition_feature_values cfv
      JOIN public.condition_windows cw ON cfv.window_id = cw.id
      JOIN public.condition_feature_definitions cfd ON cfv.feature_definition_id = cfd.id
      WHERE cw.asset_id = p_asset_id
        AND cfd.feature_key = dem.feature_key
        AND (dem.required_regime IS NULL
             OR cw.operational_context->>'regime' = dem.required_regime)
      ORDER BY cw.window_end DESC
      LIMIT 1
    ) cfv ON true
    WHERE dem.failure_mode_id = v_fm_id
  LOOP
    v_total_evidence := v_total_evidence + 1;

    IF rec.value IS NOT NULL THEN
      -- Evaluar condición contra el feature_value
      -- (reusa lógica de operadores de evaluate_compound_conditions)
      IF (rec.op = '>' AND rec.value > rec.value_low)
         OR (rec.op = '>=' AND rec.value >= rec.value_low)
         OR (rec.op = '<' AND rec.value < rec.value_low)
         OR (rec.op = '<=' AND rec.value <= rec.value_low)
         OR (rec.op = 'between'
             AND rec.value >= rec.value_low
             AND rec.value <= rec.value_high)
      THEN
        IF rec.evidence_role = 'contradictory' THEN
          v_contradictory_matched := v_contradictory_matched + 1;
        ELSE
          v_matching_evidence := v_matching_evidence + 1;
          IF rec.evidence_role = 'required' THEN
            v_required_met := v_required_met + 1;
          END IF;
        END IF;

        -- Quality modifier (G0=1.0, G1=0.8, G2=0.5, G3=0.0)
        v_quality_sum := v_quality_sum + CASE rec.quality_flag
          WHEN 'G0' THEN 1.0 WHEN 'G1' THEN 0.8
          WHEN 'G2' THEN 0.5 WHEN 'G3' THEN 0.0 ELSE 0.0 END;
        v_quality_count := v_quality_count + 1;
      END IF;
    END IF;

    IF rec.evidence_role = 'required' THEN
      v_required_total := v_required_total + 1;
    END IF;

    IF rec.evidence_role = 'contradictory' THEN
      v_contradictory_total := v_contradictory_total + 1;
    END IF;
  END LOOP;

  -- Si no hay evidencia definida, confianza 0
  IF v_total_evidence = 0 THEN
    RETURN 0.0;
  END IF;

  -- Evidence present ratio (weight: 0.4)
  v_evidence_present_ratio := v_matching_evidence::NUMERIC / NULLIF(v_total_evidence, 0);

  -- Required evidence met (weight: 0.3) — ALL required must match, else 0
  IF v_required_total > 0 AND v_required_met < v_required_total THEN
    v_required_met_ratio := 0.0;
  ELSE
    v_required_met_ratio := 1.0;
  END IF;

  -- Contradictory penalty (weight: 0.3)
  -- Each contradictory MATCHED evidence multiplies down
  -- Missing contradictory evidence does NOT penalize
  v_contradictory_neg := CASE
    WHEN v_contradictory_matched = 0 THEN 1.0
    ELSE POWER(0.5, v_contradictory_matched)
  END;

  -- Quality modifier (AVG across matched features only)
  v_quality_mod := CASE
    WHEN v_quality_count > 0 THEN v_quality_sum / v_quality_count
    ELSE 1.0  -- No quality data → no penalty
  END;

  -- Final score
  v_final_confidence := (
    v_evidence_present_ratio * 0.4
    + v_required_met_ratio * 0.3
    + v_contradictory_neg * 0.3
  ) * v_quality_mod;

  RETURN GREATEST(0.0, LEAST(1.0, v_final_confidence));
END;
$$;

COMMENT ON FUNCTION public.compute_diagnosis_confidence(TEXT, TEXT)
  IS 'Calcula confianza diagnóstica multi-factor: evidence_present_ratio (0.4) + required_met (0.3) + contradictory_neg (0.3) * quality_mod. Missing evidence NO penaliza.';
```

### compute_rul_linear(p_asset_id, p_feature_key, p_failure_mode_key)

```sql
CREATE OR REPLACE FUNCTION public.compute_rul_linear(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_failure_mode_key TEXT
) RETURNS UUID  -- returns analysis_result_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fd_id UUID;
  v_trend RECORD;
  v_threshold RECORD;
  v_rul NUMERIC;
  v_rul_low NUMERIC;
  v_rul_high NUMERIC;
  v_confidence NUMERIC;
  v_diag_confidence NUMERIC;
  v_unit TEXT;
  v_ar_id UUID;
  v_current_value NUMERIC;
  v_slope_per_day NUMERIC;
BEGIN
  -- Resolver feature_definition_id
  SELECT id, unit INTO v_fd_id, v_unit
  FROM public.condition_feature_definitions
  WHERE feature_key = p_feature_key;

  IF v_fd_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Gate 1: latest trend_slope with R² ≥ 0.5
  SELECT result_value, r_squared, confidence,
         (parameters->>'sample_count')::INT AS sample_count
  INTO v_trend
  FROM public.condition_analysis_results
  WHERE asset_id = p_asset_id
    AND feature_definition_id = v_fd_id
    AND analysis_type = 'trend_slope'
    AND method_key = 'linear_regression'
    AND r_squared >= 0.5
    AND result_value IS NOT NULL
  ORDER BY window_end DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;  -- Gate: no significant trend
  END IF;

  -- Gate 2: samples ≥ 10
  IF v_trend.sample_count < 10 THEN
    RETURN NULL;
  END IF;

  v_slope_per_day := v_trend.result_value;  -- already in units/day

  -- Gate 3: slope > 0 (degradation increasing)
  IF v_slope_per_day <= 0 THEN
    RETURN NULL;
  END IF;

  -- Get latest feature value (current_value)
  SELECT cfv.value INTO v_current_value
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows cw ON cfv.window_id = cw.id
  WHERE cw.asset_id = p_asset_id
    AND cfv.feature_definition_id = v_fd_id
  ORDER BY cw.window_end DESC
  LIMIT 1;

  IF v_current_value IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get zone_c_max from thresholds (threshold or adaptive baseline)
  -- REUSE get_applicable_thresholds() from SDD 3
  SELECT zone_c_max INTO v_threshold
  FROM public.get_applicable_thresholds(
    p_asset_id, v_fd_id,
    'rms_velocity_window',  -- method from trend
    (SELECT operational_context->>'regime'
     FROM condition_windows WHERE asset_id = p_asset_id
     ORDER BY window_end DESC LIMIT 1)
  );

  IF v_threshold.zone_c_max IS NULL OR v_threshold.zone_c_max <= v_current_value THEN
    -- Already at/past threshold or no threshold defined
    -- Return RUL = 0 (functional failure imminent)
    v_rul := 0;
  ELSE
    -- RUL = (zone_c_max - current_value) / |slope_per_day|
    v_rul := (v_threshold.zone_c_max - v_current_value) / v_slope_per_day;
  END IF;

  -- Get diagnosis confidence for quality modifier
  SELECT confidence INTO v_diag_confidence
  FROM public.condition_diagnoses
  WHERE asset_id = p_asset_id
    AND failure_mode_id = (
      SELECT id FROM public.condition_failure_mode_catalog
      WHERE failure_mode_key = p_failure_mode_key
    )
    AND diagnosis_status IN ('active', 'field_trial')
  ORDER BY created_at DESC
  LIMIT 1;

  v_diag_confidence := COALESCE(v_diag_confidence, 0.5);

  -- Confidence = r² * diagnosis_confidence
  v_confidence := v_trend.r_squared * v_diag_confidence;

  -- Uncertainty: ±20% (conservative for linear extrapolation)
  v_rul_low := GREATEST(0, v_rul * 0.8);
  v_rul_high := v_rul * 1.2;

  -- Store in condition_analysis_results
  INSERT INTO public.condition_analysis_results (
    asset_id, feature_definition_id,
    analysis_type, method_key, method_version,
    result_value, result_unit, confidence,
    r_squared,
    parameters,
    window_end, validation_status
  ) VALUES (
    p_asset_id, v_fd_id,
    'rul_estimate', 'linear_extrapolation', '1.0',
    v_rul, 'days', v_confidence,
    v_trend.r_squared,
    jsonb_build_object(
      'method', 'linear_extrapolation',
      'current_value', v_current_value,
      'threshold_value', v_threshold.zone_c_max,
      'slope_per_day', v_slope_per_day,
      'rul_low_estimate', v_rul_low,
      'rul_high_estimate', v_rul_high,
      'uncertainty_range_pct', 20,
      'diagnosis_confidence_used', v_diag_confidence,
      'failure_mode_key', p_failure_mode_key,
      'assumptions', jsonb_build_array(
        'degradation is linear',
        'operating regime constant',
        'threshold represents functional failure'
      )
    ),
    NOW(), 'active'
  ) RETURNING id INTO v_ar_id;

  RETURN v_ar_id;
END;
$$;

COMMENT ON FUNCTION public.compute_rul_linear(TEXT, TEXT, TEXT)
  IS 'Estima RUL por extrapolación lineal. Gates: R² ≥ 0.5, samples ≥ 10, slope > 0. Confidence = r² * diagnosis_confidence. Uncertainty ±20%.';
```

### generate_recommendation(p_diagnosis_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.generate_recommendation(
  p_diagnosis_id UUID
) RETURNS UUID  -- returns recommendation id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_diag RECORD;
  v_fm RECORD;
  v_pf RECORD;
  v_rul RECORD;
  v_action TEXT;
  v_priority TEXT;
  v_due_days INT;
  v_wo_type TEXT;
  v_confirm BOOLEAN;
  v_recommendation_id UUID;
BEGIN
  -- 1. Read diagnosis + failure_mode + confidence
  SELECT d.*, fm.severity_default, fm.failure_mode_key, fm.typical_effects
  INTO v_diag, v_fm
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2. Get PF-curve if available
  SELECT pf_interval_days, intervention_window_days
  INTO v_pf
  FROM public.condition_pf_curves
  WHERE asset_class = (SELECT asset_type_id FROM public.assets WHERE id = v_diag.asset_id)
    AND failure_mode_key = v_fm.failure_mode_key;

  -- 3. Get latest RUL estimate
  SELECT result_value AS rul_days,
         parameters->>'rul_low_estimate' AS rul_low,
         parameters->>'rul_high_estimate' AS rul_high
  INTO v_rul
  FROM public.condition_analysis_results
  WHERE asset_id = v_diag.asset_id
    AND analysis_type = 'rul_estimate'
  ORDER BY window_end DESC LIMIT 1;

  -- 4. Gate: confidence ≥ 0.7 AND active → can create WO
  --    field_trial → requires_confirmation = true
  IF v_diag.diagnosis_status = 'field_trial' THEN
    v_confirm := true;
  ELSIF v_diag.diagnosis_status = 'active' AND v_diag.confidence >= 0.7 THEN
    v_confirm := false;
  ELSE
    v_confirm := true;  -- candidate or low confidence: needs review
  END IF;

  -- 5. Determine action, priority, due_window
  v_action := 'Inspeccionar ' || v_fm.failure_mode_key || ' — '
              || COALESCE(v_fm.typical_effects::TEXT, 'posible degradación');

  v_priority := CASE
    WHEN v_diag.confidence >= 0.85 AND v_fm.severity_default IN ('critical', 'high')
      THEN 'critical'
    WHEN v_diag.confidence >= 0.7 AND v_fm.severity_default IN ('high', 'medium')
      THEN 'high'
    WHEN v_diag.confidence >= 0.5 THEN 'medium'
    ELSE 'low'
  END;

  v_due_days := COALESCE(
    v_pf.intervention_window_days,
    LEAST(CEIL(COALESCE(v_rul.rul_days, 30)), 90)::INT
  );

  v_wo_type := CASE
    WHEN v_priority = 'critical' THEN 'CM'
    WHEN v_priority = 'high' THEN 'CBM'
    ELSE 'INSPECTION'
  END;

  -- 6. Insert recommendation
  INSERT INTO public.maintenance_recommendations (
    diagnosis_id, recommended_action, priority,
    due_window_days, work_order_type, requires_confirmation
  ) VALUES (
    p_diagnosis_id, v_action, v_priority,
    v_due_days, v_wo_type, v_confirm
  ) RETURNING id INTO v_recommendation_id;

  RETURN v_recommendation_id;
END;
$$;

COMMENT ON FUNCTION public.generate_recommendation(UUID)
  IS 'Genera recomendación de mantenimiento desde diagnóstico + confianza + PF-curva + RUL. field_trial → requiere confirmación.';
```

### get_intervention_window (PF-curve helper)

```sql
CREATE OR REPLACE FUNCTION public.get_intervention_window(
  p_asset_class TEXT,
  p_failure_mode_key TEXT
) RETURNS TABLE(
  pf_interval_days INTEGER,
  inspection_interval_days INTEGER,
  intervention_window_days INTEGER
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT cpf.pf_interval_days,
         cpf.inspection_interval_days,
         cpf.intervention_window_days
  FROM public.condition_pf_curves cpf
  WHERE cpf.asset_class = p_asset_class
    AND cpf.failure_mode_key = p_failure_mode_key
    AND cpf.validation_status IN ('seed', 'bench_validated', 'field_validated');
END;
$$;
```

## ALTERs to Existing Tables

### condition_events: +diagnosis_id, +failure_mode_id

```sql
ALTER TABLE public.condition_events
  ADD COLUMN IF NOT EXISTS diagnosis_id UUID
  REFERENCES public.condition_diagnoses(id) ON DELETE SET NULL;

ALTER TABLE public.condition_events
  ADD COLUMN IF NOT EXISTS failure_mode_id UUID
  REFERENCES public.condition_failure_mode_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_diagnosis
  ON public.condition_events(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_events_failure_mode
  ON public.condition_events(failure_mode_id);
```

### condition_rules: evaluation_type CHECK extended

```sql
DO $$
BEGIN
  ALTER TABLE public.condition_rules
    DROP CONSTRAINT IF EXISTS condition_rules_evaluation_type_check;

  ALTER TABLE public.condition_rules
    ADD CONSTRAINT condition_rules_evaluation_type_check
      CHECK (evaluation_type IN (
        'threshold', 'trend', 'compound', 'residual',
        'z_score_threshold', 'innovation_threshold',
        'trend_significance', 'compound_anomaly',
        'diagnostic'
      ));
END;
$$;
```

### trg_condition_event_to_wo_func: diagnosis field_trial gate

Modified inside migration 2: after the `IF NEW.severity != 'critical' OR NEW.status != 'open'` gate, add:

```sql
  -- Gate: eventos vinculados a diagnosis field_trial NO generan WO
  IF NEW.diagnosis_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.condition_diagnoses
      WHERE id = NEW.diagnosis_id
        AND diagnosis_status = 'field_trial'
    ) THEN
      RETURN NEW;  -- field_trial → no WO automática
    END IF;
  END IF;
```

## evaluate_condition_rules: 'diagnostic' Extension

Add new evaluation block inside `evaluate_condition_rules()` after the existing types (before the event-creation section):

```sql
-- Evaluación: diagnostic (SDD 4 — crea diagnosis, NO event)
ELSIF v_rule.evaluation_type = 'diagnostic' THEN
  DECLARE
    v_fm_key TEXT;
    v_min_conf NUMERIC;
    v_diag_conf NUMERIC;
    v_diag_id UUID;
    v_auto_activate NUMERIC;
    v_diag_status TEXT;
    v_dem RECORD;
    v_dem_eval BOOLEAN := true;  -- starts true (AND grouping by evidence_role)
    v_has_required BOOLEAN := false;
    v_required_satisfied BOOLEAN := true;
    v_supporting_evidence JSONB := '[]'::JSONB;
    v_contradictory_evidence JSONB := '[]'::JSONB;
  BEGIN
    v_fm_key := v_rule.rule_config->>'failure_mode_key';
    v_min_conf := COALESCE((v_rule.rule_config->>'min_confidence_threshold')::NUMERIC, 0.5);
    v_auto_activate := COALESCE((v_rule.rule_config->>'auto_activate_on_threshold')::NUMERIC, 0.85);

    -- 1. Skip if rule is candidate (evaluates but does not create diagnosis)
    IF v_rule.validation_status = 'candidate' THEN
      -- TODO: log evaluation internally without INSERT
      v_condition_met := false;
    ELSE
      -- 2. Compute diagnosis confidence
      v_diag_conf := public.compute_diagnosis_confidence(p_asset_id, v_fm_key);

      -- 3. Check threshold
      IF v_diag_conf >= v_min_conf THEN
        -- Determine diagnosis_status from rule validation_status
        v_diag_status := CASE v_rule.validation_status
          WHEN 'field_trial' THEN 'field_trial'
          WHEN 'active' THEN
            CASE WHEN v_diag_conf >= v_auto_activate THEN 'active' ELSE 'candidate' END
          ELSE 'candidate'
        END;

        -- 4. INSERT into condition_diagnoses (NOT condition_events)
        INSERT INTO public.condition_diagnoses (
          asset_id, failure_mode_id, diagnosis_status, confidence,
          evidence_summary,
          supporting_result_ids, contradictory_result_ids, source_window_ids
        ) VALUES (
          p_asset_id,
          (SELECT id FROM public.condition_failure_mode_catalog
           WHERE failure_mode_key = v_fm_key),
          v_diag_status,
          v_diag_conf,
          jsonb_build_object(
            'rule_name', v_rule.rule_name,
            'rule_id', v_rule.id,
            'evaluation_type', 'diagnostic',
            'feature_key', v_rule.feature_key,
            'min_confidence_threshold', v_min_conf
          ),
          '{}', '{}', '{}'
        ) RETURNING id INTO v_diag_id;

        -- 5. Generate recommendation
        PERFORM public.generate_recommendation(v_diag_id);

        -- 6. Link to existing events if any for this asset+feature
        UPDATE public.condition_events
        SET diagnosis_id = v_diag_id
        WHERE asset_id = p_asset_id
          AND diagnosis_id IS NULL
          AND created_at > NOW() - INTERVAL '7 days';

        v_condition_met := true;
      ELSE
        v_condition_met := false;
      END IF;
    END IF;
  END;
```

**IMPORTANT**: The `DECLARE` block inside the `ELSIF` requires wrapping in a nested block with `BEGIN ... END;`. The existing function already uses a single `DECLARE` at the top, so the diagnostic evaluation must use an anonymous `DECLARE ... BEGIN ... END;` block.

### Seed diagnostic rules (2 INSERTs)

Inserted in migration 2:

```sql
INSERT INTO public.condition_rules (
  rule_name, description, feature_key, method_key,
  evaluation_type, rule_config, severity, action, validation_status
) VALUES
(
  'Diagnóstico: Cavitación Bomba',
  'Evalúa matriz de evidencia para pump.cavitation. Combina vibración RMS alta + presión descarga baja + temperatura normal.',
  'vibration.rms', 'rms_velocity_window',
  'diagnostic',
  '{"failure_mode_key": "pump.cavitation", "min_confidence_threshold": 0.5, "auto_activate_on_threshold": 0.85}',
  'warning', 'log_event', 'draft'
),
(
  'Diagnóstico: Desbalance Rotativo',
  'Evalúa matriz de evidencia para rotating.unbalance. Combina vibración RMS alta (1X RPM) + fase estable.',
  'vibration.rms', 'rms_velocity_window',
  'diagnostic',
  '{"failure_mode_key": "rotating.unbalance", "min_confidence_threshold": 0.5, "auto_activate_on_threshold": 0.85}',
  'warning', 'log_event', 'draft'
) ON CONFLICT (rule_name, version) DO NOTHING;
```

## Frontend Design

### DiagnosisPanel (`src/components/condition/DiagnosisPanel.jsx`)

**Props**: `assetId` (TEXT)

**Renders**:
- MUI Table of active diagnoses for the asset (status IN `candidate`,`field_trial`,`active`)
- Columns: failure_mode_name, confidence (linear gauge 0-1 with color: red<0.5, yellow<0.7, green≥0.7), diagnosis_status badge, created_at, linked_event count
- Expandable row: evidence_summary (supporting + contradictory), linked analysis results
- "Generate WO" button (disabled if diagnosis_status != 'active' or confidence < 0.7)

**Queries**:
```sql
SELECT d.*, fm.name AS failure_mode_name, fm.severity_default,
       fm.detectability,
       (SELECT COUNT(*) FROM condition_events ce
        WHERE ce.diagnosis_id = d.id) AS linked_event_count
FROM condition_diagnoses d
JOIN condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
WHERE d.asset_id = $1
  AND d.diagnosis_status IN ('candidate', 'field_trial', 'active')
ORDER BY d.confidence DESC, d.created_at DESC;
```

### RulGauge (`src/components/condition/RulGauge.jsx`)

**Props**: `rulDays` (NUMERIC), `confidence` (NUMERIC), `failureModeKey` (TEXT)

**Renders**:
- Circular gauge or horizontal bar with 3 color zones: green (>30d), yellow (7-30d), red (<7d)
- Text: "~XX días (±YY días)" with confidence badge
- Empty state: "Sin estimación RUL disponible" when NULL

### RecommendationCard (`src/components/condition/RecommendationCard.jsx`)

**Props**: `recommendation` (object from `maintenance_recommendations`)

**Renders**:
- MUI Card with priority chip (color-coded), action text, due_window_days
- "Requiere confirmación" warning chip if `requires_confirmation`
- WO type badge
- "Confirmar y crear OT" button → calls `generate_recommendation()` RPC, then inserts work_order
- Empty state: "Sin recomendaciones activas"

### App.jsx — "Diagnóstico" subtab

Add after "Tendencias" tab (index 5 for PLANNER/ADMIN, index 3 for others):

```jsx
<Tab label="Diagnóstico" />
```

Update index computation and render:

```jsx
// After deadIdx/tradIdx computation:
let diagIdx = -1;
if (userRole === 'PLANNER' || userRole === 'ADMIN') {
  diagIdx = 5;  // Captura=0, CSV=1, Fuentes=2, Dead-Letter=3, Tendencias=4, Diagnóstico=5
} else {
  diagIdx = 3;  // Captura=0, Fuentes=1, Tendencias=2, Diagnóstico=3
}

if (conditionSubTab === diagIdx && diagIdx !== -1) {
  return <DiagnosisPanel assetId={selectedAsset?.id || null} />;
}
```

### Hooks: `useDiagnoses.js`, `useRul.js`

Standard Supabase query hooks following `useFeatureTrends.js` pattern.

## Data Flow

```
feature_values ──→ compute_feature_trend() ──→ trend_slope (analysis_results)
                                                    │
                                                    ▼
diagnostic_evidence_matrix ──→ evaluate_condition_rules('diagnostic')
                                      │
                                      ▼
                         compute_diagnosis_confidence()
                              │
                              ▼
                    condition_diagnoses ──→ condition_events (linked via FK)
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
          compute_rul_linear()  PF-curves  generate_recommendation()
                    │                     │
                    ▼                     ▼
          analysis_results           maintenance_recommendations
          (rul_estimate)                   │
                                           ▼
                                     work_orders (CBM)
```

## Testing Strategy

### pgTAP: `condition_diagnostic_test.sql` (~60 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: catalogs | 12 | Tables exist, columns, CHECK constraints, indexes, RLS |
| Schema: diagnoses | 8 | condition_diagnoses + maintenance_recommendations structure |
| Failure mode catalog | 6 | ≥10 seeds, UNIQUE keys, asset_class filter |
| FMEA cross-ref | 4 | ≥3 seeds, UNIQUE constraint, FK integrity |
| Evidence matrix | 6 | ≥2 patterns, FK to failure_mode, required/supporting/contradictory |
| PF-curves | 4 | ≥3 seeds, UNIQUE(asset_class, failure_mode_key) |
| compute_diagnosis_confidence | 8 | All required met → high; contradictory → penalty; missing evidence no penalty |
| evaluate_condition_rules diagnostic | 6 | Creates diagnosis NOT event; field_trial → field_trial diagnosis; candidate rule skips |
| compute_rul_linear | 6 | Gates: R²<0.5 → NULL, samples<10 → NULL, slope≤0 → NULL; uncertainty ±20% |
| generate_recommendation | 4 | Confidence≥0.7 active → no confirm; field_trial → confirm; priority mapping |
| ALTERs | 4 | condition_events has diagnosis_id; rules has 'diagnostic' in check |
| No regression | 0 | Existing 600+ assertions untouched |

### Vitest (frontend)

| Test | What |
|------|------|
| DiagnosisPanel renders active diagnoses | Table with confidence gauges, status badges |
| DiagnosisPanel empty state | "Sin diagnósticos activos" |
| RulGauge renders | Color zone correct, interval text, confidence |
| RulGauge null RUL | "Sin estimación RUL disponible" |
| RecommendationCard renders | Priority chip, action text, confirm button |
| RecommendationCard empty | "Sin recomendaciones activas" |

## Open Questions

- [ ] **`fmea_failure_mode_id` format** — RxDB FMEA uses `fmea_rcm_analysis` with a UUID primary key. The cross-reference stores it as TEXT. Confirm the exact key pattern for seed data (e.g., `fmea_rcm_analysis.id` or a custom `failure_mode_code` field).
- [ ] **`linked_work_order_id` FK** — `condition_diagnoses.linked_work_order_id` references `work_orders.id` (UUID). Should this have a formal FK constraint or remain a loose reference? Current `condition_events` has no formal FK to `work_orders` either.
- [ ] **RUL threshold source** — `compute_rul_linear()` uses `get_applicable_thresholds()` which returns zone_c_max from baseline or ISO catalog. For MVP, what defines "functional failure" for each feature+mode? May need a new column in `condition_pf_curves` or inline in `failure_mode_catalog`.
- [ ] **Diagnostic seed rules vs actual data** — Seed diagnostic rules are `draft`. Without real feature_values matching the evidence matrix patterns, `compute_diagnosis_confidence()` will return 0. This is correct behavior but may confuse during dev/demo.
