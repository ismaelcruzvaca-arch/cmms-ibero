-- ============================================================
-- MIGRATION: sdd6_improvement_functions — Improvement Proposal
--   Engine Functions (SDD 6, PR 5)
-- Change: condition-monitoring-performance-improvement (PR 5)
-- ============================================================
-- Implementa funciones del motor de mejora continua:
--
--   1. generate_improvement_proposals()
--      — Escanea 5 fuentes de oportunidad, crea propuestas
--        en draft, deduplica, retorna conteo de nuevas propuestas
--   2. assess_improvement_opportunities(p_asset_id)
--      — Modo preview: mismos 5 escaneos pero retorna TABLE
--        sin insertar (STABLE, read-only)
--
-- Ambos escanean:
--   (1) Reglas ruidosas (condition_noisy_rules)
--   (2) Bajo rendimiento (condition_performance_by_fm/by_rule)
--   (3) Sesgo de calibración RUL (condition_prediction_calibration)
--   (4) Baja calidad de datos (condition_feature_values G3)
--   (5) DRL aumentado + modelo disponible (condition_data_readiness
--       + condition_degradation_models)
--
-- Key constraint: NUNCA auto-implementa. Todas las propuestas se
--   crean en status 'draft'. Ninguna función avanza más allá.
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN: generate_improvement_proposals()
--    Escanea 5 fuentes de oportunidad de mejora y crea
--    propuestas en estado 'draft' para revisión humana.
--
--    Fuentes:
--      1. Reglas ruidosas — false_positive_rate > 0.50
--      2. Bajo rendimiento — confirmed_rate < 0.30
--         en condition_performance_by_fm o by_rule
--      3. Sesgo de RUL — ABS(bias) > 20 horas en
--         condition_prediction_calibration
--      4. Baja calidad de datos — source con >50% de
--         feature_values en G3 en los últimos 7 días
--      5. DRL aumentado + modelo disponible — asset con
--         drl_level >= min_data_readiness_level de un modelo
--         no activo y no propuesto
--
--    Deduplicación: verifica source_analysis + status IN
--      ('draft','review','approved') antes de crear.
--      Si ya existe una propuesta activa (no terminal) para
--      el mismo source_analysis, la salta.
--
--    Retorna: cantidad de nuevas propuestas insertadas.
--    SECURITY DEFINER — se ejecuta con permisos del owner.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_improvement_proposals()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_batch_count INT;
BEGIN
  -- ============================================================
  -- FUENTE 1: Reglas ruidosas (condition_noisy_rules)
  --   Criterio: false_positive_rate > 0.50
  --   Propuesta: "Revisar regla {rule_name}: tasa de FP {fp_rate}
  --     supera el 50%"
  --   Tipo: rule_review
  -- ============================================================
  WITH candidatas AS (
    SELECT
      nr.rule_id,
      nr.rule_name,
      nr.evaluation_type,
      nr.total_diagnoses,
      nr.confirmed_count,
      nr.rejected_count,
      nr.false_positive_rate,
      nr.confirmed_rate
    FROM public.condition_noisy_rules nr
    WHERE nr.false_positive_rate > 0.50
      AND nr.total_diagnoses > 0
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_noisy_' || c.rule_id,
      'Revisar regla ' || c.rule_name || ': tasa de FP ' ||
        ROUND((c.false_positive_rate * 100)::NUMERIC, 1) || '% supera el 50%',
      'La regla ' || c.rule_name || ' (tipo: ' || COALESCE(c.evaluation_type, 'N/A') ||
        ') tiene una tasa de falsos positivos de ' ||
        ROUND((c.false_positive_rate * 100)::NUMERIC, 1) || '% con ' ||
        c.total_diagnoses || ' diagnósticos totales (' || c.confirmed_count ||
        ' confirmados, ' || c.rejected_count || ' rechazados). ' ||
        'Se requiere revisión humana para ajustar umbrales o modificar la lógica.',
      'rule_review',
      'noisy_rule:' || c.rule_name,
      jsonb_build_object(
        'rule_id', c.rule_id,
        'rule_name', c.rule_name,
        'evaluation_type', c.evaluation_type,
        'total_diagnoses', c.total_diagnoses,
        'confirmed_count', c.confirmed_count,
        'rejected_count', c.rejected_count,
        'false_positive_rate', c.false_positive_rate,
        'confirmed_rate', c.confirmed_rate,
        'detected_at', NOW()
      ),
      'Reducir falsos positivos ajustando umbrales o revisando lógica de la regla. ' ||
        'Esto disminuye carga de trabajo por falsas alarmas y mejora confianza del sistema.',
      'Falsos positivos persistentes reducen credibilidad del sistema y generan ' ||
        'desgaste en el equipo de mantenimiento.',
      'draft'
    FROM candidatas c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'noisy_rule:' || c.rule_name
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- FUENTE 2: Bajo rendimiento (condition_performance_by_fm)
  --   Criterio: confirmed_rate < 0.30 AND total_diagnoses >= 3
  --   Propuesta: "Bajo rendimiento en {failure_mode_key}: tasa de
  --     confirmación {confirmed_rate}%"
  --   Tipo: rule_review (ajuste de reglas asociadas al FM)
  -- ============================================================
  WITH candidatas AS (
    SELECT
      pbf.failure_mode_key,
      pbf.failure_mode_name,
      pbf.asset_class,
      pbf.total_diagnoses,
      pbf.confirmed_count,
      pbf.rejected_count,
      pbf.confirmed_rate
    FROM public.condition_performance_by_fm pbf
    WHERE pbf.confirmed_rate < 0.30
      AND pbf.total_diagnoses >= 3
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_lowperf_fm_' || c.failure_mode_key,
      'Bajo rendimiento en ' || c.failure_mode_key || ': tasa de confirmación ' ||
        ROUND((c.confirmed_rate * 100)::NUMERIC, 1) || '%',
      'El modo de falla ' || c.failure_mode_key || ' (' || COALESCE(c.failure_mode_name, '') ||
        ', clase: ' || COALESCE(c.asset_class, 'N/A') || ') tiene una tasa de confirmación de ' ||
        ROUND((c.confirmed_rate * 100)::NUMERIC, 1) || '% con ' || c.total_diagnoses ||
        ' diagnósticos (' || c.confirmed_count || ' confirmados, ' ||
        c.rejected_count || ' rechazados). Esto indica bajo rendimiento diagnóstico.',
      'rule_review',
      'low_perf_fm:' || c.failure_mode_key,
      jsonb_build_object(
        'failure_mode_key', c.failure_mode_key,
        'failure_mode_name', c.failure_mode_name,
        'asset_class', c.asset_class,
        'total_diagnoses', c.total_diagnoses,
        'confirmed_count', c.confirmed_count,
        'rejected_count', c.rejected_count,
        'confirmed_rate', c.confirmed_rate,
        'detected_at', NOW()
      ),
      'Revisar reglas y thresholds asociados a ' || c.failure_mode_key ||
        ' para mejorar precisión diagnóstica.',
      'Baja tasa de confirmación indica posibles falsos positivos sistemáticos ' ||
        'que reducen la efectividad del monitoreo.',
      'draft'
    FROM candidatas c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'low_perf_fm:' || c.failure_mode_key
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- FUENTE 2b: Bajo rendimiento (condition_performance_by_rule)
  --   Criterio: confirmed_rate < 0.30 (usando false_positive_rate
  --     como proxy inverso) AND diagnoses_count >= 3
  --   Propuesta: "Bajo rendimiento en regla {rule_name}: tasa de
  --     confirmación baja"
  --   Tipo: rule_review
  -- ============================================================
  WITH candidatas AS (
    SELECT
      pbr.rule_id,
      pbr.rule_name,
      pbr.evaluation_type,
      pbr.diagnoses_count,
      pbr.confirmed_count,
      pbr.rejected_count,
      pbr.false_positive_rate
    FROM public.condition_performance_by_rule pbr
    WHERE (pbr.diagnoses_count - pbr.confirmed_count)::NUMERIC / NULLIF(pbr.diagnoses_count, 0) > 0.70
      AND pbr.diagnoses_count >= 3
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_lowperf_rule_' || c.rule_name,
      'Bajo rendimiento en regla ' || c.rule_name || ': tasa de FP ' ||
        ROUND((c.false_positive_rate * 100)::NUMERIC, 1) || '%',
      'La regla ' || c.rule_name || ' (tipo: ' || COALESCE(c.evaluation_type, 'N/A') ||
        ') tiene ' || c.diagnoses_count || ' diagnósticos con solo ' ||
        c.confirmed_count || ' confirmados y ' || c.rejected_count ||
        ' rechazados. La tasa de FP es de ' ||
        ROUND((c.false_positive_rate * 100)::NUMERIC, 1) || '%.',
      'rule_review',
      'low_perf_rule:' || c.rule_name,
      jsonb_build_object(
        'rule_id', c.rule_id,
        'rule_name', c.rule_name,
        'evaluation_type', c.evaluation_type,
        'diagnoses_count', c.diagnoses_count,
        'confirmed_count', c.confirmed_count,
        'rejected_count', c.rejected_count,
        'false_positive_rate', c.false_positive_rate,
        'detected_at', NOW()
      ),
      'Revisar la regla ' || c.rule_name || ' para reducir falsos positivos ' ||
        'y mejorar precisión diagnóstica.',
      'Regla con rendimiento consistentemente bajo genera ruido en el sistema.',
      'draft'
    FROM candidatas c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'low_perf_rule:' || c.rule_name
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- FUENTE 3: Sesgo de calibración RUL
  --   (condition_prediction_calibration)
  --   Criterio: ABS(bias) > 20 AND total_predictions >= 3
  --   Propuesta: "Sesgo de RUL en asset {asset_id}: bias
  --     sistemático de {bias} horas"
  --   Tipo: rul_method_change
  -- ============================================================
  WITH candidatas AS (
    SELECT
      pc.asset_id,
      pc.failure_mode_key,
      pc.total_predictions,
      pc.bias,
      pc.mape,
      pc.underestimate_rate,
      pc.overestimate_rate
    FROM public.condition_prediction_calibration pc
    WHERE ABS(COALESCE(pc.bias, 0)) > 20
      AND COALESCE(pc.total_predictions, 0) >= 3
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_rulbias_' || COALESCE(c.asset_id, 'unknown') || '_' ||
        COALESCE(c.failure_mode_key, 'all'),
      'Sesgo de RUL en asset ' || COALESCE(c.asset_id, '(global)') ||
        ': bias sistemático de ' || ROUND(COALESCE(c.bias, 0)::NUMERIC, 1) || ' horas',
      'El método RUL actual presenta un bias sistemático de ' ||
        ROUND(COALESCE(c.bias, 0)::NUMERIC, 1) || ' horas para asset ' ||
        COALESCE(c.asset_id, '(global)') || ' (FM: ' ||
        COALESCE(c.failure_mode_key, 'todos') || '), basado en ' ||
        c.total_predictions || ' predicciones. ' ||
        'MAPE: ' || ROUND(COALESCE(c.mape, 0)::NUMERIC, 4) || ', ' ||
        'subestimación: ' || ROUND(COALESCE(c.underestimate_rate, 0)::NUMERIC * 100, 1) || '%, ' ||
        'sobrestimación: ' || ROUND(COALESCE(c.overestimate_rate, 0)::NUMERIC * 100, 1) || '%.',
      'rul_method_change',
      'rul_bias:' || COALESCE(c.asset_id, 'unknown') || ':' ||
        COALESCE(c.failure_mode_key, 'all'),
      jsonb_build_object(
        'asset_id', c.asset_id,
        'failure_mode_key', c.failure_mode_key,
        'total_predictions', c.total_predictions,
        'bias_hours', c.bias,
        'mape', c.mape,
        'underestimate_rate', c.underestimate_rate,
        'overestimate_rate', c.overestimate_rate,
        'detected_at', NOW()
      ),
      'Recalibrar el método RUL o considerar un modelo alternativo para reducir ' ||
        'el sesgo y mejorar la precisión de las predicciones de vida útil.',
      'Sesgo sistemático en RUL puede llevar a decisiones de mantenimiento ' ||
        'sub-óptimas: sobrestimación causa fallas no anticipadas, subestimación ' ||
        'causa mantenimiento prematuro innecesario.',
      'draft'
    FROM candidatas c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'rul_bias:' || COALESCE(c.asset_id, 'unknown') || ':' ||
            COALESCE(c.failure_mode_key, 'all')
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- FUENTE 4: Baja calidad de datos (sources con G3 persistente)
  --   Criterio: source con >50% de feature_values en G3 en los
  --     últimos 7 días y al menos 10 valores totales
  --   Propuesta: "Fuente {source_id}: calidad G3 persistente en
  --     datos recientes"
  --   Tipo: threshold_adjustment (o baseline_recalibration)
  -- ============================================================
  WITH source_quality AS (
    SELECT
      w.source_id,
      cs.name AS source_name,
      cs.source_type,
      cs.status AS source_status,
      COUNT(*)::INT AS total_values,
      COUNT(*) FILTER (WHERE cfv.quality_flag = 'G3')::INT AS g3_count,
      ROUND(
        COUNT(*) FILTER (WHERE cfv.quality_flag = 'G3')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
      ) AS g3_pct
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows w ON cfv.window_id = w.id
    JOIN public.condition_sources cs ON cs.source_id = w.source_id
    WHERE w.window_end >= NOW() - INTERVAL '7 days'
    GROUP BY w.source_id, cs.name, cs.source_type, cs.status
    HAVING COUNT(*) >= 10
      AND COUNT(*) FILTER (WHERE cfv.quality_flag = 'G3')::NUMERIC
           / NULLIF(COUNT(*), 0) > 0.50
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_lowqual_' || sq.source_id,
      'Fuente ' || sq.source_id || ': calidad G3 persistente en datos recientes',
      'La fuente ' || sq.source_id || ' (' || COALESCE(sq.source_name, '') ||
        ', tipo: ' || COALESCE(sq.source_type, 'N/A') || ') tiene ' ||
        sq.g3_count || ' de ' || sq.total_values || ' valores recientes ' ||
        'con calidad G3 (' || sq.g3_pct || '%). ' ||
        'Estado actual de la fuente: ' || COALESCE(sq.source_status, 'N/A') || '. ' ||
        'Se requiere revisión de la fuente de datos o recalibración de sensores.',
      'baseline_recalibration',
      'low_quality:' || sq.source_id,
      jsonb_build_object(
        'source_id', sq.source_id,
        'source_name', sq.source_name,
        'source_type', sq.source_type,
        'source_status', sq.source_status,
        'total_recent_values', sq.total_values,
        'g3_count', sq.g3_count,
        'g3_percentage', sq.g3_pct,
        'analysis_window_days', 7,
        'detected_at', NOW()
      ),
      'Mejorar la calidad de datos de ' || sq.source_id ||
        ' reduce el ruido en los diagnósticos y mejora la precisión de las ' ||
        'predicciones. Considerar recalibración, mantenimiento de sensor, o ' ||
        'ajuste de thresholds para datos de baja calidad.',
      'Datos de baja calidad persistentes pueden degradar todos los diagnósticos ' ||
        'y predicciones basados en esta fuente, generando falsos positivos y ' ||
        'predicciones erróneas.',
      'draft'
    FROM source_quality sq
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'low_quality:' || sq.source_id
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- FUENTE 5: DRL aumentado + modelo disponible
  --   (condition_data_readiness + condition_degradation_models)
  --   Criterio: asset con drl_level >= model.min_data_readiness_level
  --     Y modelo NO está en status active
  --     Y no existe propuesta activa para asset+model
  --   Propuesta: "Activo {asset_id} alcanzó DRL {level}: considerar
  --     activar {model_name}"
  --   Tipo: model_switch
  -- ============================================================
  WITH candidatas AS (
    SELECT
      cdr.asset_id,
      cdr.drl_level,
      cdr.sample_count,
      cdr.g0g1_ratio,
      cdr.has_events,
      cdr.has_feedback,
      cdr.has_confirmed_outcomes,
      cdm.id AS model_id,
      cdm.model_key,
      cdm.model_name,
      cdm.model_type,
      cdm.min_data_readiness_level,
      cdm.validation_status AS model_status
    FROM public.condition_data_readiness cdr
    CROSS JOIN public.condition_degradation_models cdm
    WHERE cdm.validation_status != 'active'
      AND cdr.drl_level >= cdm.min_data_readiness_level
      AND cdr.drl_level > 0
      AND cdr.asset_id IS NOT NULL
  ),
  nuevas AS (
    INSERT INTO public.condition_improvement_proposals (
      proposal_key, title, description, proposal_type, source_analysis,
      current_state, expected_benefit, risk, status
    )
    SELECT
      'imp_model_' || c.asset_id || '_' || c.model_key,
      'Activo ' || c.asset_id || ' alcanzó DRL ' || c.drl_level ||
        ': considerar activar ' || c.model_name,
      'El asset ' || c.asset_id || ' ha alcanzado un Data Readiness Level de ' ||
        c.drl_level || ', que cumple con el mínimo requerido (' ||
        c.min_data_readiness_level || ') para el modelo ' || c.model_name ||
        ' (' || c.model_key || ', tipo: ' || c.model_type ||
        '). Estado actual del modelo: ' || c.model_status || '. ' ||
        'Evidencia: ' || c.sample_count || ' muestras, ratio G0/G1: ' ||
        c.g0g1_ratio || '%, eventos: ' || CASE WHEN c.has_events THEN 'sí' ELSE 'no' END ||
        ', feedback: ' || CASE WHEN c.has_feedback THEN 'sí' ELSE 'no' END ||
        ', fallas confirmadas: ' || CASE WHEN c.has_confirmed_outcomes THEN 'sí' ELSE 'no' END ||
        '.',
      'model_switch',
      'drl_model:' || c.asset_id || ':' || c.model_key,
      jsonb_build_object(
        'asset_id', c.asset_id,
        'drl_level', c.drl_level,
        'model_id', c.model_id,
        'model_key', c.model_key,
        'model_name', c.model_name,
        'model_type', c.model_type,
        'min_data_readiness_level', c.min_data_readiness_level,
        'model_status', c.model_status,
        'sample_count', c.sample_count,
        'g0g1_ratio', c.g0g1_ratio,
        'has_events', c.has_events,
        'has_feedback', c.has_feedback,
        'has_confirmed_outcomes', c.has_confirmed_outcomes,
        'detected_at', NOW()
      ),
      'Activar ' || c.model_name || ' para ' || c.asset_id ||
        ' puede mejorar la precisión de las predicciones de degradación ' ||
        'aprovechando la madurez de datos actual del activo.',
      'Activar un modelo sin validación suficiente o sin parametrización adecuada ' ||
        'puede generar predicciones incorrectas. Se recomienda revisión y pruebas ' ||
        'en modo field_trial antes de activación completa.',
      'draft'
    FROM candidatas c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.condition_improvement_proposals e
      WHERE e.source_analysis = 'drl_model:' || c.asset_id || ':' || c.model_key
        AND e.status IN ('draft', 'review', 'approved')
    )
    ON CONFLICT (proposal_key) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_batch_count FROM nuevas;
  v_count := v_count + v_batch_count;

  -- ============================================================
  -- Retornar total de propuestas creadas en esta ejecución
  -- ============================================================
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.generate_improvement_proposals()
  IS 'Genera propuestas de mejora automáticas escaneando 5 fuentes: (1) reglas ruidosas con FP>50%, (2) bajo rendimiento con confirmed_rate<30%, (3) sesgo RUL con ABS(bias)>20h, (4) fuentes con >50% datos G3 en 7 días, (5) assets con DRL suficiente para modelos no activos. Deduplica por source_analysis + status. Retorna cantidad de nuevas propuestas. SECURITY DEFINER.';


-- ============================================================
-- 2. FUNCIÓN: assess_improvement_opportunities(p_asset_id)
--    Modo preview: mismos 5 escaneos que
--    generate_improvement_proposals() pero retorna los resultados
--    como tabla SIN insertar nada.
--
--    STABLE (read-only) — puede llamarse sin efectos secundarios.
--    Útil para previsualizar qué propuestas se generarían antes
--    de ejecutar generate_improvement_proposals().
--
--    Parámetros:
--      p_asset_id — opcional, filtra por asset específico
--        (aplica a fuentes 3, 5; fuente 4 filtra por source
--        asociado al asset)
--
--    Retorna:
--      opportunity_type — tipo de oportunidad detectada
--      source_key — clave del origen (rule_name, fm_key, etc.)
--      current_value — valor actual de la métrica evaluada
--      threshold — umbral que activó la detección
--      description — descripción legible de la oportunidad
--      drl_level — DRL actual del asset (solo para fuente 5)
-- ============================================================
CREATE OR REPLACE FUNCTION public.assess_improvement_opportunities(
  p_asset_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  opportunity_type TEXT,
  source_key TEXT,
  current_value NUMERIC,
  threshold NUMERIC,
  description TEXT,
  drl_level INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- ============================================================
  -- FUENTE 1: Reglas ruidosas
  -- ============================================================
  RETURN QUERY
  SELECT
    'noisy_rule'::TEXT,
    nr.rule_name,
    ROUND((nr.false_positive_rate * 100)::NUMERIC, 1),
    50.0::NUMERIC,
    'Revisar regla ' || nr.rule_name || ': tasa de FP ' ||
      ROUND((nr.false_positive_rate * 100)::NUMERIC, 1) || '% supera el 50% (n=' ||
      nr.total_diagnoses || ')',
    NULL::INT
  FROM public.condition_noisy_rules nr
  WHERE nr.false_positive_rate > 0.50
    AND nr.total_diagnoses > 0;

  -- ============================================================
  -- FUENTE 2a: Bajo rendimiento por FM
  -- ============================================================
  RETURN QUERY
  SELECT
    'low_performance'::TEXT,
    'fm:' || pbf.failure_mode_key,
    ROUND((pbf.confirmed_rate * 100)::NUMERIC, 1),
    30.0::NUMERIC,
    'Bajo rendimiento en FM ' || pbf.failure_mode_key || ': tasa de confirmación ' ||
      ROUND((pbf.confirmed_rate * 100)::NUMERIC, 1) || '% (n=' ||
      pbf.total_diagnoses || ')',
    NULL::INT
  FROM public.condition_performance_by_fm pbf
  WHERE pbf.confirmed_rate < 0.30
    AND pbf.total_diagnoses >= 3;

  -- ============================================================
  -- FUENTE 2b: Bajo rendimiento por regla
  -- ============================================================
  RETURN QUERY
  SELECT
    'low_performance'::TEXT,
    'rule:' || pbr.rule_name,
    ROUND((pbr.false_positive_rate * 100)::NUMERIC, 1),
    70.0::NUMERIC,
    'Bajo rendimiento en regla ' || pbr.rule_name || ': tasa de FP ' ||
      ROUND((pbr.false_positive_rate * 100)::NUMERIC, 1) || '% (n=' ||
      pbr.diagnoses_count || ')',
    NULL::INT
  FROM public.condition_performance_by_rule pbr
  WHERE (pbr.diagnoses_count - pbr.confirmed_count)::NUMERIC / NULLIF(pbr.diagnoses_count, 0) > 0.70
    AND pbr.diagnoses_count >= 3;

  -- ============================================================
  -- FUENTE 3: Sesgo de calibración RUL
  -- ============================================================
  RETURN QUERY
  SELECT
    'rul_bias'::TEXT,
    COALESCE(pc.asset_id, '(global)') || ':' || COALESCE(pc.failure_mode_key, 'all'),
    ROUND(COALESCE(pc.bias, 0)::NUMERIC, 1),
    20.0::NUMERIC,
    'Sesgo de RUL en asset ' || COALESCE(pc.asset_id, '(global)') || ': bias de ' ||
      ROUND(COALESCE(pc.bias, 0)::NUMERIC, 1) || ' horas (n=' ||
      pc.total_predictions || ')',
    NULL::INT
  FROM public.condition_prediction_calibration pc
  WHERE ABS(COALESCE(pc.bias, 0)) > 20
    AND COALESCE(pc.total_predictions, 0) >= 3
    AND (p_asset_id IS NULL OR pc.asset_id = p_asset_id);

  -- ============================================================
  -- FUENTE 4: Baja calidad de datos
  -- ============================================================
  RETURN QUERY
  SELECT
    'low_quality'::TEXT,
    'source:' || sq.source_id,
    sq.g3_pct,
    50.0::NUMERIC,
    'Fuente ' || sq.source_id || ' (' || COALESCE(sq.source_name, '') ||
      '): ' || sq.g3_pct || '% de datos en G3 (n=' || sq.total_values || ')',
    NULL::INT
  FROM (
    SELECT
      w.source_id,
      MAX(cs.name) AS source_name,
      COUNT(*)::INT AS total_values,
      ROUND(
        COUNT(*) FILTER (WHERE cfv.quality_flag = 'G3')::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
      ) AS g3_pct
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows w ON cfv.window_id = w.id
    JOIN public.condition_sources cs ON cs.source_id = w.source_id
    WHERE w.window_end >= NOW() - INTERVAL '7 days'
      AND (p_asset_id IS NULL OR cs.asset_id = p_asset_id)
    GROUP BY w.source_id
    HAVING COUNT(*) >= 10
      AND COUNT(*) FILTER (WHERE cfv.quality_flag = 'G3')::NUMERIC
           / NULLIF(COUNT(*), 0) > 0.50
  ) sq;

  -- ============================================================
  -- FUENTE 5: DRL + modelo disponible
  -- ============================================================
  RETURN QUERY
  SELECT
    'model_switch'::TEXT,
    c.asset_id || ':' || c.model_key,
    c.drl_level::NUMERIC,
    c.min_data_readiness_level::NUMERIC,
    'Activo ' || c.asset_id || ' (DRL ' || c.drl_level || '): considerar ' ||
      c.model_name || ' (requiere DRL ' || c.min_data_readiness_level || ')',
    c.drl_level
  FROM (
    SELECT
      cdr.asset_id,
      cdr.drl_level,
      cdr.sample_count,
      cdm.model_key,
      cdm.model_name,
      cdm.min_data_readiness_level,
      cdm.validation_status AS model_status
    FROM public.condition_data_readiness cdr
    CROSS JOIN public.condition_degradation_models cdm
    WHERE cdm.validation_status != 'active'
      AND cdr.drl_level >= cdm.min_data_readiness_level
      AND cdr.drl_level > 0
      AND cdr.asset_id IS NOT NULL
      AND (p_asset_id IS NULL OR cdr.asset_id = p_asset_id)
  ) c;
END;
$$;

COMMENT ON FUNCTION public.assess_improvement_opportunities(TEXT)
  IS 'Modo preview: evalúa oportunidades de mejora sin crear propuestas. Escanea las mismas 5 fuentes que generate_improvement_proposals() pero retorna TABLE con opportunity_type, source_key, current_value, threshold, description y drl_level. STABLE — no modifica datos. Parámetro p_asset_id opcional para filtrar.';

-- ============================================================
-- FIN MIGRATION: sdd6_improvement_functions
-- ============================================================
