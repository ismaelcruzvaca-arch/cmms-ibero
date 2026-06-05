-- ============================================================
-- MIGRATION: sdd6_rul_calibration_functions — RUL Calibration
--   Functions + View (SDD 6, PR 4)
-- Change: condition-monitoring-performance-improvement (PR 4)
-- ============================================================
-- Implementa funciones de calibración de RUL y modifica
-- compute_rul_linear() para poblar snapshots:
--
--   1. compute_rul_calibration(p_asset_id, p_failure_mode_key,
--        p_days_window) — métricas de calibración (bias, MAPE,
--        under/overestimate rates, confidence calibration)
--   2. link_rul_outcomes() — vincula snapshots con outcomes
--        confirmados automáticamente
--   3. condition_prediction_calibration VIEW — wrapper sobre
--        compute_rul_calibration() para consultas directas
--   4. CREATE OR REPLACE compute_rul_linear() — modificada para
--        insertar snapshot en cada RUL exitoso
--
-- Idempotente: CREATE OR REPLACE FUNCTION/VIEW.
-- NULLIF denominator safety: retorna NULLs con 0 datos, no error.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN: compute_rul_calibration()
--    Métricas de calibración de RUL comparando predicciones
--    contra outcomes reales confirmados.
--
--    Para cada snapshot vinculado:
--      actual_rul = horas entre predicted_at y failure_date
--      bias = rul_mid - actual_rul
--      absolute_percentage_error = ABS(bias) / actual_rul
--      underestimate = rul_mid < actual_rul
--      overestimate = rul_mid > actual_rul
--
--    Retorna NULLs (no error) con 0 datos.
--    STABLE — no modifica datos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_rul_calibration(
  p_asset_id TEXT DEFAULT NULL,
  p_failure_mode_key TEXT DEFAULT NULL,
  p_days_window INT DEFAULT 365
)
RETURNS TABLE(
  asset_id TEXT,
  failure_mode_key TEXT,
  total_predictions INT,
  bias NUMERIC,
  mape NUMERIC,
  underestimate_rate NUMERIC,
  overestimate_rate NUMERIC,
  confidence_calibration NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_bias_sum NUMERIC;
  v_ape_sum NUMERIC;
  v_under_count INT;
  v_over_count INT;
  v_confidence_sum NUMERIC;
  v_calib_denom INT;
BEGIN
  -- Encontrar snapshots vinculados con outcomes confirmados
  -- actual_rul = horas entre predicted_at y failure_date del outcome
  SELECT
    COUNT(*),
    COALESCE(AVG(calibrated.rul_mid - calibrated.actual_rul), 0),
    SUM(ABS(calibrated.rul_mid - calibrated.actual_rul) / NULLIF(calibrated.actual_rul, 0)),
    COUNT(*) FILTER (WHERE calibrated.rul_mid < calibrated.actual_rul),
    COUNT(*) FILTER (WHERE calibrated.rul_mid > calibrated.actual_rul),
    COALESCE(AVG(calibrated.confidence), 0),
    COUNT(*) FILTER (WHERE calibrated.confidence IS NOT NULL)
  INTO v_total, v_bias_sum, v_ape_sum, v_under_count, v_over_count, v_confidence_sum, v_calib_denom
  FROM (
    SELECT
      s.rul_mid,
      s.confidence,
      EXTRACT(EPOCH FROM (co.failure_date - s.predicted_at)) / 3600 AS actual_rul
    FROM public.condition_prediction_snapshots s
    JOIN public.condition_outcomes co ON co.id = s.actual_outcome_id
    WHERE co.confirmed_status = 'confirmed'
      AND co.failure_date IS NOT NULL
      AND s.rul_mid IS NOT NULL
      AND (p_asset_id IS NULL OR s.asset_id = p_asset_id)
      AND (p_failure_mode_key IS NULL OR s.failure_mode_key = p_failure_mode_key)
      AND s.predicted_at >= NOW() - (p_days_window || ' days')::INTERVAL
  ) calibrated;

  -- Si no hay datos, retornar una fila con NULLs (no error)
  IF v_total = 0 THEN
    RETURN QUERY SELECT
      p_asset_id::TEXT,
      p_failure_mode_key::TEXT,
      NULL::INT,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC;
    RETURN;
  END IF;

  -- Retornar métricas agregadas
  RETURN QUERY SELECT
    COALESCE(p_asset_id, '(all)')::TEXT,
    COALESCE(p_failure_mode_key, '(all)')::TEXT,
    v_total,
    ROUND(v_bias_sum, 2),                                    -- bias promedio
    ROUND(v_ape_sum / NULLIF(v_total, 0), 4),                -- MAPE
    ROUND(v_under_count::NUMERIC / v_total, 4),              -- underestimate_rate
    ROUND(v_over_count::NUMERIC / v_total, 4),               -- overestimate_rate
    ROUND(v_confidence_sum / NULLIF(v_calib_denom, 0), 4);   -- confidence_calibration
END;
$$;

COMMENT ON FUNCTION public.compute_rul_calibration(TEXT, TEXT, INT)
  IS 'Métricas de calibración de RUL: bias (error medio), MAPE (mean absolute percentage error), underestimate_rate, overestimate_rate, confidence_calibration. Compara rul_mid de snapshots con actual_rul (horas desde predicted_at hasta failure_date del outcome confirmado). Retorna NULLs (no error) con 0 datos. STABLE — no modifica datos.';


-- ============================================================
-- 2. FUNCIÓN: link_rul_outcomes()
--    Vincula snapshots de predicción con outcomes confirmados.
--    Busca outcomes con confirmed_status='confirmed' y los
--    match con snapshots por asset_id + failure_mode_key.
--
--    Criterios de matching:
--      - mismo asset_id (via condition_diagnoses)
--      - mismo failure_mode_key (via condition_failure_mode_catalog)
--      - snapshot.actual_outcome_id IS NULL (no vinculado aún)
--      - snapshot fue creado ANTES del outcome
--
--    Retorna cantidad de snapshots actualizados.
--    Puede llamarse manualmente o mediante schedule.
-- ============================================================
CREATE OR REPLACE FUNCTION public.link_rul_outcomes()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH to_link AS (
    SELECT DISTINCT s.id AS snapshot_id, co.id AS outcome_id
    FROM public.condition_prediction_snapshots s
    JOIN public.condition_outcomes co ON co.confirmed_status = 'confirmed'
    JOIN public.condition_diagnoses cd ON cd.id = co.diagnosis_id
    JOIN public.condition_failure_mode_catalog cfmc ON cfmc.id = cd.failure_mode_id
    WHERE s.actual_outcome_id IS NULL
      AND s.asset_id = cd.asset_id
      AND s.failure_mode_key = cfmc.failure_mode_key
      AND s.predicted_at < co.created_at  -- snapshot tomada antes del outcome
  )
  UPDATE public.condition_prediction_snapshots s
  SET actual_outcome_id = tl.outcome_id
  FROM to_link tl
  WHERE s.id = tl.snapshot_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.link_rul_outcomes()
  IS 'Vincula snapshots de predicción con outcomes confirmados. Match por asset_id + failure_mode_key entre snapshots y outcomes (via condition_diagnoses + condition_failure_mode_catalog). Solo vincula snapshots con actual_outcome_id=NULL y creados antes del outcome. Retorna cantidad de snapshots actualizados.';


-- ============================================================
-- 3. VISTA: condition_prediction_calibration
--    Wrapper sobre compute_rul_calibration() para consultas
--    directas sin llamar a la función.
--    Siempre retorna todas las calibraciones disponibles.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_prediction_calibration
AS
SELECT * FROM public.compute_rul_calibration(NULL, NULL, 365);

COMMENT ON VIEW public.condition_prediction_calibration
  IS 'Vista de calibración de predicciones RUL. Wrapper sobre compute_rul_calibration(NULL, NULL, 365). Retorna bias, MAPE, under/overestimate rates y confidence_calibration globales. Consultar directamente sin parámetros.';


-- ============================================================
-- 4. CREATE OR REPLACE: compute_rul_linear()
--    Modificación SDD 6: ahora inserta un snapshot de
--    predicción en condition_prediction_snapshots cada vez que
--    computa un RUL exitosamente.
--
--    Cambios respecto a SDD 4:
--      - Captura diagnosis_id (v_diag_id) de la diagnosis activa
--      - Captura v_ar_id del INSERT en condition_analysis_results
--      - Inserta fila en condition_prediction_snapshots al final
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_rul_linear(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_failure_mode_key TEXT
)
RETURNS TABLE(
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
  v_diag_id UUID;          -- SDD 6: capturar diagnosis_id
  v_diag_confidence NUMERIC;
  v_current_value NUMERIC;
  v_slope_per_day NUMERIC;
  v_unit TEXT;
  v_quality_ok BOOLEAN;
  v_fm_id UUID;
  v_assumptions TEXT[] := '{}';
  v_ar_id UUID;
BEGIN
  SELECT id, unit INTO v_fd_id, v_unit
  FROM public.condition_feature_definitions WHERE feature_key = p_feature_key;
  IF v_fd_id IS NULL THEN
    assumptions := ARRAY['feature_key_not_found:' || p_feature_key];
    RETURN NEXT; RETURN;
  END IF;

  SELECT ar.result_value, ar.r_squared, ar.confidence,
         (ar.parameters->>'sample_count')::INT AS sample_count, ar.window_end
  INTO v_trend
  FROM public.condition_analysis_results ar
  WHERE ar.asset_id = p_asset_id
    AND ar.feature_definition_id = v_fd_id
    AND ar.analysis_type = 'trend_slope'
    AND ar.method_key = 'linear_regression'
    AND ar.r_squared >= 0.5
    AND ar.result_value IS NOT NULL
  ORDER BY ar.window_end DESC LIMIT 1;

  IF NOT FOUND THEN
    assumptions := ARRAY['r2_below_threshold:no_trend_found'];
    RETURN NEXT; RETURN;
  END IF;

  v_slope_per_day := v_trend.result_value;

  IF v_trend.sample_count IS NULL OR v_trend.sample_count < 10 THEN
    assumptions := ARRAY['insufficient_samples:' || COALESCE(v_trend.sample_count::TEXT, 'NULL')];
    RETURN NEXT; RETURN;
  END IF;

  IF v_slope_per_day <= 0 THEN
    assumptions := ARRAY['slope_not_positive:' || ROUND(v_slope_per_day::NUMERIC, 6)::TEXT];
    RETURN NEXT; RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND cfv.quality_flag IN ('G0', 'G1')
    ORDER BY cw.window_end DESC LIMIT 1
  ) INTO v_quality_ok;

  IF NOT v_quality_ok THEN
    assumptions := ARRAY['quality_too_low:latest_not_G0_or_G1'];
    RETURN NEXT; RETURN;
  END IF;

  SELECT cfv.value INTO v_current_value
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows cw ON cfv.window_id = cw.id
  WHERE cw.asset_id = p_asset_id
    AND cfv.feature_definition_id = v_fd_id
  ORDER BY cw.window_end DESC LIMIT 1;

  IF v_current_value IS NULL THEN
    assumptions := ARRAY['no_current_value'];
    RETURN NEXT; RETURN;
  END IF;

  SELECT zone_c_max INTO v_threshold
  FROM public.get_applicable_thresholds(
    p_asset_id, v_fd_id, 'rms_velocity_window',
    (SELECT operational_context->>'regime' FROM public.condition_windows WHERE asset_id = p_asset_id ORDER BY window_end DESC LIMIT 1)
  );

  IF v_threshold.zone_c_max IS NULL OR v_threshold.zone_c_max <= v_current_value THEN
    v_rul := 0;
    v_assumptions := v_assumptions || ARRAY['threshold_reached_or_exceeded'];
  ELSE
    v_rul := (v_threshold.zone_c_max - v_current_value) / v_slope_per_day * 24;
    v_assumptions := v_assumptions || ARRAY['degradation_is_linear', 'operating_regime_constant', 'threshold_represents_functional_failure'];
  END IF;

  SELECT id INTO v_fm_id FROM public.condition_failure_mode_catalog WHERE failure_mode_key = p_failure_mode_key;

  -- SDD 6: capturar también diagnosis_id
  SELECT cd.id, cd.confidence INTO v_diag_id, v_diag_confidence
  FROM public.condition_diagnoses cd
  WHERE cd.asset_id = p_asset_id AND cd.failure_mode_id = v_fm_id
    AND cd.diagnosis_status IN ('active', 'field_trial')
  ORDER BY cd.created_at DESC LIMIT 1;

  v_diag_confidence := COALESCE(v_diag_confidence, 0.5);
  v_confidence := LEAST(COALESCE(v_trend.r_squared, 0), COALESCE(v_diag_confidence, 0));
  v_rul_low := GREATEST(0, v_rul * 0.8);
  v_rul_high := v_rul * 1.2;

  INSERT INTO public.condition_analysis_results (
    asset_id, feature_definition_id, analysis_type, method_key, method_version,
    result_value, result_unit, confidence, r_squared, parameters, window_end, validation_status
  ) VALUES (
    p_asset_id, v_fd_id, 'rul_estimate', 'linear_extrapolation', '1.0',
    v_rul, 'hours', v_confidence, v_trend.r_squared,
    jsonb_build_object(
      'method', 'linear_extrapolation', 'current_value', v_current_value,
      'threshold_value', v_threshold.zone_c_max, 'slope_per_day', v_slope_per_day,
      'rul_hours', v_rul, 'rul_low_estimate', v_rul_low, 'rul_high_estimate', v_rul_high,
      'uncertainty_range_pct', 20, 'diagnosis_confidence_used', v_diag_confidence,
      'failure_mode_key', p_failure_mode_key, 'trend_r_squared', v_trend.r_squared,
      'trend_window_end', v_trend.window_end, 'assumptions', to_jsonb(v_assumptions)
    ),
    NOW(), 'active'
  )
  RETURNING id INTO v_ar_id;

  -- SDD 6: Guardar snapshot de predicción para calibración futura
  INSERT INTO public.condition_prediction_snapshots (
    asset_id, diagnosis_id, failure_mode_key, prediction_type,
    predicted_at, rul_low, rul_mid, rul_high, unit, confidence,
    method_key, method_version, model_key, model_version,
    threshold_id, input_analysis_result_ids
  ) VALUES (
    p_asset_id, v_diag_id, p_failure_mode_key, 'rul_estimate',
    NOW(), v_rul_low, v_rul, v_rul_high, 'hours', v_confidence,
    'linear_extrapolation', '1.0', 'linear_extrapolation', 1,
    v_threshold.zone_c_max::TEXT, ARRAY[v_ar_id]
  );

  rul_hours := v_rul;
  confidence := v_confidence;
  uncertainty_low := v_rul_low;
  uncertainty_high := v_rul_high;
  assumptions := v_assumptions;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_rul_linear(TEXT, TEXT, TEXT)
  IS 'Estima RUL (horas) por extrapolación lineal. SDD 4 original + SDD 6: inserta snapshot en condition_prediction_snapshots para calibración. Gates: feature_key válido, R²>=0.5, samples>=10, slope>0, calidad G0/G1. Retorna rul_hours, confidence, uncertainty_low/high y array de assumptions. SECURITY DEFINER.';


-- ============================================================
-- FIN MIGRATION: sdd6_rul_calibration_functions
-- ============================================================
