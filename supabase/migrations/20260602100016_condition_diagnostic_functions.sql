-- ============================================================
-- MIGRATION: condition_diagnostic_functions — Diagnósticos,
--   RUL y Recomendaciones de Mantenimiento (SDD 4, PR 1b)
-- Change: condition-monitoring-diagnostics-prognostics (PR 1b)
-- ============================================================
-- Implementa el pipeline de diagnóstico basado en condición:
--   1. condition_diagnoses — hipótesis de falla multi-evidencia
--   2. maintenance_recommendations — acciones recomendadas
--   3. compute_diagnosis_confidence() — scoring multi-factor
--   4. compute_rul_linear() — extrapolación lineal con gates
--   5. get_intervention_window() — helper de curvas P-F
--   6. generate_recommendation() — desde diagnóstico + PF + RUL
--   7. ALTERs: condition_events +diagnosis_id, +failure_mode_id
--   8. ALTER: condition_rules CHECK extendido con 'diagnostic'
--   9. EXTEND trg_condition_event_to_wo_func(): field_trial gate
--  10. EXTEND evaluate_condition_rules(): evaluation_type='diagnostic'
--  11. Seed: 2 reglas diagnósticas draft
--
-- Idempotente: CREATE OR REPLACE FUNCTION, CREATE TABLE IF NOT EXISTS,
--   ALTER...IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_diagnoses
--    Diagnósticos de condición — hipótesis de falla con
--    evidencia, confianza y trazabilidad.
--    Separada de condition_events (evento != diagnóstico).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  failure_mode_id UUID NOT NULL
    REFERENCES public.condition_failure_mode_catalog(id),
  diagnosis_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (diagnosis_status IN ('candidate', 'field_trial', 'active',
           'confirmed', 'rejected', 'superseded')),
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  evidence_summary JSONB DEFAULT '{}',
  supporting_result_ids UUID[] DEFAULT '{}',
  contradictory_result_ids UUID[] DEFAULT '{}',
  source_window_ids UUID[] DEFAULT '{}',
  linked_event_id UUID REFERENCES public.condition_events(id)
    ON DELETE SET NULL,
  linked_work_order_id UUID,
  feedback_status TEXT
    CHECK (feedback_status IN ('confirmed', 'rejected', 'partial')),
  feedback_notes TEXT,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_diagnoses
  IS 'Diagnósticos de condición — hipótesis de falla con evidencia, confianza y trazabilidad. Separada de condition_events.';

COMMENT ON COLUMN public.condition_diagnoses.asset_id
  IS 'ID del activo diagnosticado';
COMMENT ON COLUMN public.condition_diagnoses.failure_mode_id
  IS 'FK al modo de falla en condition_failure_mode_catalog';
COMMENT ON COLUMN public.condition_diagnoses.diagnosis_status
  IS 'Estado del diagnóstico: candidate, field_trial, active, confirmed, rejected, superseded';
COMMENT ON COLUMN public.condition_diagnoses.confidence
  IS 'Confianza del diagnóstico [0.0, 1.0] — calculada por compute_diagnosis_confidence()';
COMMENT ON COLUMN public.condition_diagnoses.evidence_summary
  IS 'Desglose auditable de evidencia: evidence_present, required_met, contradictory_count, quality_modifier, completeness, final_confidence';
COMMENT ON COLUMN public.condition_diagnoses.supporting_result_ids
  IS 'UUIDs de condition_analysis_results que soportan el diagnóstico';
COMMENT ON COLUMN public.condition_diagnoses.contradictory_result_ids
  IS 'UUIDs de resultados que contradicen el diagnóstico';
COMMENT ON COLUMN public.condition_diagnoses.source_window_ids
  IS 'UUIDs de ventanas fuente que generaron la evidencia';
COMMENT ON COLUMN public.condition_diagnoses.linked_event_id
  IS 'FK opcional a condition_events — evento vinculado a este diagnóstico';
COMMENT ON COLUMN public.condition_diagnoses.linked_work_order_id
  IS 'UUID de la work_order generada desde este diagnóstico (FK formal opcional)';
COMMENT ON COLUMN public.condition_diagnoses.feedback_status
  IS 'Feedback de campo: confirmed, rejected, partial';
COMMENT ON COLUMN public.condition_diagnoses.feedback_notes
  IS 'Notas de feedback de campo';
COMMENT ON COLUMN public.condition_diagnoses.valid_until
  IS 'Fecha de expiración del diagnóstico (si aplica)';
COMMENT ON COLUMN public.condition_diagnoses.created_at
  IS 'Fecha de creación del diagnóstico';

-- Índices
CREATE INDEX IF NOT EXISTS idx_diag_asset
  ON public.condition_diagnoses(asset_id);

CREATE INDEX IF NOT EXISTS idx_diag_status
  ON public.condition_diagnoses(diagnosis_status);

CREATE INDEX IF NOT EXISTS idx_diag_fm
  ON public.condition_diagnoses(failure_mode_id);

CREATE INDEX IF NOT EXISTS idx_diag_event
  ON public.condition_diagnoses(linked_event_id);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN
ALTER TABLE public.condition_diagnoses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_diagnoses_select ON public.condition_diagnoses;
CREATE POLICY condition_diagnoses_select ON public.condition_diagnoses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_diagnoses_insert ON public.condition_diagnoses;
CREATE POLICY condition_diagnoses_insert ON public.condition_diagnoses
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_diagnoses_update ON public.condition_diagnoses;
CREATE POLICY condition_diagnoses_update ON public.condition_diagnoses
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_diagnoses_delete ON public.condition_diagnoses;
CREATE POLICY condition_diagnoses_delete ON public.condition_diagnoses
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- 2. TABLA: maintenance_recommendations
--    Recomendaciones de mantenimiento generadas desde diagnóstico
--    + confianza + RUL + PF-curva.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.maintenance_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID NOT NULL
    REFERENCES public.condition_diagnoses(id) ON DELETE CASCADE,
  recommended_action TEXT NOT NULL,
  priority TEXT NOT NULL
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_window_days INTEGER,
  work_order_type TEXT DEFAULT 'CBM'
    CHECK (work_order_type IN ('CBM', 'PM', 'CM', 'INSPECTION')),
  requires_confirmation BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'review_required',
           'approved', 'converted_to_wo', 'dismissed', 'superseded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.maintenance_recommendations
  IS 'Recomendaciones de mantenimiento generadas desde diagnóstico + confianza + RUL + PF-curva + criticidad.';

COMMENT ON COLUMN public.maintenance_recommendations.id
  IS 'Identificador único de la recomendación';
COMMENT ON COLUMN public.maintenance_recommendations.diagnosis_id
  IS 'FK al diagnóstico que originó esta recomendación';
COMMENT ON COLUMN public.maintenance_recommendations.recommended_action
  IS 'Descripción de la acción recomendada';
COMMENT ON COLUMN public.maintenance_recommendations.priority
  IS 'Prioridad: low, medium, high, critical';
COMMENT ON COLUMN public.maintenance_recommendations.due_window_days
  IS 'Ventana de ejecución recomendada en días (mínimo entre P-F y RUL)';
COMMENT ON COLUMN public.maintenance_recommendations.work_order_type
  IS 'Tipo de OT sugerida: CBM, PM, CM, INSPECTION';
COMMENT ON COLUMN public.maintenance_recommendations.requires_confirmation
  IS 'Si true, la recomendación requiere confirmación manual antes de crear OT';
COMMENT ON COLUMN public.maintenance_recommendations.status
  IS 'Estado del ciclo de vida: suggested, review_required, approved, converted_to_wo, dismissed, superseded';
COMMENT ON COLUMN public.maintenance_recommendations.created_at
  IS 'Fecha de creación de la recomendación';

-- Índices
CREATE INDEX IF NOT EXISTS idx_mr_diag
  ON public.maintenance_recommendations(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_mr_priority
  ON public.maintenance_recommendations(priority);

CREATE INDEX IF NOT EXISTS idx_mr_status
  ON public.maintenance_recommendations(status);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN
ALTER TABLE public.maintenance_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_recommendations_select ON public.maintenance_recommendations;
CREATE POLICY maintenance_recommendations_select ON public.maintenance_recommendations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS maintenance_recommendations_insert ON public.maintenance_recommendations;
CREATE POLICY maintenance_recommendations_insert ON public.maintenance_recommendations
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS maintenance_recommendations_update ON public.maintenance_recommendations;
CREATE POLICY maintenance_recommendations_update ON public.maintenance_recommendations
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS maintenance_recommendations_delete ON public.maintenance_recommendations;
CREATE POLICY maintenance_recommendations_delete ON public.maintenance_recommendations
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- 3. FUNCIÓN: compute_diagnosis_confidence()
--    Calcula confianza diagnóstica multi-factor combinando:
--      - evidence_present_ratio (peso 0.4)
--      - required_evidence_met (peso 0.3 — TODO required o 0)
--      - contradictory_neg (peso 0.3 — cada contradictory × 0.5)
--      - quality_modifier (promedio calidad G0=1.0, G1=0.8,
--        G2=0.5, G3=0.0)
--    Missing evidence NO penaliza (se registra completeness).
--    Retorna: confidence NUMERIC + breakdown JSONB auditable.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_diagnosis_confidence(
  p_asset_id TEXT,
  p_failure_mode_key TEXT
) RETURNS TABLE(confidence NUMERIC, breakdown JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fm_id UUID;
  v_evidence_present INT := 0;
  v_evidence_total INT := 0;
  v_required_total INT := 0;
  v_required_met INT := 0;
  v_contradictory_total INT := 0;
  v_contradictory_matched INT := 0;
  v_quality_sum NUMERIC := 0;
  v_quality_count INT := 0;
  v_evidence_present_ratio NUMERIC;
  v_required_met_ratio NUMERIC;
  v_contradictory_neg NUMERIC;
  v_quality_mod NUMERIC;
  v_completeness NUMERIC;
  v_final_confidence NUMERIC;
  rec RECORD;
BEGIN
  -- Resolver failure_mode_id desde la clave
  SELECT id INTO v_fm_id
  FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = p_failure_mode_key;

  IF v_fm_id IS NULL THEN
    confidence := 0.0;
    breakdown := jsonb_build_object(
      'error', 'failure_mode_key no encontrado',
      'failure_mode_key', p_failure_mode_key
    );
    RETURN NEXT; RETURN;
  END IF;

  -- Cargar evidencia de la matriz con el último feature_value
  FOR rec IN
    SELECT
      dem.evidence_role,
      dem.op,
      dem.value,
      cfv.value AS feature_value,
      cfv.quality_flag
    FROM public.diagnostic_evidence_matrix dem
    LEFT JOIN LATERAL (
      SELECT cfv2.value, cfv2.quality_flag
      FROM public.condition_feature_values cfv2
      JOIN public.condition_windows cw ON cfv2.window_id = cw.id
      JOIN public.condition_feature_definitions cfd
        ON cfv2.feature_definition_id = cfd.id
      WHERE cw.asset_id = p_asset_id
        AND cfd.feature_key = dem.feature_key
        AND (dem.required_regime IS NULL
             OR cw.operational_context->>'regime' = dem.required_regime)
      ORDER BY cw.window_end DESC
      LIMIT 1
    ) cfv ON true
    WHERE dem.failure_mode_id = v_fm_id
  LOOP
    v_evidence_total := v_evidence_total + 1;

    -- Contar required y contradictory totales
    IF rec.evidence_role = 'required' THEN
      v_required_total := v_required_total + 1;
    END IF;
    IF rec.evidence_role = 'contradictory' THEN
      v_contradictory_total := v_contradictory_total + 1;
    END IF;

    -- Si hay feature_value, evaluar condición
    IF rec.feature_value IS NOT NULL THEN
      IF (rec.op = '>' AND rec.feature_value > rec.value)
         OR (rec.op = '>=' AND rec.feature_value >= rec.value)
         OR (rec.op = '<' AND rec.feature_value < rec.value)
         OR (rec.op = '<=' AND rec.feature_value <= rec.value)
         OR (rec.op = '=' AND rec.feature_value = rec.value)
         OR (rec.op = 'between' AND rec.feature_value = rec.value)
      THEN
        IF rec.evidence_role = 'contradictory' THEN
          v_contradictory_matched := v_contradictory_matched + 1;
        ELSE
          v_evidence_present := v_evidence_present + 1;
          IF rec.evidence_role = 'required' THEN
            v_required_met := v_required_met + 1;
          END IF;
        END IF;

        -- Quality modifier (promedio de calidad de evidence MATCHED)
        v_quality_sum := v_quality_sum + CASE rec.quality_flag
          WHEN 'G0' THEN 1.0 WHEN 'G1' THEN 0.8
          WHEN 'G2' THEN 0.5 WHEN 'G3' THEN 0.0 ELSE 0.0 END;
        v_quality_count := v_quality_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- Si no hay evidencia definida, confianza 0
  IF v_evidence_total = 0 THEN
    confidence := 0.0;
    breakdown := jsonb_build_object(
      'error', 'Sin evidencia definida en la matriz',
      'failure_mode_key', p_failure_mode_key
    );
    RETURN NEXT; RETURN;
  END IF;

  -- Evidence present ratio (peso 0.4)
  v_evidence_present_ratio := v_evidence_present::NUMERIC
    / NULLIF(v_evidence_total, 0);

  -- Required evidence met (peso 0.3) — ALL required must match, else 0
  IF v_required_total > 0 AND v_required_met < v_required_total THEN
    v_required_met_ratio := 0.0;
  ELSE
    v_required_met_ratio := 1.0;
  END IF;

  -- Contradictory penalty (peso 0.3) — cada matched × 0.5
  v_contradictory_neg := CASE
    WHEN v_contradictory_matched = 0 THEN 1.0
    ELSE POWER(0.5, v_contradictory_matched)
  END;

  -- Quality modifier — promedio de quality_flag scores
  v_quality_mod := CASE
    WHEN v_quality_count > 0 THEN v_quality_sum / v_quality_count
    ELSE 1.0
  END;

  -- Completeness: qué % de evidencia tuvo datos disponibles
  v_completeness := v_quality_count::NUMERIC / NULLIF(v_evidence_total, 0);

  -- Score final: suma ponderada × quality modifier
  v_final_confidence := (
    v_evidence_present_ratio * 0.4
    + v_required_met_ratio * 0.3
    + v_contradictory_neg * 0.3
  ) * v_quality_mod;

  v_final_confidence := GREATEST(0.0, LEAST(1.0, v_final_confidence));

  confidence := v_final_confidence;
  breakdown := jsonb_build_object(
    'evidence_present', v_evidence_present,
    'evidence_total', v_evidence_total,
    'required_met', v_required_met,
    'required_total', v_required_total,
    'contradictory_count', v_contradictory_matched,
    'contradictory_total', v_contradictory_total,
    'quality_modifier', v_quality_mod,
    'completeness', v_completeness,
    'final_confidence', v_final_confidence
  );
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_diagnosis_confidence(TEXT, TEXT)
  IS 'Calcula confianza diagnóstica multi-factor: evidence_present_ratio (0.4) + required_met (0.3) + contradictory_neg (0.3) × quality_mod. Missing evidence NO penaliza. Retorna confidence + breakdown JSONB auditable.';

-- ============================================================
-- 4. FUNCIÓN: compute_rul_linear()
--    Estima RUL (Vida Útil Remanente) por extrapolación lineal.
--    Gates estrictos:
--      - Trend R² ≥ 0.5
--      - Muestras ≥ 10
--      - Slope > 0 (degradación activa)
--      - Calidad G0/G1
--    RUL = (threshold - current_value) / |slope_per_day| * 24
--    Uncertainty: ±20%
--    Almacena en condition_analysis_results como rul_estimate.
--    Si gates fallan: retorna NULLs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_rul_linear(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_failure_mode_key TEXT
) RETURNS TABLE(
  rul_hours NUMERIC,
  confidence NUMERIC,
  uncertainty_low NUMERIC,
  uncertainty_high NUMERIC,
  assumptions TEXT[]
)
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
  v_current_value NUMERIC;
  v_slope_per_day NUMERIC;
  v_unit TEXT;
  v_quality_ok BOOLEAN;
  v_fm_id UUID;
  v_assumptions TEXT[] := '{}';
  v_ar_id UUID;
BEGIN
  -- Resolver feature_definition_id
  SELECT id, unit INTO v_fd_id, v_unit
  FROM public.condition_feature_definitions
  WHERE feature_key = p_feature_key;

  IF v_fd_id IS NULL THEN
    assumptions := ARRAY['feature_key_not_found:' || p_feature_key];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 1: latest trend_slope con R² ≥ 0.5
  SELECT result_value, r_squared, confidence,
         (parameters->>'sample_count')::INT AS sample_count,
         window_end
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
    assumptions := ARRAY['r2_below_threshold:no_trend_found'];
    RETURN NEXT; RETURN;
  END IF;

  v_slope_per_day := v_trend.result_value;

  -- Gate 2: samples ≥ 10
  IF v_trend.sample_count IS NULL OR v_trend.sample_count < 10 THEN
    assumptions := ARRAY['insufficient_samples:' ||
      COALESCE(v_trend.sample_count::TEXT, 'NULL')];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 3: slope > 0 (degradación activa creciente)
  IF v_slope_per_day <= 0 THEN
    assumptions := ARRAY['slope_not_positive:' ||
      ROUND(v_slope_per_day::NUMERIC, 6)::TEXT];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 4: calidad de datos G0/G1 en el último feature_value
  SELECT EXISTS (
    SELECT 1 FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND cfv.quality_flag IN ('G0', 'G1')
    ORDER BY cw.window_end DESC
    LIMIT 1
  ) INTO v_quality_ok;

  IF NOT v_quality_ok THEN
    assumptions := ARRAY['quality_too_low:latest_not_G0_or_G1'];
    RETURN NEXT; RETURN;
  END IF;

  -- Obtener último feature_value (current state)
  SELECT cfv.value INTO v_current_value
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows cw ON cfv.window_id = cw.id
  WHERE cw.asset_id = p_asset_id
    AND cfv.feature_definition_id = v_fd_id
  ORDER BY cw.window_end DESC
  LIMIT 1;

  IF v_current_value IS NULL THEN
    assumptions := ARRAY['no_current_value'];
    RETURN NEXT; RETURN;
  END IF;

  -- Obtener threshold (zone_c_max) via get_applicable_thresholds
  SELECT zone_c_max INTO v_threshold
  FROM public.get_applicable_thresholds(
    p_asset_id, v_fd_id,
    'rms_velocity_window',
    (SELECT operational_context->>'regime'
     FROM public.condition_windows
     WHERE asset_id = p_asset_id
     ORDER BY window_end DESC LIMIT 1)
  );

  IF v_threshold.zone_c_max IS NULL OR v_threshold.zone_c_max <= v_current_value THEN
    -- Ya está en/pasó el umbral de falla funcional
    v_rul := 0;
    v_assumptions := v_assumptions || ARRAY['threshold_reached_or_exceeded'];
  ELSE
    -- RUL = (threshold - current) / slope_per_day → days, then * 24 → hours
    v_rul := (v_threshold.zone_c_max - v_current_value) / v_slope_per_day * 24;
    v_assumptions := v_assumptions || ARRAY['degradation_is_linear',
      'operating_regime_constant',
      'threshold_represents_functional_failure'];
  END IF;

  -- Resolver failure_mode_id
  SELECT id INTO v_fm_id
  FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = p_failure_mode_key;

  -- Obtener diagnosis confidence como gate adicional (soft gate)
  SELECT confidence INTO v_diag_confidence
  FROM public.condition_diagnoses
  WHERE asset_id = p_asset_id
    AND failure_mode_id = v_fm_id
    AND diagnosis_status IN ('active', 'field_trial')
  ORDER BY created_at DESC
  LIMIT 1;

  v_diag_confidence := COALESCE(v_diag_confidence, 0.5);

  -- Confidence = MIN(trend_r2, diagnosis_confidence)
  v_confidence := LEAST(COALESCE(v_trend.r_squared, 0),
                        COALESCE(v_diag_confidence, 0));

  -- Uncertainty: ±20%
  v_rul_low := GREATEST(0, v_rul * 0.8);
  v_rul_high := v_rul * 1.2;

  -- Almacenar en condition_analysis_results
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
    v_rul, 'hours', v_confidence,
    v_trend.r_squared,
    jsonb_build_object(
      'method', 'linear_extrapolation',
      'current_value', v_current_value,
      'threshold_value', v_threshold.zone_c_max,
      'slope_per_day', v_slope_per_day,
      'rul_hours', v_rul,
      'rul_low_estimate', v_rul_low,
      'rul_high_estimate', v_rul_high,
      'uncertainty_range_pct', 20,
      'diagnosis_confidence_used', v_diag_confidence,
      'failure_mode_key', p_failure_mode_key,
      'trend_r_squared', v_trend.r_squared,
      'trend_window_end', v_trend.window_end,
      'assumptions', to_jsonb(v_assumptions)
    ),
    NOW(), 'active'
  );

  -- Retornar resultados
  rul_hours := v_rul;
  confidence := v_confidence;
  uncertainty_low := v_rul_low;
  uncertainty_high := v_rul_high;
  assumptions := v_assumptions;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_rul_linear(TEXT, TEXT, TEXT)
  IS 'Estima RUL por extrapolación lineal con gates: R² ≥ 0.5, samples ≥ 10, slope > 0, calidad G0/G1. Confidence = MIN(trend_r2, diagnosis_confidence). Uncertainty ±20%. Almacena en condition_analysis_results.';

-- ============================================================
-- 5. FUNCIÓN: get_intervention_window()
--    Helper de curvas P-F que retorna intervalos de intervención.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_intervention_window(
  p_asset_class TEXT,
  p_failure_mode_key TEXT
) RETURNS TABLE(
  pf_interval_days INTEGER,
  inspection_interval_days INTEGER,
  intervention_window_days INTEGER
) LANGUAGE plpgsql STABLE
AS $$
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

COMMENT ON FUNCTION public.get_intervention_window(TEXT, TEXT)
  IS 'Retorna intervalos P-F, inspección e intervención desde curvas P-F por asset_class + failure_mode_key.';

-- ============================================================
-- 6. FUNCIÓN: generate_recommendation()
--    Genera recomendación de mantenimiento desde un diagnóstico,
--    combinando confianza, PF-curva y RUL.
--    field_trial → requires_confirmation=true
--    active + confidence ≥ 0.7 → puede auto-confirmar
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_recommendation(
  p_diagnosis_id UUID
) RETURNS UUID
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
  -- 1. Leer diagnóstico + failure_mode + confianza
  SELECT d.asset_id, d.diagnosis_status, d.confidence,
         fm.severity_default, fm.failure_mode_key,
         fm.typical_effects
  INTO v_diag, v_fm
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm
    ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2. Obtener PF-curve (usando asset_class desde el FM catalog)
  SELECT cpf.pf_interval_days, cpf.intervention_window_days
  INTO v_pf
  FROM public.condition_pf_curves cpf
  JOIN public.condition_failure_mode_catalog fm
    ON cpf.failure_mode_key = fm.failure_mode_key
  WHERE fm.failure_mode_key = v_fm.failure_mode_key
    AND cpf.asset_class = fm.asset_class;

  -- 3. Obtener último RUL estimate
  SELECT result_value AS rul_days
  INTO v_rul
  FROM public.condition_analysis_results
  WHERE asset_id = v_diag.asset_id
    AND analysis_type = 'rul_estimate'
  ORDER BY window_end DESC
  LIMIT 1;

  -- 4. Determinar requires_confirmation según ciclo de vida
  IF v_diag.diagnosis_status = 'field_trial' THEN
    v_confirm := true;
  ELSIF v_diag.diagnosis_status = 'active'
        AND v_diag.confidence >= 0.7 THEN
    v_confirm := false;
  ELSE
    v_confirm := true;
  END IF;

  -- 5. Determinar acción, prioridad, ventana
  v_action := 'Inspeccionar ' || v_fm.failure_mode_key
    || ' — ' || COALESCE(
      (SELECT string_agg(e, ', ') FROM unnest(v_fm.typical_effects) AS e),
      'posible degradación');

  v_priority := CASE
    WHEN v_diag.confidence >= 0.85
         AND v_fm.severity_default IN ('critical', 'high')
      THEN 'critical'
    WHEN v_diag.confidence >= 0.7
         AND v_fm.severity_default IN ('high', 'medium')
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

  -- 6. Insertar recomendación
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
  IS 'Genera recomendación de mantenimiento desde diagnóstico + confianza + PF-curva + RUL. field_trial → requiere confirmación; active + confidence ≥ 0.7 → puede auto-confirmar.';

-- ============================================================
-- 7. ALTER TABLE: condition_events
--    Agrega diagnosis_id FK + failure_mode_id FK
--    para vincular eventos con diagnósticos.
-- ============================================================
ALTER TABLE public.condition_events
  ADD COLUMN IF NOT EXISTS diagnosis_id UUID
  REFERENCES public.condition_diagnoses(id) ON DELETE SET NULL;

ALTER TABLE public.condition_events
  ADD COLUMN IF NOT EXISTS failure_mode_id UUID
  REFERENCES public.condition_failure_mode_catalog(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.condition_events.diagnosis_id
  IS 'FK a condition_diagnoses — diagnóstico vinculado a este evento';
COMMENT ON COLUMN public.condition_events.failure_mode_id
  IS 'FK a condition_failure_mode_catalog — modo de falla asociado al evento';

CREATE INDEX IF NOT EXISTS idx_events_diagnosis
  ON public.condition_events(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_events_failure_mode
  ON public.condition_events(failure_mode_id);

-- ============================================================
-- 8. ALTER TABLE: condition_rules — evaluation_type CHECK
--    Extiende la constraint con 'diagnostic'.
-- ============================================================
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

-- ============================================================
-- 9. EXTENDER: trg_condition_event_to_wo_func()
--    Gate: eventos vinculados a diagnosis field_trial NO generan WO
--    incluso con severity=critical.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_condition_event_to_wo_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_equip_id VARCHAR;
  v_wo_id UUID;
  v_existing_wo_id UUID;
BEGIN
  -- Gate 0: eventos vinculados a diagnosis field_trial NO generan WO
  IF NEW.diagnosis_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.condition_diagnoses
      WHERE id = NEW.diagnosis_id
        AND diagnosis_status = 'field_trial'
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Solo eventos critical + open disparan WO
  IF NEW.severity != 'critical' OR NEW.status != 'open' THEN
    RETURN NEW;
  END IF;

  -- Anti-spam: ¿ya existe WO vinculada a este mismo evento?
  SELECT id INTO v_existing_wo_id FROM public.work_orders
  WHERE condition_event_id = NEW.id
  LIMIT 1;

  IF FOUND THEN
    IF NEW.status = 'open' THEN
      UPDATE public.condition_events SET status = 'linked_to_wo'
      WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Resolver equipment_id desde assets
  SELECT equipment_id INTO v_equip_id
  FROM public.assets WHERE id::TEXT = NEW.asset_id;

  -- Insertar work_order CBM
  INSERT INTO public.work_orders (
    id, asset_id, equipment_id, wo_type, lifecycle_phase,
    condition_event_id, reported_at, criticality, symptom_note
  ) VALUES (
    gen_random_uuid(), NEW.asset_id,
    COALESCE(v_equip_id, NEW.asset_id),
    'CBM', 'WAPPR', NEW.id,
    NOW(), 'A',
    format('Evento CBM [%s]: %s (HI: %s, dHI/dt: %s)',
      NEW.severity, NEW.message,
      COALESCE(NEW.hi_value::TEXT, 'N/D'),
      COALESCE(NEW.dhi_dt_value::TEXT, 'N/D')
    )
  ) RETURNING id INTO v_wo_id;

  -- Vincular evento a WO
  UPDATE public.condition_events SET status = 'linked_to_wo'
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_condition_event_to_wo_func()
  IS 'AFTER INSERT en condition_events. SDD 4: field_trial gate — eventos vinculados a diagnosis field_trial NO generan WO. Eventos critical+open → work_order CBM automática con anti-spam.';

-- ============================================================
-- 10. EXTENDER: evaluate_condition_rules()
--     Agrega evaluation_type = 'diagnostic':
--     Carga matriz de evidencia, llama compute_diagnosis_confidence(),
--     si confidence ≥ threshold crea condition_diagnosis (NO event).
--     DECLARE anidado para evitar conflicto con DECLARE principal.
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_condition_rules(
  p_asset_id TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_fv RECORD;
  v_regime TEXT;
  v_asset_class TEXT;
  v_count INT := 0;
  v_consecutive INT;
  v_event_severity TEXT;
  v_method_status TEXT;
  v_event_id UUID;
  v_analysis RECORD;
  v_condition_met BOOLEAN;
  v_quality_num INT;
  v_min_quality_num INT;
  v_duration_windows INT;
  v_threshold NUMERIC;
  v_latest_window_end TIMESTAMPTZ;
  v_compound_result BOOLEAN;
  v_residual RECORD;
  v_fd_id UUID;
  v_trend_config RECORD;
  v_event_type TEXT;
  v_explain_json JSONB;
  v_residual_window_ids UUID[];
  v_residual_z_scores NUMERIC[];
BEGIN
  -- ── 0. Resolver asset_class desde assets ──────────────────
  SELECT a.asset_type_id INTO v_asset_class
  FROM public.assets a
  WHERE a.id = p_asset_id;

  -- ── 1. Determinar régimen operativo actual ────────────────
  SELECT operational_context->>'regime' INTO v_regime
  FROM public.condition_windows
  WHERE asset_id = p_asset_id
  ORDER BY window_end DESC
  LIMIT 1;

  IF v_regime IS NULL THEN
    v_regime := 'FULL_LOAD';
  END IF;

  -- ── 2. Iterar reglas activas que coinciden con el activo ──
  FOR v_rule IN
    SELECT *
    FROM public.condition_rules
    WHERE validation_status IN ('active', 'field_trial')
      AND (asset_class IS NULL OR asset_class = v_asset_class)
      AND (regime IS NULL OR regime = v_regime)
    ORDER BY severity DESC
  LOOP
    -- ── 2a. Obtener último feature_value ────────────────────
    IF v_rule.feature_key IS NOT NULL AND
       v_rule.evaluation_type NOT IN ('residual', 'innovation_threshold') THEN
      SELECT cfv.value, cfv.quality_flag, cfv.method_key,
             cfv.id AS fv_id, cw.window_end
      INTO v_fv
      FROM public.condition_feature_values cfv
      JOIN public.condition_windows cw ON cfv.window_id = cw.id
      JOIN public.condition_feature_definitions cfd
        ON cfv.feature_definition_id = cfd.id
      WHERE cw.asset_id = p_asset_id
        AND cfd.feature_key = v_rule.feature_key
        AND (v_rule.method_key IS NULL OR cfv.method_key = v_rule.method_key)
        AND cw.window_end > NOW() - INTERVAL '30 days'
      ORDER BY cw.window_end DESC
      LIMIT 1;

      IF v_fv.value IS NULL THEN
        CONTINUE;
      END IF;

      -- ── 2b. Verificar calidad ─────────────────────────────
      v_quality_num := CASE v_fv.quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1
        WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;
      v_min_quality_num := CASE v_rule.min_quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1
        WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;

      IF v_quality_num > v_min_quality_num THEN
        CONTINUE;
      END IF;

      v_latest_window_end := v_fv.window_end;
    ELSE
      v_latest_window_end := NOW();
    END IF;

    -- ── 2c. Evaluar según evaluation_type ───────────────────
    v_condition_met := false;

    -- Evaluación: threshold (existente)
    IF v_rule.evaluation_type = 'threshold' THEN
      v_threshold := (v_rule.rule_config->>'threshold')::NUMERIC;
      v_duration_windows := COALESCE(
        (v_rule.rule_config->>'duration_windows')::INT, 1);

      IF v_fv.value > v_threshold THEN
        WITH ordered_windows AS (
          SELECT cfv2.value, cw2.window_end,
                 cfv2.value > v_threshold AS exceeds,
                 ROW_NUMBER() OVER (ORDER BY cw2.window_end DESC) AS rn
          FROM public.condition_feature_values cfv2
          JOIN public.condition_windows cw2 ON cfv2.window_id = cw2.id
          JOIN public.condition_feature_definitions cfd2
            ON cfv2.feature_definition_id = cfd2.id
          WHERE cw2.asset_id = p_asset_id
            AND cfd2.feature_key = v_rule.feature_key
            AND (v_rule.method_key IS NULL
                 OR cfv2.method_key = v_rule.method_key)
            AND cw2.window_end <= v_latest_window_end
          ORDER BY cw2.window_end DESC
          LIMIT v_duration_windows
        )
        SELECT COUNT(*) INTO v_consecutive
        FROM ordered_windows WHERE exceeds = true;

        IF v_consecutive >= v_duration_windows THEN
          v_condition_met := true;
        END IF;
      END IF;

    -- Evaluación: trend (per-feature + legacy dHI/dt)
    ELSIF v_rule.evaluation_type = 'trend' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;

        SELECT ar.result_value, ar.r_squared, ar.id AS ar_id,
               ar.parameters->>'sample_count' AS sample_count,
               ar.parameters->>'regime_consistency' AS regime_consistency
        INTO v_analysis
        FROM public.condition_analysis_results ar
        WHERE ar.asset_id = p_asset_id
          AND ar.feature_definition_id = v_fd_id
          AND ar.analysis_type = 'trend_slope'
          AND ar.method_key = 'linear_regression'
          AND ar.result_value IS NOT NULL
        ORDER BY ar.window_end DESC
        LIMIT 1;

        IF v_analysis.result_value IS NOT NULL THEN
          IF v_analysis.r_squared >= COALESCE(
               (v_rule.rule_config->>'min_r2')::NUMERIC, 0.3) THEN
            v_condition_met := true;
          END IF;
        END IF;
      ELSE
        SELECT ar.result_value, ar.r_squared, ar.id AS ar_id
        INTO v_analysis
        FROM public.condition_analysis_results ar
        WHERE ar.asset_id = p_asset_id
          AND ar.analysis_type = 'trend_slope'
          AND ar.result_value IS NOT NULL
        ORDER BY ar.window_end DESC
        LIMIT 1;

        IF v_analysis.result_value IS NOT NULL THEN
          v_threshold := (v_rule.rule_config->>'threshold')::NUMERIC;
          IF v_analysis.result_value < v_threshold THEN
            IF (v_rule.rule_config->>'min_r_squared')::NUMERIC IS NULL
               OR v_analysis.r_squared >=
                  (v_rule.rule_config->>'min_r_squared')::NUMERIC THEN
              v_condition_met := true;
            END IF;
          END IF;
        END IF;
      END IF;

    -- Evaluación: compound
    ELSIF v_rule.evaluation_type = 'compound' THEN
      v_compound_result := public.evaluate_compound_conditions(
        p_asset_id, v_rule.rule_config, v_rule.min_quality_flag
      );
      v_condition_met := v_compound_result;

    -- Evaluación: residual (z-score)
    ELSIF v_rule.evaluation_type = 'residual' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE(
        (v_rule.rule_config->>'min_z_score')::NUMERIC, 3.0);
      v_duration_windows := COALESCE(
        (v_rule.rule_config->>'duration_windows')::INT, 1);

      WITH residual_results AS (
        SELECT ar.result_value AS z_score, ar.window_end,
               ar.input_window_ids,
               ROW_NUMBER() OVER (ORDER BY ar.window_end DESC) AS rn
        FROM public.condition_analysis_results ar
        WHERE ar.asset_id = p_asset_id
          AND ar.analysis_type = 'residual'
          AND ar.method_key = 'adaptive_baseline'
          AND (v_fd_id IS NULL OR ar.feature_definition_id = v_fd_id)
          AND ar.result_value IS NOT NULL
        ORDER BY ar.window_end DESC
        LIMIT v_duration_windows
      )
      SELECT COUNT(*) INTO v_consecutive
      FROM residual_results WHERE z_score >= v_threshold;

      IF v_consecutive >= v_duration_windows THEN
        v_condition_met := true;

        SELECT ARRAY_AGG(input_window_ids ORDER BY window_end DESC)
                 FILTER (WHERE z_score >= v_threshold),
               ARRAY_AGG(z_score ORDER BY window_end DESC)
                 FILTER (WHERE z_score >= v_threshold)
        INTO v_residual_window_ids, v_residual_z_scores
        FROM (
          SELECT result_value AS z_score, window_end, input_window_ids
          FROM public.condition_analysis_results
          WHERE asset_id = p_asset_id
            AND analysis_type = 'residual'
            AND method_key = 'adaptive_baseline'
            AND (v_fd_id IS NULL OR feature_definition_id = v_fd_id)
            AND result_value IS NOT NULL
          ORDER BY window_end DESC
          LIMIT v_duration_windows
        ) sub;
      END IF;

    -- Evaluación: innovation_threshold
    ELSIF v_rule.evaluation_type = 'innovation_threshold' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE(
        (v_rule.rule_config->>'threshold')::NUMERIC, 3.0);
      v_duration_windows := COALESCE(
        (v_rule.rule_config->>'duration_windows')::INT, 1);

      WITH kalman_results AS (
        SELECT ar.innovation, ar.innovation_variance, ar.window_end,
               ROW_NUMBER() OVER (ORDER BY ar.window_end DESC) AS rn
        FROM public.condition_analysis_results ar
        WHERE ar.asset_id = p_asset_id
          AND ar.analysis_type = 'kalman_state'
          AND ar.innovation IS NOT NULL
          AND (v_fd_id IS NULL OR ar.feature_definition_id = v_fd_id)
        ORDER BY ar.window_end DESC
        LIMIT v_duration_windows
      )
      SELECT COUNT(*) INTO v_consecutive
      FROM kalman_results
      WHERE ABS(innovation) > v_threshold * SQRT(NULLIF(innovation_variance, 0));

      IF v_consecutive >= v_duration_windows THEN
        v_condition_met := true;
      END IF;

    -- Evaluación: z_score_threshold
    ELSIF v_rule.evaluation_type = 'z_score_threshold' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE(
        (v_rule.rule_config->>'min_z_score')::NUMERIC, 3.0);
      v_duration_windows := COALESCE(
        (v_rule.rule_config->>'duration_windows')::INT, 1);

      WITH residual_results AS (
        SELECT ar.result_value AS z_score, ar.window_end,
               ROW_NUMBER() OVER (ORDER BY ar.window_end DESC) AS rn
        FROM public.condition_analysis_results ar
        WHERE ar.asset_id = p_asset_id
          AND ar.analysis_type = 'residual'
          AND ar.method_key = 'adaptive_baseline'
          AND (v_fd_id IS NULL OR ar.feature_definition_id = v_fd_id)
          AND ar.result_value IS NOT NULL
        ORDER BY ar.window_end DESC
        LIMIT v_duration_windows
      )
      SELECT COUNT(*) INTO v_consecutive
      FROM residual_results WHERE z_score >= v_threshold;

      IF v_consecutive >= v_duration_windows THEN
        v_condition_met := true;
      END IF;

    -- Evaluación: trend_significance
    ELSIF v_rule.evaluation_type = 'trend_significance' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      SELECT ar.result_value, ar.r_squared, ar.id AS ar_id, ar.confidence
      INTO v_analysis
      FROM public.condition_analysis_results ar
      WHERE ar.asset_id = p_asset_id
        AND ar.analysis_type = 'trend_slope'
        AND ar.method_key = 'linear_regression'
        AND (v_fd_id IS NULL OR ar.feature_definition_id = v_fd_id)
        AND ar.result_value IS NOT NULL
      ORDER BY ar.window_end DESC
      LIMIT 1;

      IF v_analysis.result_value IS NOT NULL
         AND v_analysis.confidence > 0.5
         AND v_analysis.r_squared >= COALESCE(
           (v_rule.rule_config->>'min_r_squared')::NUMERIC, 0.5)
         AND ABS(v_analysis.result_value) >= COALESCE(
           (v_rule.rule_config->>'min_slope_abs')::NUMERIC, 0.01) THEN
        v_condition_met := true;
      END IF;

    -- Evaluación: compound_anomaly
    ELSIF v_rule.evaluation_type = 'compound_anomaly' THEN
      v_compound_result := public.evaluate_compound_conditions(
        p_asset_id, v_rule.rule_config, v_rule.min_quality_flag
      );
      v_condition_met := v_compound_result;

    -- ==========================================================
    -- EVALUACIÓN: diagnostic (SDD 4 — crea diagnosis, NO event)
    -- Carga matriz de evidencia, llama compute_diagnosis_confidence(),
    -- si confidence ≥ threshold crea condition_diagnosis.
    -- Usa DECLARE anidado para evitar conflicto con el DECLARE
    -- principal de la función.
    -- ==========================================================
    ELSIF v_rule.evaluation_type = 'diagnostic' THEN
      DECLARE
        v_fm_key TEXT;
        v_min_conf NUMERIC;
        v_diag_conf NUMERIC;
        v_diag_id UUID;
        v_auto_activate NUMERIC;
        v_diag_status TEXT;
        v_diag_fm_id UUID;
      BEGIN
        v_fm_key := v_rule.rule_config->>'failure_mode_key';
        v_min_conf := COALESCE(
          (v_rule.rule_config->>'min_confidence_threshold')::NUMERIC, 0.5);
        v_auto_activate := COALESCE(
          (v_rule.rule_config->>'auto_activate_on_threshold')::NUMERIC, 0.85);

        -- Regla candidate: evalúa pero no crea diagnosis
        IF v_rule.validation_status = 'candidate' THEN
          v_condition_met := false;
        ELSE
          -- Compute diagnosis confidence
          SELECT c.confidence INTO v_diag_conf
          FROM public.compute_diagnosis_confidence(p_asset_id, v_fm_key) c;

          IF v_diag_conf >= v_min_conf THEN
            -- Determinar diagnosis_status según validation_status de la regla
            v_diag_status := CASE v_rule.validation_status
              WHEN 'field_trial' THEN 'field_trial'
              WHEN 'active' THEN
                CASE WHEN v_diag_conf >= v_auto_activate
                  THEN 'active' ELSE 'candidate' END
              ELSE 'candidate'
            END;

            -- Resolver failure_mode_id
            SELECT id INTO v_diag_fm_id
            FROM public.condition_failure_mode_catalog
            WHERE failure_mode_key = v_fm_key;

            -- Insertar en condition_diagnoses (NO en condition_events)
            INSERT INTO public.condition_diagnoses (
              asset_id, failure_mode_id, diagnosis_status, confidence,
              evidence_summary
            ) VALUES (
              p_asset_id, v_diag_fm_id, v_diag_status, v_diag_conf,
              jsonb_build_object(
                'rule_name', v_rule.rule_name,
                'rule_id', v_rule.id,
                'evaluation_type', 'diagnostic',
                'feature_key', v_rule.feature_key,
                'min_confidence_threshold', v_min_conf,
                'auto_activate_on_threshold', v_auto_activate
              )
            ) RETURNING id INTO v_diag_id;

            -- Generar recomendación
            PERFORM public.generate_recommendation(v_diag_id);

            -- Vincular eventos existentes (últimos 7 días)
            UPDATE public.condition_events
            SET diagnosis_id = v_diag_id
            WHERE asset_id = p_asset_id
              AND diagnosis_id IS NULL
              AND created_at > NOW() - INTERVAL '7 days';

            v_count := v_count + 1;
          END IF;
        END IF;
      END;

    END IF;

    -- ── 2d. Si la regla dispara: crear evento ───────────────
    -- (No aplica para 'diagnostic' — ya creó diagnosis arriba)
    IF v_condition_met AND v_rule.evaluation_type != 'diagnostic' THEN
      v_event_severity := v_rule.severity;

      IF v_rule.method_key IS NOT NULL THEN
        SELECT validation_status INTO v_method_status
        FROM public.condition_analysis_methods
        WHERE method_key = v_rule.method_key;

        IF v_method_status IS NOT NULL
           AND v_method_status NOT IN ('active', 'field_trial', 'bench_validated') THEN
          IF v_event_severity = 'critical' THEN
            v_event_severity := 'warning';
          END IF;
        END IF;
      END IF;

      v_event_type := CASE v_rule.evaluation_type
        WHEN 'threshold' THEN 'threshold_exceeded'
        WHEN 'trend' THEN 'trend_detected'
        WHEN 'trend_significance' THEN 'trend_detected'
        WHEN 'compound' THEN 'threshold_exceeded'
        WHEN 'compound_anomaly' THEN 'threshold_exceeded'
        WHEN 'residual' THEN 'quality_degraded'
        WHEN 'z_score_threshold' THEN 'quality_degraded'
        WHEN 'innovation_threshold' THEN 'quality_degraded'
        ELSE 'threshold_exceeded'
      END;

      v_explain_json := jsonb_build_object(
        'feature_key', v_rule.feature_key,
        'deviation_type', v_rule.evaluation_type,
        'rule_name', v_rule.rule_name,
        'regime', v_regime,
        'source_window_ids', COALESCE(v_residual_window_ids, '{}')
      );

      INSERT INTO public.condition_events (
        asset_id, rule_id, event_type, severity,
        hi_value, dhi_dt_value, message
      ) VALUES (
        p_asset_id, v_rule.id,
        v_event_type, v_event_severity,
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'health_index'
         ORDER BY window_end DESC LIMIT 1),
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'trend_slope'
         ORDER BY window_end DESC LIMIT 1),
        v_explain_json::TEXT
      ) RETURNING id INTO v_event_id;

      IF v_fv.id IS NOT NULL THEN
        INSERT INTO public.condition_event_sources (
          event_id, feature_value_id, contribution_type
        ) VALUES (v_event_id, v_fv.id, 'primary');
      END IF;

      IF v_analysis.id IS NOT NULL THEN
        INSERT INTO public.condition_event_sources (
          event_id, analysis_result_id, contribution_type
        ) VALUES (v_event_id, v_analysis.id, 'contributing');
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.evaluate_condition_rules(TEXT)
  IS 'Evalúa reglas activas/field_trial para un activo. SDD 4 extiende: diagnostic (carga evidencia, llama compute_diagnosis_confidence(), crea diagnosis, NO event). DECLARE anidado.';

-- ============================================================
-- 11. SEED: 2 reglas diagnósticas (draft)
--     Cavitación: evalúa matriz de evidencia pump.cavitation
--     Desbalance: evalúa matriz de evidencia rotating.unbalance
-- ============================================================
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
)
ON CONFLICT (rule_name, version) DO NOTHING;

-- ============================================================
-- FIN MIGRATION: condition_diagnostic_functions (PR 1b)
-- ============================================================
