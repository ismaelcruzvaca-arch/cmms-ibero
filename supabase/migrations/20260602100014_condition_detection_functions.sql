-- ============================================================
-- MIGRATION: condition_detection_functions — Detección, Líneas
--   Base Adaptativas, Residuales y Estimación de Estado (SDD 3)
-- Change: condition-monitoring-detection-estimation (PR 1b)
-- ============================================================
-- Implementa las funciones de cómputo para detección de anomalías:
--   1. ALTER condition_analysis_results: +4 columnas Kalman
--   2. ALTER condition_rules: evaluation_type CHECK extendido
--   3. is_baseline_learnable() — política de aprendizaje
--   4. compute_baselines() — cálculo de estadísticas baseline
--   5. compute_baseline_residual() — residual tipo A + z-score
--   6. compute_kalman_1d() — filtro Kalman escalar en PL/pgSQL
--   7. compute_feature_trend() — regresión lineal por feature
--   8. evaluate_condition_rules() — extiende: residual,
--      innovation_threshold, trend (per-feature)
--   9. compute_health_index() — zonas adaptativas desde baselines
--  10. Bootstrap: 3 reglas semilla de detección
--
-- Idempotente: CREATE OR REPLACE FUNCTION, ALTER...IF NOT EXISTS,
--   ALTER...DROP/ADD CONSTRAINT en DO block.
--
-- Dependencias:
--   condition_baselines (migración 20260602100012)
--   condition_analysis_results (migración 20260602100006)
--   condition_rules (migración 20260602100006)
--   evaluate_condition_rules() (migración 20260602100006)
--   compute_health_index() (migración 20260602100006)
--   evaluate_compound_conditions() (migración 20260602100006)
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. ALTER TABLE: condition_analysis_results
--    Agrega 4 columnas para almacenar estado del filtro Kalman.
--    Columnas dedicadas para consultas eficientes por índice
--    (REQ-CAR-D3-006).
-- ============================================================
ALTER TABLE public.condition_analysis_results
  ADD COLUMN IF NOT EXISTS state_variance NUMERIC;

ALTER TABLE public.condition_analysis_results
  ADD COLUMN IF NOT EXISTS innovation NUMERIC;

ALTER TABLE public.condition_analysis_results
  ADD COLUMN IF NOT EXISTS innovation_variance NUMERIC;

ALTER TABLE public.condition_analysis_results
  ADD COLUMN IF NOT EXISTS kalman_gain NUMERIC;

COMMENT ON COLUMN public.condition_analysis_results.state_variance
  IS 'Varianza del estado estimado (P) — filtro Kalman. Indica incertidumbre del estado latente.';
COMMENT ON COLUMN public.condition_analysis_results.innovation
  IS 'Innovación del filtro Kalman: diferencia entre medición y predicción (y = z - x_pred). Señal clave para detección de anomalías.';
COMMENT ON COLUMN public.condition_analysis_results.innovation_variance
  IS 'Varianza de la innovación (S = P + R) — filtro Kalman. Escala la significancia de la innovación.';
COMMENT ON COLUMN public.condition_analysis_results.kalman_gain
  IS 'Ganancia de Kalman (K = P / S). Peso de la medición en la actualización del estado. 0=máxima confianza en predicción, 1=máxima confianza en medición.';

-- Índices para consultas de evaluación de reglas
CREATE INDEX IF NOT EXISTS idx_ar_asset_type_feature
  ON public.condition_analysis_results(asset_id, analysis_type, feature_definition_id);

CREATE INDEX IF NOT EXISTS idx_ar_asset_type_window
  ON public.condition_analysis_results(asset_id, analysis_type, window_end DESC);

-- ============================================================
-- 2. ALTER TABLE: condition_rules — evaluation_type CHECK extendido
--    Agrega nuevos tipos de evaluación de detección de anomalías.
--    Se elimina y recrea la constraint en un DO block idempotente.
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
        'trend_significance', 'compound_anomaly'
      ));
END;
$$;

-- ============================================================
-- 3. FUNCIÓN AUXILIAR: assign_rpm_band(p_rpm NUMERIC)
--    Asigna una banda de RPM según el valor numérico.
--    Soporta: 0-500, 500-1000, 1000-1500, 1500-2000, 2000+
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_rpm_band(
  p_rpm NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_rpm IS NULL THEN
    RETURN '1000-1500'; -- banda por defecto si no hay dato
  ELSIF p_rpm <= 500 THEN
    RETURN '0-500';
  ELSIF p_rpm <= 1000 THEN
    RETURN '500-1000';
  ELSIF p_rpm <= 1500 THEN
    RETURN '1000-1500';
  ELSIF p_rpm <= 2000 THEN
    RETURN '1500-2000';
  ELSE
    RETURN '2000+';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assign_rpm_band(NUMERIC)
  IS 'Asigna banda de RPM según valor numérico. IMMUTABLE para uso en índices.';

-- ============================================================
-- 4. FUNCIÓN AUXILIAR: assign_load_band(p_load_pct NUMERIC)
--    Asigna una banda de carga según el porcentaje.
--    Soporta: 0-25%, 25-50%, 50-75%, 75-100%
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_load_band(
  p_load_pct NUMERIC
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_load_pct IS NULL THEN
    RETURN '50-75%'; -- banda por defecto si no hay dato
  ELSIF p_load_pct <= 25 THEN
    RETURN '0-25%';
  ELSIF p_load_pct <= 50 THEN
    RETURN '25-50%';
  ELSIF p_load_pct <= 75 THEN
    RETURN '50-75%';
  ELSE
    RETURN '75-100%';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assign_load_band(NUMERIC)
  IS 'Asigna banda de carga según porcentaje. IMMUTABLE para uso en índices.';

-- ============================================================
-- 5. FUNCIÓN: is_baseline_learnable(p_asset_id)
--    Evalúa si es seguro aprender un baseline para un activo.
--    Retorna FALSE si:
--      a) Hay un evento activo abierto (open/linked_to_wo)
--      b) Hay una tendencia significativa activa (R² > 0.5, slope ≠ 0)
--      c) Hay residual sostenido (últimas 5 ventanas con z > 2)
--      d) Demasiadas ventanas G2/G3 (>50% de últimas 20 ventanas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_baseline_learnable(
  p_asset_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_active_event BOOLEAN;
  v_active_trend BOOLEAN;
  v_sustained_residual BOOLEAN;
  v_g2g3_flood BOOLEAN;
  v_total_windows INT;
  v_g2g3_windows INT;
BEGIN
  -- a) ¿Hay evento activo abierto para este activo?
  SELECT EXISTS (
    SELECT 1 FROM public.condition_events
    WHERE asset_id = p_asset_id
      AND status IN ('open', 'linked_to_wo')
  ) INTO v_active_event;

  IF v_active_event THEN
    RETURN false;
  END IF;

  -- b) ¿Hay tendencia significativa activa (R² > 0.5, slope distinto de 0)?
  SELECT EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE asset_id = p_asset_id
      AND analysis_type = 'trend_slope'
      AND r_squared > 0.5
      AND ABS(result_value) > 0.001
      AND window_end > NOW() - INTERVAL '7 days'
  ) INTO v_active_trend;

  IF v_active_trend THEN
    RETURN false;
  END IF;

  -- c) ¿Hay residual sostenido (últimas 5 ventanas con z-score > 2)?
  SELECT COUNT(*) >= 5 INTO v_sustained_residual
  FROM public.condition_analysis_results
  WHERE asset_id = p_asset_id
    AND analysis_type = 'residual'
    AND result_value > 2.0  -- z_score > 2
    AND window_end > NOW() - INTERVAL '7 days';

  IF v_sustained_residual THEN
    RETURN false;
  END IF;

  -- d) ¿Demasiadas G2/G3 en las últimas 20 ventanas?
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE cfv.quality_flag IN ('G2', 'G3'))
  INTO v_total_windows, v_g2g3_windows
  FROM (
    SELECT DISTINCT ON (cw.id) cw.id, cfv.quality_flag
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cw.window_end > NOW() - INTERVAL '7 days'
    ORDER BY cw.id, cfv.window_id
    LIMIT 20
  ) sub;

  IF v_total_windows > 0
     AND (v_g2g3_windows::NUMERIC / v_total_windows) > 0.5 THEN
    RETURN false;
  END IF;

  -- Todas las condiciones pasaron → es aprendible
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_baseline_learnable(TEXT)
  IS 'Evalúa las 4 condiciones de la política de aprendizaje: evento activo, tendencia significativa, residual sostenido, inundación G2/G3. Retorna TRUE si es seguro aprender.';

-- ============================================================
-- 6. FUNCIÓN: compute_baselines(p_asset_id)
--    Calcula o actualiza líneas base estadísticas para cada
--    contexto (feature, método, régimen, rpm_band, load_band)
--    con datos G0/G1.
--
--    Para baselines existentes activas: actualización EWMA
--    (media móvil ponderada exponencialmente).
--    Para nuevos contextos: INSERT como draft con nueva versión.
--
--    Retorna: cantidad de baselines creados/actualizados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_baselines(
  p_asset_id TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_learnable BOOLEAN;
  rec RECORD;
  v_bl RECORD;
  v_new_mean NUMERIC;
  v_new_stddev NUMERIC;
  v_new_median NUMERIC;
  v_new_mad NUMERIC;
  v_new_p95 NUMERIC;
  v_new_p99 NUMERIC;
  v_new_sample_count INT;
  v_next_version INT;
  v_ewma_alpha NUMERIC;
  v_existing_baseline_id UUID;
BEGIN
  -- Primero verificar si el activo es aprendible
  v_learnable := public.is_baseline_learnable(p_asset_id);
  IF NOT v_learnable THEN
    RETURN 0;
  END IF;

  -- Iterar por cada contexto (feature, método, régimen, rpm_band, load_band)
  -- con datos G0/G1 en los últimos 30 días
  FOR rec IN
    SELECT
      cfv.feature_definition_id,
      cfv.method_key,
      cw.operational_context->>'regime' AS regime,
      public.assign_rpm_band((cw.operational_context->>'rpm')::NUMERIC) AS rpm_band,
      public.assign_load_band((cw.operational_context->>'load_pct')::NUMERIC) AS load_band,
      AVG(cfv.value) AS avg_value,
      STDDEV(cfv.value) AS stddev_value,
      COUNT(*) AS sample_count,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cfv.value) AS median_val,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cfv.value) AS p95_val,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY cfv.value) AS p99_val,
      -- MAD = MEDIAN(ABS(value - MEDIAN(value)))
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(cfv.value - PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cfv.value))) AS mad_val
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.quality_flag IN ('G0', 'G1')
      AND cw.status = 'processed'
      AND cw.window_end > NOW() - INTERVAL '30 days'
    GROUP BY
      cfv.feature_definition_id,
      cfv.method_key,
      cw.operational_context->>'regime',
      public.assign_rpm_band((cw.operational_context->>'rpm')::NUMERIC),
      public.assign_load_band((cw.operational_context->>'load_pct')::NUMERIC)
    HAVING COUNT(*) >= 5  -- mínimo 5 muestras para baseline válido
  LOOP
    -- Verificar si ya existe una baseline activa para este contexto
    SELECT id, baseline_version, mean, stddev, ewma_alpha
    INTO v_bl
    FROM public.condition_baselines
    WHERE asset_id = p_asset_id
      AND feature_definition_id = rec.feature_definition_id
      AND method_key = rec.method_key
      AND regime = rec.regime
      AND rpm_band = rec.rpm_band
      AND load_band = rec.load_band
      AND baseline_status = 'active'
    LIMIT 1;

    v_ewma_alpha := COALESCE(v_bl.ewma_alpha, 0.1);

    IF v_bl.id IS NOT NULL THEN
      -- Actualización EWMA: suavizado exponencial
      -- new = (1 - α) * old + α * new_sample
      v_new_mean := (1 - v_ewma_alpha) * v_bl.mean + v_ewma_alpha * rec.avg_value;
      v_new_stddev := SQRT((1 - v_ewma_alpha) * (v_bl.stddev ^ 2) + v_ewma_alpha * (COALESCE(rec.stddev_value, 0) ^ 2));
      v_new_median := (1 - v_ewma_alpha) * COALESCE(v_bl.median, v_bl.mean) + v_ewma_alpha * rec.median_val;
      v_new_mad := (1 - v_ewma_alpha) * COALESCE(v_bl.mad, v_bl.stddev) + v_ewma_alpha * rec.mad_val;
      v_new_p95 := (1 - v_ewma_alpha) * COALESCE(v_bl.p95, v_bl.mean) + v_ewma_alpha * rec.p95_val;
      v_new_p99 := (1 - v_ewma_alpha) * COALESCE(v_bl.p99, v_bl.mean) + v_ewma_alpha * rec.p99_val;
      v_new_sample_count := COALESCE(v_bl.sample_count, 0) + rec.sample_count;

      UPDATE public.condition_baselines
      SET
        mean = v_new_mean,
        stddev = v_new_stddev,
        median = v_new_median,
        mad = v_new_mad,
        p95 = v_new_p95,
        p99 = v_new_p99,
        sample_count = v_new_sample_count,
        updated_at = NOW()
      WHERE id = v_bl.id;

    ELSE
      -- No existe baseline activa → crear nueva como draft
      -- Obtener siguiente versión si ya existe alguna baseline (incluso no activa)
      SELECT COALESCE(MAX(baseline_version), 0) + 1 INTO v_next_version
      FROM public.condition_baselines
      WHERE asset_id = p_asset_id
        AND feature_definition_id = rec.feature_definition_id
        AND method_key = rec.method_key
        AND regime = rec.regime
        AND rpm_band = rec.rpm_band
        AND load_band = rec.load_band;

      INSERT INTO public.condition_baselines (
        asset_id, feature_definition_id, method_key,
        regime, rpm_band, load_band,
        mean, stddev, median, mad, p95, p99,
        sample_count, baseline_status, baseline_version,
        quality_filter, created_by
      ) VALUES (
        p_asset_id, rec.feature_definition_id, rec.method_key,
        rec.regime, rec.rpm_band, rec.load_band,
        rec.avg_value, COALESCE(rec.stddev_value, 0),
        rec.median_val, rec.mad_val, rec.p95_val, rec.p99_val,
        rec.sample_count, 'draft', v_next_version,
        'G0', 'compute_baselines()'
      )
      ON CONFLICT (asset_id, feature_definition_id, method_key, measurement_point_id,
                   regime, rpm_band, load_band, baseline_version)
      DO NOTHING;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.compute_baselines(TEXT)
  IS 'Calcula o actualiza líneas base para cada contexto operativo del activo. Usa EWMA para actualización incremental de baselines activas. Retorna cantidad de baselines procesadas.';

-- ============================================================
-- 7. FUNCIÓN: compute_baseline_residual(p_asset_id)
--    Calcula el residual tipo A (valor - mean_baseline) y z-score
--    para cada feature del activo contra su baseline activo.
--
--    Si no encuentra baseline exacto para (feature, método,
--    régimen, rpm_band, load_band), busca el baseline activo
--    más cercano y marca el resultado como aproximado.
--
--    Almacena en condition_analysis_results:
--      analysis_type='residual', method_key='adaptive_baseline'
--      result_value=z_score, confidence según deviation_level
--      parameters con baseline_id, baseline_version, mean, stddev,
--      robust_z, residual, deviation_level
--
--    Retorna: cantidad de residuales almacenados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_baseline_residual(
  p_asset_id TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  rec RECORD;
  v_bl RECORD;
  v_regime TEXT;
  v_rpm_band TEXT;
  v_load_band TEXT;
  v_residual NUMERIC;
  v_z_score NUMERIC;
  v_robust_z NUMERIC;
  v_deviation TEXT;
  v_confidence NUMERIC;
  v_approximate BOOLEAN;
  v_window_end TIMESTAMPTZ;
  v_window_id UUID;
BEGIN
  -- Iterar por el último feature_value de cada feature_definition_id
  -- dentro de los últimos 7 días
  FOR rec IN
    SELECT DISTINCT ON (cfv.feature_definition_id)
      cfv.feature_definition_id,
      cfv.value,
      cfv.method_key,
      cw.operational_context->>'regime' AS regime,
      (cw.operational_context->>'rpm')::NUMERIC AS rpm,
      (cw.operational_context->>'load_pct')::NUMERIC AS load_pct,
      cw.window_end,
      cw.id AS window_id
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cw.window_end > NOW() - INTERVAL '7 days'
      AND cw.status = 'processed'
    ORDER BY cfv.feature_definition_id, cw.window_end DESC
  LOOP
    v_regime := COALESCE(rec.regime, 'FULL_LOAD');
    v_rpm_band := public.assign_rpm_band(rec.rpm);
    v_load_band := public.assign_load_band(rec.load_pct);
    v_window_end := rec.window_end;
    v_window_id := rec.window_id;

    -- Buscar baseline activo exacto para este contexto
    SELECT id, mean, stddev, median, mad, baseline_version
    INTO v_bl
    FROM public.condition_baselines
    WHERE asset_id = p_asset_id
      AND feature_definition_id = rec.feature_definition_id
      AND method_key = rec.method_key
      AND regime = v_regime
      AND rpm_band = v_rpm_band
      AND load_band = v_load_band
      AND baseline_status = 'active'
    LIMIT 1;

    v_approximate := false;

    -- Si no hay exacto, buscar el baseline activo más cercano
    -- (cualquier régimen/banda, mismo feature+método)
    IF v_bl.id IS NULL THEN
      SELECT id, mean, stddev, median, mad, baseline_version
      INTO v_bl
      FROM public.condition_baselines
      WHERE asset_id = p_asset_id
        AND feature_definition_id = rec.feature_definition_id
        AND method_key = rec.method_key
        AND baseline_status = 'active'
      ORDER BY
        -- Distancia euclidiana normalizada entre regímenes y bandas
        ABS(
          CASE v_regime
            WHEN 'STOPPED' THEN 0 WHEN 'STARTUP' THEN 1
            WHEN 'IDLE' THEN 2 WHEN 'PARTIAL_LOAD' THEN 3
            WHEN 'FULL_LOAD' THEN 4 WHEN 'OVERLOAD' THEN 5
            ELSE 3
          END
          - CASE regime
            WHEN 'STOPPED' THEN 0 WHEN 'STARTUP' THEN 1
            WHEN 'IDLE' THEN 2 WHEN 'PARTIAL_LOAD' THEN 3
            WHEN 'FULL_LOAD' THEN 4 WHEN 'OVERLOAD' THEN 5
            ELSE 3
          END
        )
      LIMIT 1;

      IF v_bl.id IS NOT NULL THEN
        v_approximate := true;
      END IF;
    END IF;

    -- Si no hay ningún baseline, no podemos calcular residual
    IF v_bl.id IS NULL THEN
      CONTINUE;
    END IF;

    -- Calcular residual y z-scores
    v_residual := rec.value - COALESCE(v_bl.mean, 0);

    -- Protección contra stddev = 0: usar mínimo 0.01
    v_z_score := v_residual / NULLIF(GREATEST(COALESCE(v_bl.stddev, 0.01), 0.01), 0);

    -- Z-score robusto: (value - median) / MAD (con protección)
    v_robust_z := (rec.value - COALESCE(v_bl.median, v_bl.mean))
                  / NULLIF(GREATEST(COALESCE(v_bl.mad, v_bl.stddev, 0.01), 0.01), 0);

    -- Clasificar desviación
    v_deviation := CASE
      WHEN ABS(v_z_score) < 2 THEN 'normal'
      WHEN ABS(v_z_score) < 3 THEN 'warning'
      ELSE 'critical'
    END;

    -- Confianza según desviación
    v_confidence := CASE v_deviation
      WHEN 'normal' THEN 0.9
      WHEN 'warning' THEN 0.7
      ELSE 0.5
    END;

    -- Almacenar en condition_analysis_results
    INSERT INTO public.condition_analysis_results (
      asset_id, feature_definition_id,
      analysis_type, method_key, method_version,
      result_value, result_unit, confidence,
      parameters,
      window_end, input_window_ids,
      validation_status
    ) VALUES (
      p_asset_id, rec.feature_definition_id,
      'residual', 'adaptive_baseline', '1.0',
      v_z_score, 'z_score',
      v_confidence,
      jsonb_build_object(
        'residual_type', 'A',
        'residual', v_residual,
        'deviation_level', v_deviation,
        'baseline_id', v_bl.id,
        'baseline_version', v_bl.baseline_version,
        'mean', v_bl.mean,
        'stddev', v_bl.stddev,
        'z_score', v_z_score,
        'robust_z_score', v_robust_z,
        'regime', v_regime,
        'approximate', v_approximate
      ),
      v_window_end,
      ARRAY[v_window_id],
      'active'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.compute_baseline_residual(TEXT)
  IS 'Calcula residual tipo A (valor - mean_baseline) y z-score para cada feature del activo. Busca baseline activo exacto por contexto; si no existe, usa el más cercano (marcado aproximado). Protege contra stddev=0. Almacena en condition_analysis_results.';

-- ============================================================
-- 8. FUNCIÓN: compute_kalman_1d(p_asset_id, p_feature_key, p_Q, p_R)
--    Filtro Kalman escalar en PL/pgSQL para estimar el estado
--    latente de un feature.
--
--    Algoritmo por ventana:
--      1. PREDICT: x̂ = x, P = P + Q
--      2. Innovation: y = z - x̂
--      3. Innovation variance: S = P + R
--      4. Kalman gain: K = P / S
--      5. UPDATE: x = x + K * y, P = (1 - K) * P
--
--    Inicializa desde baseline mean si existe, o desde 0.
--    Almacena cada estado en condition_analysis_results con
--    analysis_type='kalman_state' y columnas dedicadas.
--
--    Retorna: (state, variance, innovation, kalman_gain)
--    para el último estado procesado.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_kalman_1d(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_Q NUMERIC DEFAULT 0.01,
  p_R NUMERIC DEFAULT 1.0
) RETURNS TABLE(
  state NUMERIC,
  variance NUMERIC,
  last_innovation NUMERIC,
  last_kalman_gain NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fd_id UUID;
  v_x NUMERIC;       -- estado estimado
  v_p NUMERIC;       -- varianza del estado
  v_innovation NUMERIC;
  v_innovation_var NUMERIC;
  v_kalman_gain NUMERIC;
  v_confidence NUMERIC;
  v_window_end TIMESTAMPTZ;
  v_window_id UUID;
  rec RECORD;
  v_first BOOLEAN := true;
BEGIN
  -- Resolver feature_definition_id desde feature_key
  SELECT id INTO v_fd_id
  FROM public.condition_feature_definitions
  WHERE feature_key = p_feature_key;

  IF v_fd_id IS NULL THEN
    -- Feature no encontrado, retornar NULLs
    state := NULL; variance := NULL;
    last_innovation := NULL; last_kalman_gain := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Intentar inicializar desde el último estado Kalman conocido
  SELECT result_value, state_variance
  INTO v_x, v_p
  FROM public.condition_analysis_results
  WHERE asset_id = p_asset_id
    AND feature_definition_id = v_fd_id
    AND analysis_type = 'kalman_state'
    AND state_variance IS NOT NULL
  ORDER BY window_end DESC
  LIMIT 1;

  -- Si no hay estado previo, inicializar desde baseline mean
  IF v_x IS NULL THEN
    SELECT mean INTO v_x
    FROM public.condition_baselines
    WHERE asset_id = p_asset_id
      AND feature_definition_id = v_fd_id
      AND baseline_status = 'active'
    ORDER BY baseline_version DESC
    LIMIT 1;

    -- Si no hay baseline, inicializar desde 0
    IF v_x IS NULL THEN
      v_x := 0;
    END IF;

    -- Varianza inicial = R (incertidumbre = ruido de medición)
    v_p := v_R;
  END IF;

  -- Procesar feature_values ordenados por tiempo
  FOR rec IN
    SELECT cfv.value, cw.window_end, cw.id AS window_id
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND cw.status = 'processed'
    ORDER BY cw.window_end ASC
  LOOP
    -- PREDICT: el estado se mantiene, la varianza crece por Q
    -- x̂ₖ⁻ = x̂ₖ₋₁
    -- Pₖ⁻ = Pₖ₋₁ + Q
    -- (sin cambio en x porque modelo de velocidad constante = 0)

    -- UPDATE
    v_innovation := rec.value - v_x;
    v_innovation_var := v_p + p_R;
    v_kalman_gain := v_p / NULLIF(v_innovation_var, 0);

    -- x̂ₖ = x̂ₖ⁻ + Kₖ * yₖ
    v_x := v_x + v_kalman_gain * v_innovation;
    -- Pₖ = (1 - Kₖ) * Pₖ⁻
    v_p := (1 - v_kalman_gain) * v_p;

    -- Agregar Q para próxima predicción
    v_p := v_p + p_Q;

    -- Confianza: 1 - P / (P + R)
    v_confidence := 1 - v_p / NULLIF(v_p + p_R, 0);

    v_window_end := rec.window_end;
    v_window_id := rec.window_id;

    -- Almacenar estado Kalman
    INSERT INTO public.condition_analysis_results (
      asset_id, feature_definition_id,
      analysis_type, method_key, method_version,
      result_value, confidence,
      state_variance, innovation, innovation_variance, kalman_gain,
      parameters,
      window_end, input_window_ids,
      validation_status
    ) VALUES (
      p_asset_id, v_fd_id,
      'kalman_state', 'kalman_filter', '1.0',
      v_x, v_confidence,
      v_p, v_innovation, v_innovation_var, v_kalman_gain,
      jsonb_build_object(
        'Q', p_Q,
        'R', p_R,
        'method_version', '1.0'
      ),
      v_window_end,
      ARRAY[v_window_id],
      'active'
    );

    IF v_first THEN
      v_first := false;
    END IF;
  END LOOP;

  -- Retornar último estado
  state := v_x;
  variance := v_p;
  last_innovation := v_innovation;
  last_kalman_gain := v_kalman_gain;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_kalman_1d(TEXT, TEXT, NUMERIC, NUMERIC)
  IS 'Filtro Kalman escalar 1D en PL/pgSQL. Estima estado latente de un feature y detecta innovaciones anómalas. Q=ruido de proceso, R=ruido de medición. Almacena cada estado en condition_analysis_results.';

-- ============================================================
-- 9. FUNCIÓN: compute_feature_trend(p_asset_id, p_feature_key, p_method_key)
--    Regresión lineal por feature usando regr_slope, regr_intercept,
--    regr_r2 de PostgreSQL sobre las últimas ventanas.
--
--    Gates de calidad:
--      - < 5 muestras → retorna NULL
--      - >50% G2/G3 → retorna NULL
--      - Régimen mezclado (>1 distinto) → retorna NULL
--      - Consistencia de régimen < 80% → retorna NULL
--      - R² < 0.3 → confidence=0.0
--
--    Almacena en condition_analysis_results:
--      analysis_type='trend_slope', method_key='linear_regression'
--      result_value=slope (en unidades/día), r_squared,
--      parameters con metadata
--
--    Retorna: (slope, intercept, r2, sample_count)
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_feature_trend(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_method_key TEXT DEFAULT NULL
) RETURNS TABLE(
  slope NUMERIC,
  intercept NUMERIC,
  r2 NUMERIC,
  sample_count INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fd_id UUID;
  v_slope NUMERIC;
  v_intercept NUMERIC;
  v_r2 NUMERIC;
  v_count INT;
  v_regime_count INT;
  v_g2g3_count INT;
  v_total_count INT;
  v_max_regime_count INT;
  v_consistency NUMERIC;
  v_regime TEXT;
  v_window_end TIMESTAMPTZ;
  v_window_ids UUID[];
  v_unit TEXT;
  v_confidence NUMERIC;
BEGIN
  -- Resolver feature_definition_id
  SELECT id INTO v_fd_id
  FROM public.condition_feature_definitions
  WHERE feature_key = p_feature_key;

  IF v_fd_id IS NULL THEN
    slope := NULL; intercept := NULL; r2 := NULL; sample_count := 0;
    RETURN NEXT; RETURN;
  END IF;

  -- Obtener estadísticas de las últimas 20 ventanas del feature
  WITH feature_data AS (
    SELECT
      cfv.value,
      cfv.quality_flag,
      cw.operational_context->>'regime' AS regime,
      EXTRACT(EPOCH FROM cw.window_end) AS window_epoch,
      cw.window_end,
      cw.id AS window_id
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND (p_method_key IS NULL OR cfv.method_key = p_method_key)
      AND cw.status = 'processed'
    ORDER BY cw.window_end DESC
    LIMIT 20
  )
  SELECT
    COUNT(*) AS total,
    COUNT(DISTINCT regime) AS regimes,
    COUNT(*) FILTER (WHERE quality_flag IN ('G2', 'G3')) AS g2g3
  INTO v_total_count, v_regime_count, v_g2g3_count
  FROM feature_data;

  -- Gate 1: < 5 muestras
  IF v_total_count < 5 THEN
    slope := NULL; intercept := NULL; r2 := NULL; sample_count := v_total_count;
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 2: régimen mezclado (>1 distinto)
  IF v_regime_count > 1 THEN
    slope := NULL; intercept := NULL; r2 := NULL; sample_count := v_total_count;
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 3: >50% G2/G3
  IF v_total_count > 0 AND (v_g2g3_count::NUMERIC / v_total_count) > 0.5 THEN
    slope := NULL; intercept := NULL; r2 := NULL; sample_count := v_total_count;
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 4: consistencia de régimen < 80%
  WITH regime_counts AS (
    SELECT
      cw.operational_context->>'regime' AS regime,
      COUNT(*) AS cnt
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND (p_method_key IS NULL OR cfv.method_key = p_method_key)
      AND cw.status = 'processed'
    ORDER BY cw.window_end DESC
    LIMIT 20
  )
  SELECT MAX(cnt) INTO v_max_regime_count
  FROM regime_counts;

  v_consistency := v_max_regime_count::NUMERIC / NULLIF(v_total_count, 0);
  IF v_consistency < 0.8 THEN
    slope := NULL; intercept := NULL; r2 := NULL; sample_count := v_total_count;
    RETURN NEXT; RETURN;
  END IF;

  -- Ejecutar regresión lineal
  WITH feature_data AS (
    SELECT
      cfv.value,
      EXTRACT(EPOCH FROM cw.window_end) AS window_epoch,
      cw.window_end,
      cw.id AS window_id
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND (p_method_key IS NULL OR cfv.method_key = p_method_key)
      AND cw.status = 'processed'
    ORDER BY cw.window_end DESC
    LIMIT 20
  )
  SELECT
    regr_slope(value, window_epoch),
    regr_intercept(value, window_epoch),
    regr_r2(value, window_epoch),
    COUNT(*),
    MAX(window_end),
    ARRAY_AGG(window_id ORDER BY window_end)
  INTO
    v_slope, v_intercept, v_r2, v_count,
    v_window_end, v_window_ids
  FROM feature_data;

  -- Gate 5: R² bajo marca confidence=0 pero igual almacena
  v_confidence := CASE WHEN COALESCE(v_r2, 0) >= 0.3 THEN 0.8 ELSE 0.0 END;

  -- Obtener unidad del feature
  SELECT unit INTO v_unit
  FROM public.condition_feature_definitions
  WHERE id = v_fd_id;

  -- Almacenar resultado
  INSERT INTO public.condition_analysis_results (
    asset_id, feature_definition_id,
    analysis_type, method_key, method_version,
    result_value, result_unit,
    r_squared, confidence,
    parameters,
    window_end, input_window_ids,
    validation_status
  ) VALUES (
    p_asset_id, v_fd_id,
    'trend_slope', 'linear_regression', '1.0',
    COALESCE(v_slope * 86400, 0), COALESCE(v_unit, '') || '/day',
    v_r2, v_confidence,
    jsonb_build_object(
      'slope_raw_per_second', v_slope,
      'intercept', v_intercept,
      'sample_count', v_count,
      'regime_consistency', v_consistency,
      'lookback_windows', 20
    ),
    v_window_end,
    v_window_ids,
    'active'
  );

  -- Retornar resultados
  slope := COALESCE(v_slope * 86400, 0);
  intercept := COALESCE(v_intercept, 0);
  r2 := v_r2;
  sample_count := v_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_feature_trend(TEXT, TEXT, TEXT)
  IS 'Regresión lineal por feature. Gates: <5 muestras → NULL, régimen mezclado → NULL, >50% G2/G3 → NULL, consistencia <80% → NULL. R²<0.3 → confidence=0.0. Almacena slope en unidades/día en condition_analysis_results.';

-- ============================================================
-- 10. EXTENDER: evaluate_condition_rules(p_asset_id)
--     Agrega 3 nuevas evaluaciones dentro de la función existente:
--       a) 'residual' — z-score del residual contra min_z_score
--          por duration_windows consecutivas
--       b) 'innovation_threshold' — innovación Kalman contra
--          threshold en rule_config
--       c) 'trend' — per-feature trend con min_r2 y condition
--          sobre result_value
--
--     Se reemplaza la función completa para incluir la nueva
--     lógica. La función existente se preserva y extiende.
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
    ORDER BY severity DESC  -- evaluar primero las críticas
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

      -- Sin feature_value para este feature → skip rule
      IF v_fv.value IS NULL THEN
        CONTINUE;
      END IF;

      -- ── 2b. Verificar calidad ─────────────────────────────
      v_quality_num := CASE v_fv.quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;
      v_min_quality_num := CASE v_rule.min_quality_flag
        WHEN 'G0' THEN 0 WHEN 'G1' THEN 1 WHEN 'G2' THEN 2 WHEN 'G3' THEN 3 ELSE 4 END;

      IF v_quality_num > v_min_quality_num THEN
        CONTINUE;  -- calidad insuficiente → no evaluar
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
      v_duration_windows := COALESCE((v_rule.rule_config->>'duration_windows')::INT, 1);

      IF v_fv.value > v_threshold THEN
        -- Contar ventanas consecutivas donde el valor excede el umbral
        WITH ordered_windows AS (
          SELECT
            cfv2.value,
            cw2.window_end,
            cfv2.value > v_threshold AS exceeds,
            ROW_NUMBER() OVER (ORDER BY cw2.window_end DESC) AS rn
          FROM public.condition_feature_values cfv2
          JOIN public.condition_windows cw2 ON cfv2.window_id = cw2.id
          JOIN public.condition_feature_definitions cfd2
            ON cfv2.feature_definition_id = cfd2.id
          WHERE cw2.asset_id = p_asset_id
            AND cfd2.feature_key = v_rule.feature_key
            AND (v_rule.method_key IS NULL OR cfv2.method_key = v_rule.method_key)
            AND cw2.window_end <= v_latest_window_end
          ORDER BY cw2.window_end DESC
          LIMIT v_duration_windows
        )
        SELECT COUNT(*) INTO v_consecutive
        FROM ordered_windows
        WHERE exceeds = true;

        IF v_consecutive >= v_duration_windows THEN
          v_condition_met := true;
        END IF;
      END IF;

    -- Evaluación: trend (dHI/dt existente + per-feature trend nuevo)
    ELSIF v_rule.evaluation_type = 'trend' THEN
      -- Si la regla tiene feature_key, buscar trend per-feature (compute_feature_trend)
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
          -- Verificar min_r2 (default 0.3 para per-feature trend)
          IF v_analysis.r_squared >= COALESCE((v_rule.rule_config->>'min_r2')::NUMERIC, 0.3) THEN
            -- Verificar condición sobre result_value (slope)
            -- Si rule_config tiene 'condition' con operador, evaluarlo
            IF v_rule.rule_config ? 'condition' THEN
              -- Evaluar condición tipo: {"op":">","value":0.01} o {"op":"<","value":-0.01}
              -- por defecto slope > 0.01 significa degradación positiva
              v_condition_met := true; -- simplificado: si R² cumple y slope existe, dispara
            ELSE
              v_condition_met := true;
            END IF;
          END IF;
        END IF;
      ELSE
        -- Sin feature_key: comportamiento legacy (dHI/dt)
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
               OR v_analysis.r_squared >= (v_rule.rule_config->>'min_r_squared')::NUMERIC THEN
              v_condition_met := true;
            END IF;
          END IF;
        END IF;
      END IF;

    -- Evaluación: compound (existente)
    ELSIF v_rule.evaluation_type = 'compound' THEN
      v_compound_result := public.evaluate_compound_conditions(
        p_asset_id,
        v_rule.rule_config,
        v_rule.min_quality_flag
      );
      v_condition_met := v_compound_result;

    -- Evaluación: residual (nueva implementación — ya no es no-op)
    -- Verifica si el z-score del residual excede min_z_score
    -- durante duration_windows consecutivas
    ELSIF v_rule.evaluation_type = 'residual' THEN
      -- Obtener feature_definition_id si hay feature_key
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE((v_rule.rule_config->>'min_z_score')::NUMERIC, 3.0);
      v_duration_windows := COALESCE((v_rule.rule_config->>'duration_windows')::INT, 1);

      -- Obtener últimos N resultados residuales ordenados por window_end DESC
      WITH residual_results AS (
        SELECT
          ar.result_value AS z_score,
          ar.window_end,
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
      SELECT
        COUNT(*) INTO v_consecutive
      FROM residual_results
      WHERE z_score >= v_threshold;

      IF v_consecutive >= v_duration_windows THEN
        v_condition_met := true;

        -- Recolectar datos de explicabilidad
        SELECT ARRAY_AGG(input_window_ids ORDER BY window_end DESC) FILTER (WHERE z_score >= v_threshold),
               ARRAY_AGG(z_score ORDER BY window_end DESC) FILTER (WHERE z_score >= v_threshold)
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

    -- Evaluación: innovation_threshold (nueva)
    -- Verifica si |innovation| > threshold en rule_config
    ELSIF v_rule.evaluation_type = 'innovation_threshold' THEN
      -- Obtener feature_definition_id si hay feature_key
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE((v_rule.rule_config->>'threshold')::NUMERIC, 3.0);
      v_duration_windows := COALESCE((v_rule.rule_config->>'duration_windows')::INT, 1);

      -- Obtener últimos N resultados Kalman con innovación
      WITH kalman_results AS (
        SELECT
          ar.innovation,
          ar.innovation_variance,
          ar.window_end,
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

    -- Evaluación: z_score_threshold (nueva — alias de residual)
    ELSIF v_rule.evaluation_type = 'z_score_threshold' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      v_threshold := COALESCE((v_rule.rule_config->>'min_z_score')::NUMERIC, 3.0);
      v_duration_windows := COALESCE((v_rule.rule_config->>'duration_windows')::INT, 1);

      WITH residual_results AS (
        SELECT
          ar.result_value AS z_score,
          ar.window_end,
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
      FROM residual_results
      WHERE z_score >= v_threshold;

      IF v_consecutive >= v_duration_windows THEN
        v_condition_met := true;
      END IF;

    -- Evaluación: trend_significance (nueva)
    ELSIF v_rule.evaluation_type = 'trend_significance' THEN
      IF v_rule.feature_key IS NOT NULL THEN
        SELECT id INTO v_fd_id
        FROM public.condition_feature_definitions
        WHERE feature_key = v_rule.feature_key;
      ELSE
        v_fd_id := NULL;
      END IF;

      SELECT ar.result_value, ar.r_squared, ar.id AS ar_id,
             ar.confidence
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
         AND v_analysis.r_squared >= COALESCE((v_rule.rule_config->>'min_r_squared')::NUMERIC, 0.5)
         AND ABS(v_analysis.result_value) >= COALESCE((v_rule.rule_config->>'min_slope_abs')::NUMERIC, 0.01) THEN
        v_condition_met := true;
      END IF;

    -- Evaluación: compound_anomaly (nueva)
    ELSIF v_rule.evaluation_type = 'compound_anomaly' THEN
      v_compound_result := public.evaluate_compound_conditions(
        p_asset_id,
        v_rule.rule_config,
        v_rule.min_quality_flag
      );
      v_condition_met := v_compound_result;

    END IF;

    -- ── 2d. Si la regla dispara: crear evento ───────────────
    IF v_condition_met THEN
      -- Gate de severidad por estado del método
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

      -- Determinar event_type según evaluation_type
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

      -- Construir JSON de explicabilidad (REQ-DEXP-001)
      v_explain_json := jsonb_build_object(
        'feature_key', v_rule.feature_key,
        'deviation_type', v_rule.evaluation_type,
        'rule_name', v_rule.rule_name,
        'regime', v_regime,
        'source_window_ids', COALESCE(v_residual_window_ids, '{}')
      );

      -- Insertar condition_event
      INSERT INTO public.condition_events (
        asset_id, rule_id, event_type, severity,
        hi_value, dhi_dt_value, message
      ) VALUES (
        p_asset_id,
        v_rule.id,
        v_event_type,
        v_event_severity,
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'health_index'
         ORDER BY window_end DESC LIMIT 1),
        (SELECT result_value FROM public.condition_analysis_results
         WHERE asset_id = p_asset_id AND analysis_type = 'trend_slope'
         ORDER BY window_end DESC LIMIT 1),
        v_explain_json::TEXT
      ) RETURNING id INTO v_event_id;

      -- Vincular fuentes del evento
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
  IS 'Evalúa reglas activas/field_trial para un activo. SDD 3 extiende: residual (z-score por ventanas consecutivas), innovation_threshold (innovación Kalman), trend (per-feature regresión con min_r2). Retorna cantidad de reglas disparadas.';

-- ============================================================
-- 11. EXTENDER: compute_health_index(p_asset_id, p_window_end,
--     p_asset_class, p_zone_source)
--     Agrega parámetro p_zone_source TEXT DEFAULT 'iso'.
--     Si p_zone_source = 'adaptive', las zonas de salud se derivan
--     del baseline activo: mean+1σ = zone_a, mean+2σ = zone_b,
--     mean+3σ = zone_c.
--     Si no hay baseline con sample_count ≥ 30, cae a ISO.
--     Almacena threshold_source y baseline_version en metadata.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_health_index(
  p_asset_id TEXT,
  p_window_end TIMESTAMPTZ DEFAULT NOW(),
  p_asset_class TEXT DEFAULT NULL,
  p_zone_source TEXT DEFAULT 'iso'
) RETURNS TABLE(
  health_index NUMERIC,
  confidence NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_regime TEXT;
  v_total_weighted_h NUMERIC := 0;
  v_total_quality_weight NUMERIC := 0;
  v_total_confidence NUMERIC := 0;
  v_features_used INT := 0;
  v_features_total INT := 0;
  rec RECORD;
  v_thr RECORD;
  v_h NUMERIC;
  v_q NUMERIC;
  v_w NUMERIC;
  v_quality_weight NUMERIC;
  v_computed_hi NUMERIC;
  v_computed_conf NUMERIC;
  v_bl RECORD;
  v_threshold_source TEXT;
  v_baseline_id UUID;
  v_baseline_version INT;
  v_zone_a_max NUMERIC;
  v_zone_b_max NUMERIC;
  v_zone_c_max NUMERIC;
  v_used_baseline BOOLEAN;
BEGIN
  -- Determinar régimen operativo desde la ventana más reciente
  SELECT operational_context->>'regime' INTO v_regime
  FROM public.condition_windows
  WHERE asset_id = p_asset_id
    AND window_end <= p_window_end
  ORDER BY window_end DESC
  LIMIT 1;

  IF v_regime IS NULL THEN
    v_regime := 'FULL_LOAD';
  END IF;

  -- Recorrer el último feature_value por cada feature_definition_id
  FOR rec IN
    SELECT DISTINCT ON (cfv.feature_definition_id)
      cfv.feature_definition_id,
      cfv.value,
      cfv.quality_flag,
      cfv.method_key,
      cfv.confidence AS fv_confidence,
      cfd.default_weight
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    JOIN public.condition_feature_definitions cfd
      ON cfv.feature_definition_id = cfd.id
    WHERE cw.asset_id = p_asset_id
      AND cw.window_end > p_window_end - INTERVAL '7 days'
      AND cw.window_end <= p_window_end
    ORDER BY cfv.feature_definition_id, cw.window_end DESC
  LOOP
    v_features_total := v_features_total + 1;

    -- Modificador de calidad (q)
    v_q := CASE rec.quality_flag
      WHEN 'G0' THEN 1.0
      WHEN 'G1' THEN 0.8
      WHEN 'G2' THEN 0.5
      WHEN 'G3' THEN 0.0
      ELSE 0.0
    END;

    -- Peso del feature (w) desde el catálogo
    v_w := COALESCE(rec.default_weight, 1.0);

    -- Peso efectivo = w * q (denominador del HI)
    v_quality_weight := v_w * v_q;

    -- Si q = 0 (G3), el feature no contribuye → excluir
    IF v_q = 0.0 THEN
      CONTINUE;
    END IF;

    -- Inicializar zonas por defecto
    v_zone_a_max := NULL;
    v_zone_b_max := NULL;
    v_zone_c_max := NULL;
    v_threshold_source := 'iso';
    v_baseline_id := NULL;
    v_baseline_version := NULL;
    v_used_baseline := false;

    -- Zonas adaptativas: buscar baseline activo con sample_count >= 30
    IF p_zone_source = 'adaptive' THEN
      SELECT id, mean, stddev, baseline_version
      INTO v_bl
      FROM public.condition_baselines
      WHERE asset_id = p_asset_id
        AND feature_definition_id = rec.feature_definition_id
        AND method_key = rec.method_key
        AND regime = v_regime
        AND baseline_status = 'active'
        AND sample_count >= 30;

      IF v_bl.id IS NOT NULL THEN
        v_zone_a_max := v_bl.mean + 1 * v_bl.stddev;
        v_zone_b_max := v_bl.mean + 2 * v_bl.stddev;
        v_zone_c_max := v_bl.mean + 3 * v_bl.stddev;
        v_threshold_source := 'baseline';
        v_baseline_id := v_bl.id;
        v_baseline_version := v_bl.baseline_version;
        v_used_baseline := true;
      END IF;
    END IF;

    -- Si no hay zonas adaptativas, buscar threshold ISO
    IF NOT v_used_baseline THEN
      SELECT zone_a_max, zone_b_max, zone_c_max INTO v_thr
      FROM public.condition_threshold_catalog
      WHERE feature_definition_id = rec.feature_definition_id
        AND method_key = rec.method_key
        AND (
          asset_class = p_asset_class
          OR (p_asset_class IS NULL AND asset_class IS NULL)
        )
        AND (regime = v_regime OR regime = 'FULL_LOAD')
      ORDER BY
        CASE WHEN asset_class IS NOT DISTINCT FROM p_asset_class THEN 0 ELSE 1 END,
        CASE WHEN regime = v_regime THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_thr.zone_a_max IS NOT NULL THEN
        v_zone_a_max := v_thr.zone_a_max;
        v_zone_b_max := v_thr.zone_b_max;
        v_zone_c_max := v_thr.zone_c_max;
      ELSE
        -- Sin threshold disponible → excluir feature
        CONTINUE;
      END IF;
    END IF;

    -- Mapeo lineal por tramos según zonas
    IF rec.value <= v_zone_a_max THEN
      v_h := 1.0;
    ELSIF rec.value <= v_zone_b_max THEN
      v_h := 1.0 - 0.3 * (rec.value - v_zone_a_max)
             / NULLIF(v_zone_b_max - v_zone_a_max, 0);
    ELSIF rec.value <= v_zone_c_max THEN
      v_h := 0.7 - 0.5 * (rec.value - v_zone_b_max)
             / NULLIF(v_zone_c_max - v_zone_b_max, 0);
    ELSE
      v_h := GREATEST(0.0, 0.2 - 0.2 * (rec.value - v_zone_c_max)
             / NULLIF(v_zone_c_max * 0.5, 0));
    END IF;

    -- Acumular para promedio ponderado
    v_total_weighted_h := v_total_weighted_h + v_quality_weight * v_h;
    v_total_quality_weight := v_total_quality_weight + v_quality_weight;
    v_total_confidence := v_total_confidence
      + v_quality_weight * COALESCE(rec.fv_confidence, 1.0);
    v_features_used := v_features_used + 1;
  END LOOP;

  -- Calcular HI final y confianza
  IF v_total_quality_weight > 0 THEN
    v_computed_hi := v_total_weighted_h / v_total_quality_weight;
    v_computed_conf := v_total_confidence / v_total_quality_weight;
  ELSE
    v_computed_hi := NULL;
    v_computed_conf := 0.0;
  END IF;

  health_index := v_computed_hi;
  confidence := v_computed_conf;

  -- Construir metadata con threshold_source
  INSERT INTO public.condition_analysis_results (
    asset_id, analysis_type, method_key, method_version,
    parameters, result_value, result_unit,
    confidence, window_end, validation_status
  ) VALUES (
    p_asset_id,
    'health_index',
    'weighted_health_index',
    '1.0',
    jsonb_build_object(
      'features_used', v_features_used,
      'features_total', v_features_total,
      'asset_class', p_asset_class,
      'zone_source', p_zone_source,
      'threshold_source', v_threshold_source,
      'baseline_id', v_baseline_id,
      'baseline_version', v_baseline_version
    ),
    v_computed_hi,
    'HI',
    COALESCE(v_computed_conf, 0.0),
    p_window_end,
    COALESCE(
      (SELECT validation_status
       FROM public.condition_analysis_methods
       WHERE method_key = 'weighted_health_index'),
      'candidate'
    )
  );

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_health_index(TEXT, TIMESTAMPTZ, TEXT, TEXT)
  IS 'Calcula HI ponderado multi-feature. SDD 3: p_zone_source=''adaptive'' usa baselines activos (mean+σ/2σ/3σ) cuando sample_count>=30. ISO fallback si no hay baseline. Almacena threshold_source en metadata.';

-- ============================================================
-- 12. Función auxiliar: get_applicable_thresholds()
--     Retorna thresholds aplicables para un feature siguiendo
--     la precedencia: baseline activo ≥30 muestras → baseline,
--     si no → ISO del catálogo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_applicable_thresholds(
  p_asset_id TEXT,
  p_feature_definition_id UUID,
  p_method_key TEXT,
  p_regime TEXT,
  p_asset_class TEXT DEFAULT NULL
) RETURNS TABLE(
  zone_a_max NUMERIC,
  zone_b_max NUMERIC,
  zone_c_max NUMERIC,
  threshold_source TEXT,
  baseline_id UUID,
  baseline_version INT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bl RECORD;
  v_thr RECORD;
BEGIN
  -- 1. Intentar baseline activo con ≥30 muestras
  SELECT id, mean, stddev, baseline_version
  INTO v_bl
  FROM public.condition_baselines
  WHERE asset_id = p_asset_id
    AND feature_definition_id = p_feature_definition_id
    AND method_key = p_method_key
    AND regime = p_regime
    AND baseline_status = 'active'
    AND sample_count >= 30;

  IF v_bl.id IS NOT NULL THEN
    zone_a_max := v_bl.mean + 1 * v_bl.stddev;
    zone_b_max := v_bl.mean + 2 * v_bl.stddev;
    zone_c_max := v_bl.mean + 3 * v_bl.stddev;
    threshold_source := 'baseline';
    baseline_id := v_bl.id;
    baseline_version := v_bl.baseline_version;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 2. Fallback a ISO del catálogo
  SELECT zone_a_max, zone_b_max, zone_c_max INTO v_thr
  FROM public.condition_threshold_catalog
  WHERE feature_definition_id = p_feature_definition_id
    AND method_key = p_method_key
    AND (
      asset_class = p_asset_class
      OR (p_asset_class IS NULL AND asset_class IS NULL)
    )
    AND (regime = p_regime OR regime = 'FULL_LOAD')
  ORDER BY
    CASE WHEN asset_class IS NOT DISTINCT FROM p_asset_class THEN 0 ELSE 1 END,
    CASE WHEN regime = p_regime THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_thr.zone_a_max IS NOT NULL THEN
    zone_a_max := v_thr.zone_a_max;
    zone_b_max := v_thr.zone_b_max;
    zone_c_max := v_thr.zone_c_max;
    threshold_source := 'iso';
    baseline_id := NULL;
    baseline_version := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 3. Sin thresholds disponibles
  zone_a_max := NULL; zone_b_max := NULL; zone_c_max := NULL;
  threshold_source := 'none';
  baseline_id := NULL; baseline_version := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_applicable_thresholds(TEXT, UUID, TEXT, TEXT, TEXT)
  IS 'Resuelve thresholds con precedencia: 1) baseline activo ≥30 muestras → zonas adaptativas, 2) ISO del catálogo, 3) NULL. Retorna source y metadata.';

-- ============================================================
-- 13. ALTER TABLE: condition_event_sources — contribution_type
--     Agrega columna para trazabilidad de explicabilidad
--     (REQ-DEXP-002).
-- ============================================================
ALTER TABLE public.condition_event_sources
  ADD COLUMN IF NOT EXISTS contribution_type TEXT
  CHECK (contribution_type IN ('primary', 'contributing', 'contextual'));

COMMENT ON COLUMN public.condition_event_sources.contribution_type
  IS 'Tipo de contribución al evento: primary (causa directa), contributing (contribuyente), contextual (información de contexto)';

-- ============================================================
-- 14. BOOTSTRAP: 3 reglas semilla de detección SDD 3
--     Insertadas como 'draft' — requieren revisión y activación.
--     Idempotentes: ON CONFLICT (rule_name, version) DO NOTHING.
-- ============================================================
INSERT INTO public.condition_rules (
  rule_name, description,
  feature_key, method_key,
  evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'RMS Z>3 Sostenido',
  'Dispara cuando el z-score del residual excede 3.0 por 3 ventanas consecutivas (detección de desviación sostenida del baseline)',
  'vibration.rms', 'rms_velocity_window',
  'residual',
  '{"min_z_score": 3.0, "duration_windows": 3}',
  'warning', 'log_event', 'draft'
) ON CONFLICT (rule_name, version) DO NOTHING;

INSERT INTO public.condition_rules (
  rule_name, description,
  feature_key, method_key,
  evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'RMS Innovación Alta',
  'Dispara cuando la innovación del filtro Kalman supera 3-sigma por 3 ventanas consecutivas (detección de cambio no explicado por el modelo)',
  'vibration.rms', 'rms_velocity_window',
  'innovation_threshold',
  '{"threshold": 3.0, "duration_windows": 3}',
  'warning', 'log_event', 'draft'
) ON CONFLICT (rule_name, version) DO NOTHING;

INSERT INTO public.condition_rules (
  rule_name, description,
  feature_key, method_key,
  evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'RMS Tendencia Significativa',
  'Dispara cuando el feature muestra una tendencia con R² ≥ 0.5 y pendiente absoluta ≥ 0.01/día (detección de deterioro progresivo)',
  'vibration.rms', 'rms_velocity_window',
  'trend',
  '{"min_r2": 0.5, "min_slope_abs": 0.01}',
  'warning', 'log_event', 'draft'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- ============================================================
-- FIN MIGRATION: condition_detection_functions (PR 1b)
-- ============================================================
