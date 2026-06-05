-- ============================================================
-- MIGRATION: sdd6_performance_views_functions — Performance
--   Metrics, FP/FN Views, and Daily Metrics Extension
--   (SDD 6, PR 2b)
-- Change: condition-monitoring-performance-improvement (PR 2b)
-- ============================================================
-- Implementa funciones y vistas de métricas de rendimiento
-- diagnóstico, detección de falsos positivos/negativos, y
-- extensión de métricas diarias:
--
--   1. compute_performance_metrics(p_asset_id)
--      — Métricas globales + desglose por FM/regla/fuente
--   2. condition_false_positives VIEW
--      — Diagnósticos con feedback/outcome rechazado
--   3. compute_false_positives(p_asset_id)
--      — Wrapper sobre la VIEW para consistencia
--   4. condition_missed_detections VIEW
--      — OTs correctivas sin diagnóstico previo (30/60/90d)
--   5. condition_noisy_rules VIEW
--      — Reglas con FP rate > 50% o confirmed rate < 10%
--   6. condition_performance_by_fm VIEW
--      — Desglose por modo de falla
--   7. condition_performance_by_rule VIEW
--      — Desglose por regla
--   8. condition_performance_by_source VIEW
--      — Desglose por fuente de datos
--   9. ALTER condition_daily_metrics
--      — +3 columnas de outcomes
--  10. CREATE OR REPLACE compute_daily_metrics()
--      — Extendida para incluir outcomes
--
-- Idempotente: CREATE OR REPLACE FUNCTION/VIEW,
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN: compute_performance_metrics(p_asset_id)
--    Métricas de rendimiento diagnóstico con desglose por
--    modo de falla, regla y fuente.
--
--    RETORNA:
--      metric_name       — nombre de la métrica
--      metric_value      — valor calculado (NUMERIC)
--      numerator         — numerador del rate (INT)
--      denominator       — denominador del rate (INT, NULL si no aplica)
--      breakdown_category— 'overall'|'by_failure_mode'|'by_rule'|'by_source'
--      breakdown_key     — clave del desglose o 'overall'
--
--    NULLIF denominator safety: retorna 0, no NULL, no error.
--    STABLE — no modifica datos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_performance_metrics(
  p_asset_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  metric_name TEXT,
  metric_value NUMERIC,
  numerator INT,
  denominator INT,
  breakdown_category TEXT,
  breakdown_key TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_reviewed INT;
  v_confirmed INT;
  v_rejected INT;
  v_partial INT;
  v_avg_conf NUMERIC;
BEGIN
  -- ==============================================================
  -- Overall: contar diagnósticos con feedback y outcomes
  -- ==============================================================
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (
      WHERE cd.feedback_status IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.condition_outcomes co WHERE co.diagnosis_id = cd.id)
    )::INT,
    COUNT(*) FILTER (
      WHERE cd.feedback_status = 'confirmed'
         OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                    WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'confirmed')
    )::INT,
    COUNT(*) FILTER (
      WHERE cd.feedback_status = 'rejected'
         OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                    WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'rejected')
    )::INT,
    COUNT(*) FILTER (
      WHERE cd.feedback_status = 'partial'
         OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                    WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'partial')
    )::INT,
    COALESCE(AVG(cd.confidence), 0)::NUMERIC(5,4)
  INTO v_total, v_reviewed, v_confirmed, v_rejected, v_partial, v_avg_conf
  FROM public.condition_diagnoses cd
  WHERE (p_asset_id IS NULL OR cd.asset_id = p_asset_id);

  -- Métrica: total_diagnoses
  RETURN QUERY SELECT 'total_diagnoses'::TEXT, v_total::NUMERIC,
    v_total, NULL::INT, 'overall'::TEXT, 'overall'::TEXT;
  -- Métrica: reviewed_count
  RETURN QUERY SELECT 'reviewed_count'::TEXT, v_reviewed::NUMERIC,
    v_reviewed, NULL::INT, 'overall', 'overall';
  -- Métrica: confirmed_count
  RETURN QUERY SELECT 'confirmed_count'::TEXT, v_confirmed::NUMERIC,
    v_confirmed, NULL::INT, 'overall', 'overall';
  -- Métrica: rejected_count
  RETURN QUERY SELECT 'rejected_count'::TEXT, v_rejected::NUMERIC,
    v_rejected, NULL::INT, 'overall', 'overall';
  -- Métrica: partial_count
  RETURN QUERY SELECT 'partial_count'::TEXT, v_partial::NUMERIC,
    v_partial, NULL::INT, 'overall', 'overall';
  -- Métrica: confirmed_rate = confirmed / NULLIF(reviewed, 0)
  RETURN QUERY SELECT 'confirmed_rate'::TEXT,
    COALESCE(v_confirmed::NUMERIC / NULLIF(v_reviewed, 0), 0),
    v_confirmed, v_reviewed, 'overall', 'overall';
  -- Métrica: rejection_rate = rejected / NULLIF(reviewed, 0)
  RETURN QUERY SELECT 'rejection_rate'::TEXT,
    COALESCE(v_rejected::NUMERIC / NULLIF(v_reviewed, 0), 0),
    v_rejected, v_reviewed, 'overall', 'overall';
  -- Métrica: feedback_coverage = reviewed / NULLIF(total, 0)
  RETURN QUERY SELECT 'feedback_coverage'::TEXT,
    COALESCE(v_reviewed::NUMERIC / NULLIF(v_total, 0), 0),
    v_reviewed, v_total, 'overall', 'overall';
  -- Métrica: avg_confidence
  RETURN QUERY SELECT 'avg_confidence'::TEXT, v_avg_conf,
    NULL::INT, NULL::INT, 'overall', 'overall';

  -- ==============================================================
  -- Breakdown: por failure_mode (MET-003)
  --   Por cada FM con diagnósticos, retorna confirmed_rate,
  --   rejection_rate y avg_confidence
  -- ==============================================================
  RETURN QUERY
  WITH fm_metrics AS (
    SELECT
      cfmc.failure_mode_key,
      COUNT(DISTINCT cd.id)::INT AS total,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'confirmed'
           OR co.confirmed_status = 'confirmed'
      )::INT AS confirmed,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'rejected'
           OR co.confirmed_status = 'rejected'
      )::INT AS rejected,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'partial'
           OR co.confirmed_status = 'partial'
      )::INT AS partial,
      AVG(cd.confidence)::NUMERIC(5,4) AS avg_conf
    FROM public.condition_failure_mode_catalog cfmc
    LEFT JOIN public.condition_diagnoses cd ON cd.failure_mode_id = cfmc.id
      AND (p_asset_id IS NULL OR cd.asset_id = p_asset_id)
    LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
    LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
    GROUP BY cfmc.failure_mode_key
  )
  SELECT 'confirmed_rate'::TEXT,
    COALESCE(fm.confirmed::NUMERIC / NULLIF(fm.total, 0), 0),
    fm.confirmed, fm.total,
    'by_failure_mode'::TEXT, fm.failure_mode_key
  FROM fm_metrics fm
  WHERE fm.total > 0
  UNION ALL
  SELECT 'rejection_rate'::TEXT,
    COALESCE(fm.rejected::NUMERIC / NULLIF(fm.total, 0), 0),
    fm.rejected, fm.total,
    'by_failure_mode'::TEXT, fm.failure_mode_key
  FROM fm_metrics fm
  WHERE fm.total > 0
  UNION ALL
  SELECT 'avg_confidence'::TEXT, fm.avg_conf,
    NULL::INT, NULL::INT,
    'by_failure_mode'::TEXT, fm.failure_mode_key
  FROM fm_metrics fm
  WHERE fm.total > 0;

  -- ==============================================================
  -- Breakdown: por rule (MET-004)
  --   Lineage: condition_rules → condition_events →
  --   condition_diagnoses → feedback/outcomes
  -- ==============================================================
  RETURN QUERY
  WITH rule_metrics AS (
    SELECT
      cr.rule_name,
      COUNT(DISTINCT cd.id)::INT AS total,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'confirmed'
           OR co.confirmed_status = 'confirmed'
      )::INT AS confirmed,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'rejected'
           OR co.confirmed_status = 'rejected'
      )::INT AS rejected,
      AVG(cd.confidence)::NUMERIC(5,4) AS avg_conf
    FROM public.condition_rules cr
    LEFT JOIN public.condition_events ce ON ce.rule_id = cr.id
    LEFT JOIN public.condition_diagnoses cd ON cd.linked_event_id = ce.id
      AND (p_asset_id IS NULL OR cd.asset_id = p_asset_id)
    LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
    LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
    GROUP BY cr.rule_name
  )
  SELECT 'confirmed_rate'::TEXT,
    COALESCE(rm.confirmed::NUMERIC / NULLIF(rm.total, 0), 0),
    rm.confirmed, rm.total,
    'by_rule'::TEXT, rm.rule_name
  FROM rule_metrics rm
  WHERE rm.total > 0
  UNION ALL
  SELECT 'false_positive_rate'::TEXT,
    COALESCE(rm.rejected::NUMERIC / NULLIF(rm.total, 0), 0),
    rm.rejected, rm.total,
    'by_rule'::TEXT, rm.rule_name
  FROM rule_metrics rm
  WHERE rm.total > 0
  UNION ALL
  SELECT 'avg_confidence'::TEXT, rm.avg_conf,
    NULL::INT, NULL::INT,
    'by_rule'::TEXT, rm.rule_name
  FROM rule_metrics rm
  WHERE rm.total > 0;

  -- ==============================================================
  -- Breakdown: por source (MET-005)
  --   Lineage: condition_diagnoses.source_window_ids →
  --   condition_windows → source_id
  -- ==============================================================
  RETURN QUERY
  WITH source_metrics AS (
    SELECT
      w.source_id,
      w.source_type,
      COUNT(DISTINCT cd.id)::INT AS total,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'confirmed'
           OR co.confirmed_status = 'confirmed'
      )::INT AS confirmed,
      COUNT(DISTINCT cd.id) FILTER (
        WHERE cdf.feedback_status = 'rejected'
           OR co.confirmed_status = 'rejected'
      )::INT AS rejected
    FROM public.condition_diagnoses cd
    CROSS JOIN LATERAL UNNEST(cd.source_window_ids) AS sw_id(uuid)
    JOIN public.condition_windows w ON w.id = sw_id.uuid
    LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
    LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
    WHERE (p_asset_id IS NULL OR cd.asset_id = p_asset_id)
    GROUP BY w.source_id, w.source_type
  )
  SELECT 'confirmed_rate'::TEXT,
    COALESCE(sm.confirmed::NUMERIC / NULLIF(sm.total, 0), 0),
    sm.confirmed, sm.total,
    'by_source'::TEXT, sm.source_id
  FROM source_metrics sm
  WHERE sm.total > 0
  UNION ALL
  SELECT 'rejection_rate'::TEXT,
    COALESCE(sm.rejected::NUMERIC / NULLIF(sm.total, 0), 0),
    sm.rejected, sm.total,
    'by_source'::TEXT, sm.source_id
  FROM source_metrics sm
  WHERE sm.total > 0;
END;
$$;

COMMENT ON FUNCTION public.compute_performance_metrics(TEXT)
  IS 'Métricas de rendimiento diagnóstico: confirmed_rate, rejection_rate, feedback_coverage, avg_confidence con desglose por failure_mode, rule y source. NULLIF denominator safety — retorna 0s, no errores. Parámetro p_asset_id opcional para filtrar por activo. STABLE — no modifica datos.';


-- ============================================================
-- 2. VISTA: condition_false_positives
--    Diagnósticos clasificados como falsos positivos.
--    Un diagnóstico es FP si:
--      - feedback_status = 'rejected' en condition_diagnosis_feedback
--      - O confirmed_status = 'rejected' en condition_outcomes
--    Advisory — no auto-deshabilita nada.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_false_positives
AS
SELECT
  cd.id AS diagnosis_id,
  cd.asset_id,
  cfmc.failure_mode_key,
  CASE
    WHEN cdf.feedback_status = 'rejected' THEN 'feedback'
    WHEN co.confirmed_status = 'rejected' THEN 'outcome'
    ELSE 'unknown'
  END AS rejection_source,
  cdf.feedback_status,
  co.confirmed_status,
  COALESCE(cdf.reviewed_by, co.reviewed_by) AS reviewed_by,
  COALESCE(cdf.reviewed_at, co.reviewed_at, cd.created_at) AS rejected_at
FROM public.condition_diagnoses cd
LEFT JOIN public.condition_failure_mode_catalog cfmc
  ON cfmc.id = cd.failure_mode_id
LEFT JOIN public.condition_diagnosis_feedback cdf
  ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co
  ON co.diagnosis_id = cd.id
WHERE cdf.feedback_status = 'rejected'
   OR co.confirmed_status = 'rejected';

COMMENT ON VIEW public.condition_false_positives
  IS 'Diagnósticos clasificados como falsos positivos: feedback_status=rejected o outcome.confirmed_status=rejected. Incluye rejection_source (feedback|outcome) y metadatos de revisión. Advisory — no auto-deshabilita nada.';


-- ============================================================
-- 3. FUNCIÓN: compute_false_positives(p_asset_id)
--    Wrapper sobre condition_false_positives para consistencia
--    con la API de compute_performance_metrics().
--    STABLE — no modifica datos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_false_positives(
  p_asset_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  diagnosis_id UUID,
  asset_id TEXT,
  failure_mode_key TEXT,
  rule_name TEXT,
  confidence NUMERIC,
  feedback_status TEXT,
  outcome_status TEXT,
  flagged_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT
    cd.id,
    cd.asset_id,
    cfmc.failure_mode_key,
    cr.rule_name,
    cd.confidence,
    cdf.feedback_status,
    co.confirmed_status AS outcome_status,
    COALESCE(cdf.reviewed_at, co.reviewed_at, cd.created_at) AS flagged_at
  FROM public.condition_diagnoses cd
  LEFT JOIN public.condition_failure_mode_catalog cfmc ON cfmc.id = cd.failure_mode_id
  LEFT JOIN public.condition_events ce ON ce.id = cd.linked_event_id
  LEFT JOIN public.condition_rules cr ON cr.id = ce.rule_id
  LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
  LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
  WHERE (p_asset_id IS NULL OR cd.asset_id = p_asset_id)
    AND (cdf.feedback_status = 'rejected' OR co.confirmed_status = 'rejected');
$$;

COMMENT ON FUNCTION public.compute_false_positives(TEXT)
  IS 'Retorna diagnósticos clasificados como falsos positivos, incluyendo regla asociada y confianza. Parámetro p_asset_id opcional para filtrar por activo. DISTINCT para evitar duplicados por 1:N feedback/outcome. STABLE — no modifica datos.';


-- ============================================================
-- 4. VISTA: condition_missed_detections
--    OTs correctivas (CM) sin diagnóstico de condición previo
--    para el mismo asset en ventanas configurables.
--    Ventanas: 30, 60 y 90 días (CROSS JOIN con VALUES).
--    Advisory — no auto-crea diagnósticos.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_missed_detections
AS
WITH window_settings(preceding_days) AS (
  VALUES (30), (60), (90)
),
cm_work_orders AS (
  SELECT
    wo.id AS work_order_id,
    wo.asset_id,
    wo.wo_type,
    wo.created_at AS wo_created_at,
    wo.closed_at
  FROM public.work_orders wo
  WHERE wo.wo_type = 'CM'
    AND wo.created_at > NOW() - INTERVAL '365 days'
)
SELECT
  cm.work_order_id,
  cm.asset_id,
  cm.wo_type,
  cm.wo_created_at,
  ws.preceding_days,
  (
    SELECT COUNT(*)::INT
    FROM public.condition_diagnoses cd
    WHERE cd.asset_id = cm.asset_id::TEXT
      AND cd.created_at >= cm.wo_created_at - (ws.preceding_days || ' days')::INTERVAL
  ) AS diagnoses_in_window,
  (
    SELECT MAX(cd.created_at)
    FROM public.condition_diagnoses cd
    WHERE cd.asset_id = cm.asset_id::TEXT
      AND cd.created_at >= cm.wo_created_at - (ws.preceding_days || ' days')::INTERVAL
  ) AS last_diagnosis_at
FROM cm_work_orders cm
CROSS JOIN window_settings ws
WHERE (
  SELECT COUNT(*)
  FROM public.condition_diagnoses cd
  WHERE cd.asset_id = cm.asset_id::TEXT
    AND cd.created_at >= cm.wo_created_at - (ws.preceding_days || ' days')::INTERVAL
) = 0;

COMMENT ON VIEW public.condition_missed_detections
  IS 'OTs correctivas (CM) de los últimos 365 días sin diagnóstico de condición previo para el mismo asset en ventanas de 30/60/90 días. Advisory — no auto-crea diagnósticos. Usar WHERE preceding_days = N para filtrar ventana.';


-- ============================================================
-- 5. VISTA: condition_noisy_rules
--    Reglas con FP rate > 50% o confirmed_rate < 10%.
--    flagged_for_review = TRUE indica revisión humana necesaria.
--    Reglas sin diagnósticos no son evaluadas.
--    Advisory — no auto-deshabilita reglas.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_noisy_rules
AS
WITH rule_stats AS (
  SELECT
    cr.id AS rule_id,
    cr.rule_name,
    cr.evaluation_type,
    cr.validation_status,
    COUNT(DISTINCT cd.id)::INT AS total_diagnoses,
    COUNT(DISTINCT cd.id) FILTER (
      WHERE cdf.feedback_status = 'confirmed'
         OR co.confirmed_status = 'confirmed'
    )::INT AS confirmed_count,
    COUNT(DISTINCT cd.id) FILTER (
      WHERE cdf.feedback_status = 'rejected'
         OR co.confirmed_status = 'rejected'
    )::INT AS rejected_count
  FROM public.condition_rules cr
  LEFT JOIN public.condition_events ce ON ce.rule_id = cr.id
  LEFT JOIN public.condition_diagnoses cd ON cd.linked_event_id = ce.id
  LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
  LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
  GROUP BY cr.id, cr.rule_name, cr.evaluation_type, cr.validation_status
)
SELECT
  rs.rule_id,
  rs.rule_name,
  rs.evaluation_type,
  rs.validation_status,
  rs.total_diagnoses,
  rs.confirmed_count,
  rs.rejected_count,
  COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) AS false_positive_rate,
  COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) AS confirmed_rate,
  CASE
    WHEN rs.total_diagnoses = 0 THEN FALSE
    WHEN COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) > 0.50 THEN TRUE
    WHEN COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) < 0.10 THEN TRUE
    ELSE FALSE
  END AS flagged_for_review
FROM rule_stats rs
WHERE rs.total_diagnoses > 0
  AND (
    COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) > 0.50
    OR COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) < 0.10
  );

COMMENT ON VIEW public.condition_noisy_rules
  IS 'Reglas ruidosas: FP rate > 50% o confirmed_rate < 10%. flagged_for_review=TRUE indica revisión humana necesaria. Reglas sin diagnósticos no son evaluadas. Advisory — no auto-deshabilita reglas.';


-- ============================================================
-- 6. VISTA: condition_performance_by_fm
--    Rendimiento diagnóstico desglosado por modo de falla.
--    Incluye confirmed_rate y avg_confidence por FM.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_performance_by_fm
AS
SELECT
  cfmc.failure_mode_key,
  cfmc.name AS failure_mode_name,
  cfmc.asset_class,
  COUNT(DISTINCT cd.id)::INT AS total_diagnoses,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  )::INT AS confirmed_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  )::INT AS rejected_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'partial'
       OR cdf.feedback_status = 'partial'
  )::INT AS partial_count,
  COALESCE(
    COUNT(DISTINCT cd.id) FILTER (
      WHERE co.confirmed_status = 'confirmed'
         OR cdf.feedback_status = 'confirmed'
    )::NUMERIC / NULLIF(
      COUNT(DISTINCT cd.id) FILTER (
        WHERE co.confirmed_status IS NOT NULL
           OR cdf.feedback_status IS NOT NULL
      ), 0
    ), 0
  ) AS confirmed_rate,
  AVG(cd.confidence)::NUMERIC(5,4) AS avg_confidence
FROM public.condition_failure_mode_catalog cfmc
LEFT JOIN public.condition_diagnoses cd ON cd.failure_mode_id = cfmc.id
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
GROUP BY cfmc.failure_mode_key, cfmc.name, cfmc.asset_class;

COMMENT ON VIEW public.condition_performance_by_fm
  IS 'Rendimiento diagnóstico desglosado por modo de falla. Incluye confirmed_rate, rejected_count, avg_confidence por failure_mode_key. Consume condition_diagnoses + feedback + outcomes.';


-- ============================================================
-- 7. VISTA: condition_performance_by_rule
--    Rendimiento diagnóstico desglosado por regla de condición.
--    Lineage: condition_rules → condition_events →
--    condition_diagnoses → feedback/outcomes.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_performance_by_rule
AS
SELECT
  cr.id AS rule_id,
  cr.rule_name,
  cr.evaluation_type,
  COUNT(DISTINCT cd.id)::INT AS diagnoses_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  )::INT AS confirmed_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  )::INT AS rejected_count,
  COALESCE(
    COUNT(DISTINCT cd.id) FILTER (
      WHERE co.confirmed_status = 'rejected'
         OR cdf.feedback_status = 'rejected'
    )::NUMERIC / NULLIF(COUNT(DISTINCT cd.id), 0), 0
  ) AS false_positive_rate,
  AVG(cd.confidence)::NUMERIC(5,4) AS avg_confidence
FROM public.condition_rules cr
LEFT JOIN public.condition_events ce ON ce.rule_id = cr.id
LEFT JOIN public.condition_diagnoses cd ON cd.linked_event_id = ce.id
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
GROUP BY cr.id, cr.rule_name, cr.evaluation_type;

COMMENT ON VIEW public.condition_performance_by_rule
  IS 'Rendimiento diagnóstico desglosado por regla de condición. Lineage: condition_rules → condition_events → condition_diagnoses → feedback/outcomes. Incluye false_positive_rate y avg_confidence.';


-- ============================================================
-- 8. VISTA: condition_performance_by_source
--    Rendimiento diagnóstico desglosado por fuente de datos.
--    Lineage: condition_diagnoses.source_window_ids →
--    condition_windows. Diagnósticos multi-fuente aparecen
--    en cada fuente contribuyente.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_performance_by_source
AS
WITH diag_sources AS (
  SELECT
    cd.id AS diagnosis_id,
    cd.asset_id,
    w.source_id,
    w.source_type
  FROM public.condition_diagnoses cd
  CROSS JOIN LATERAL UNNEST(cd.source_window_ids) AS sw_id(uuid)
  JOIN public.condition_windows w ON w.id = sw_id.uuid
)
SELECT
  ds.source_id,
  ds.source_type,
  COUNT(DISTINCT ds.diagnosis_id)::INT AS diagnoses_from_source,
  COUNT(DISTINCT ds.diagnosis_id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  )::INT AS confirmed_count,
  COUNT(DISTINCT ds.diagnosis_id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  )::INT AS rejected_count,
  COALESCE(
    COUNT(DISTINCT ds.diagnosis_id) FILTER (
      WHERE co.confirmed_status = 'confirmed'
         OR cdf.feedback_status = 'confirmed'
    )::NUMERIC / NULLIF(COUNT(DISTINCT ds.diagnosis_id), 0), 0
  ) AS confirmed_rate,
  COALESCE(
    COUNT(DISTINCT ds.diagnosis_id) FILTER (
      WHERE co.confirmed_status = 'rejected'
         OR cdf.feedback_status = 'rejected'
    )::NUMERIC / NULLIF(COUNT(DISTINCT ds.diagnosis_id), 0), 0
  ) AS rejection_rate
FROM diag_sources ds
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = ds.diagnosis_id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = ds.diagnosis_id
GROUP BY ds.source_id, ds.source_type;

COMMENT ON VIEW public.condition_performance_by_source
  IS 'Rendimiento diagnóstico desglosado por fuente de datos. Lineage: condition_diagnoses.source_window_ids → condition_windows. Diagnósticos multi-fuente aparecen en cada fuente contribuyente.';


-- ============================================================
-- 9. ALTER: condition_daily_metrics
--    Extender con columnas de outcome para integración con
--    compute_daily_metrics() (MET-006).
-- ============================================================
ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS outcomes_confirmed INT NOT NULL DEFAULT 0;

ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS outcomes_rejected INT NOT NULL DEFAULT 0;

ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS outcomes_pending INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.condition_daily_metrics.outcomes_confirmed
  IS 'Cantidad de outcomes con confirmed_status=confirmed en esta fecha (SDD 6)';
COMMENT ON COLUMN public.condition_daily_metrics.outcomes_rejected
  IS 'Cantidad de outcomes con confirmed_status=rejected en esta fecha (SDD 6)';
COMMENT ON COLUMN public.condition_daily_metrics.outcomes_pending
  IS 'Cantidad de outcomes con confirmed_status IN (partial, unknown) en esta fecha (SDD 6)';


-- ============================================================
-- 10. CREATE OR REPLACE: compute_daily_metrics()
--     Extendida para incluir conteos de outcomes.
--     Mantiene toda la lógica existente + 3 nuevas subqueries
--     de condition_outcomes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_daily_metrics(
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_count INT := 0;
BEGIN
  -- Iterar sobre todos los assets con actividad hasta la fecha dada
  FOR v_asset IN
    SELECT DISTINCT asset_id FROM public.condition_diagnoses
    WHERE created_at::DATE <= p_date
    UNION
    SELECT DISTINCT cd.asset_id FROM public.maintenance_recommendations mr
    JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
    WHERE mr.created_at::DATE <= p_date
  LOOP
    INSERT INTO public.condition_daily_metrics AS m (
      metric_date, asset_id,
      diagnoses_created,
      diagnoses_confirmed,
      diagnoses_rejected,
      recommendations_created,
      recommendations_approved,
      recommendations_dismissed,
      recommendations_converted_to_wo,
      cbm_wo_created,
      cbm_wo_closed,
      feedback_pending_count,
      -- SDD 6: outcome columns
      outcomes_confirmed,
      outcomes_rejected,
      outcomes_pending
    ) VALUES (
      p_date,
      v_asset.asset_id,

      -- diagnoses_created: count en esta fecha para este asset
      (SELECT COUNT(*)::INT FROM public.condition_diagnoses
       WHERE asset_id = v_asset.asset_id AND created_at::DATE = p_date),

      -- diagnoses_confirmed: feedback confirmado en esta fecha
      (SELECT COUNT(*)::INT FROM public.condition_diagnosis_feedback df
       JOIN public.condition_diagnoses cd ON df.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND df.feedback_status = 'confirmed'
         AND df.created_at::DATE = p_date),

      -- diagnoses_rejected: feedback rechazado en esta fecha
      (SELECT COUNT(*)::INT FROM public.condition_diagnosis_feedback df
       JOIN public.condition_diagnoses cd ON df.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND df.feedback_status = 'rejected'
         AND df.created_at::DATE = p_date),

      -- recommendations_created
      (SELECT COUNT(*)::INT FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id AND mr.created_at::DATE = p_date),

      -- recommendations_approved
      (SELECT COUNT(*)::INT FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'approved'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- recommendations_dismissed
      (SELECT COUNT(*)::INT FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'dismissed'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- recommendations_converted_to_wo
      (SELECT COUNT(*)::INT FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'converted_to_wo'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- cbm_wo_created: OTs CBM/CM creadas en esta fecha
      (SELECT COUNT(*)::INT FROM public.work_orders
       WHERE asset_id = v_asset.asset_id
         AND (wo_type IN ('CBM', 'CM') OR wo_type ILIKE '%CBM%')
         AND created_at::DATE = p_date),

      -- cbm_wo_closed: OTs CBM/CM cerradas en esta fecha
      (SELECT COUNT(*)::INT FROM public.work_orders
       WHERE asset_id = v_asset.asset_id
         AND (wo_type IN ('CBM', 'CM') OR wo_type ILIKE '%CBM%')
         AND lifecycle_phase = 'CLOSED'
         AND COALESCE(closed_at, updated_at)::DATE = p_date),

      -- feedback_pending_count: diagnósticos activos sin feedback
      (SELECT COUNT(*)::INT FROM public.condition_diagnoses
       WHERE asset_id = v_asset.asset_id
         AND feedback_status IS NULL
         AND diagnosis_status IN ('active', 'confirmed')),

      -- ==========================================================
      -- SDD 6: outcomes counts desde condition_outcomes
      -- ==========================================================

      -- outcomes_confirmed
      (SELECT COUNT(*)::INT FROM public.condition_outcomes co
       JOIN public.condition_diagnoses cd ON co.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND co.confirmed_status = 'confirmed'
         AND co.created_at::DATE = p_date),

      -- outcomes_rejected
      (SELECT COUNT(*)::INT FROM public.condition_outcomes co
       JOIN public.condition_diagnoses cd ON co.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND co.confirmed_status = 'rejected'
         AND co.created_at::DATE = p_date),

      -- outcomes_pending: partial + unknown (no definitive)
      (SELECT COUNT(*)::INT FROM public.condition_outcomes co
       JOIN public.condition_diagnoses cd ON co.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND co.confirmed_status IN ('partial', 'unknown')
         AND co.created_at::DATE = p_date)
    )
    ON CONFLICT (metric_date, asset_id) DO UPDATE SET
      diagnoses_created = EXCLUDED.diagnoses_created,
      diagnoses_confirmed = EXCLUDED.diagnoses_confirmed,
      diagnoses_rejected = EXCLUDED.diagnoses_rejected,
      recommendations_created = EXCLUDED.recommendations_created,
      recommendations_approved = EXCLUDED.recommendations_approved,
      recommendations_dismissed = EXCLUDED.recommendations_dismissed,
      recommendations_converted_to_wo = EXCLUDED.recommendations_converted_to_wo,
      cbm_wo_created = EXCLUDED.cbm_wo_created,
      cbm_wo_closed = EXCLUDED.cbm_wo_closed,
      feedback_pending_count = EXCLUDED.feedback_pending_count,
      -- SDD 6: outcome columns en el UPDATE
      outcomes_confirmed = EXCLUDED.outcomes_confirmed,
      outcomes_rejected = EXCLUDED.outcomes_rejected,
      outcomes_pending = EXCLUDED.outcomes_pending;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.compute_daily_metrics(DATE)
  IS 'Agrega métricas diarias por asset a condition_daily_metrics. Idempotente: ON CONFLICT DO UPDATE. Extendida SDD 6: incluye outcomes_confirmed, outcomes_rejected, outcomes_pending desde condition_outcomes. Acepta cualquier fecha pasada para backfill. Retorna cantidad de assets procesados.';


-- ============================================================
-- FIN MIGRATION: sdd6_performance_views_functions
-- ============================================================
