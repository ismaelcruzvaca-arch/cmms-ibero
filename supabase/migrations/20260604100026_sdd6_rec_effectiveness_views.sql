-- ============================================================
-- MIGRATION: sdd6_rec_effectiveness_views — Recommendation
--   Effectiveness Views (SDD 6, PR 3)
-- Change: condition-monitoring-performance-improvement (PR 3)
-- ============================================================
-- Implementa 3 vistas de efectividad de recomendaciones de
-- mantenimiento, consultando maintenance_recommendations como
-- fuente principal de datos:
--
--   1. condition_rec_effectiveness
--      — Métricas globales: totales, aprobación, conversión,
--        descarte por estado.
--   2. condition_rec_by_priority
--      — Desglose por nivel de prioridad con tasas de
--        conversión por grupo.
--   3. condition_rec_by_policy
--      — Efectividad por política HITL utilizada. Obtiene
--        policy_key desde condition_audit_log (rec_auto_generated),
--        con fallback a 'unknown' para recomendaciones sin
--        registro de auditoría.
--
-- Idempotente: CREATE OR REPLACE VIEW.
-- Denominador seguro con NULLIF — retorna 0s, no errores.
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. VIEW: condition_rec_effectiveness
--    Métricas globales de efectividad de recomendaciones.
--    Siempre retorna exactamente 1 fila (COUNT sin GROUP BY).
-- ============================================================
CREATE OR REPLACE VIEW public.condition_rec_effectiveness
AS
SELECT
  COUNT(*) AS total_recommendations,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_count,
  COUNT(*) FILTER (WHERE status = 'converted_to_wo') AS converted_count,
  COUNT(*) FILTER (WHERE status = 'suggested') AS suggested_count,
  COUNT(*) FILTER (WHERE status = 'review_required') AS review_required_count,
  COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
  COUNT(*) FILTER (WHERE status = 'superseded') AS superseded_count,
  COALESCE(
    COUNT(*) FILTER (WHERE status = 'converted_to_wo')::NUMERIC
    / NULLIF(
      COUNT(*) FILTER (WHERE status IN ('approved', 'converted_to_wo')),
      0
    ),
    0
  ) AS conversion_rate,
  COALESCE(
    COUNT(*) FILTER (WHERE status = 'dismissed')::NUMERIC
    / NULLIF(COUNT(*), 0),
    0
  ) AS dismissal_rate
FROM public.maintenance_recommendations;

COMMENT ON VIEW public.condition_rec_effectiveness
  IS 'Métricas globales de efectividad de recomendaciones: totales, conteos por estado, conversion_rate (converted / (approved + converted)) y dismissal_rate (dismissed / total). NULLIF denominator safety — retorna 0s, no errores, en datos vacíos.';

-- ============================================================
-- 2. VIEW: condition_rec_by_priority
--    Desglose de recomendaciones por nivel de prioridad.
--    Ordenado: critical > high > medium > low.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_rec_by_priority
AS
SELECT
  priority,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'approved') AS approved,
  COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed,
  COUNT(*) FILTER (WHERE status = 'converted_to_wo') AS converted_to_wo,
  COALESCE(
    COUNT(*) FILTER (WHERE status = 'converted_to_wo')::NUMERIC
    / NULLIF(
      COUNT(*) FILTER (WHERE status IN ('approved', 'converted_to_wo')),
      0
    ),
    0
  ) AS conversion_rate
FROM public.maintenance_recommendations
GROUP BY priority
ORDER BY
  CASE priority
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
  END;

COMMENT ON VIEW public.condition_rec_by_priority
  IS 'Desglose de recomendaciones por nivel de prioridad (critical > high > medium > low). Incluye totales, aprobados, descartados, convertidos y conversion_rate por grupo.';

-- ============================================================
-- 3. VIEW: condition_rec_by_policy
--    Efectividad de recomendaciones por política HITL.
--    Obtiene policy_key desde condition_audit_log para acciones
--    rec_auto_generated. Recomendaciones sin registro de
--    auditoría (manuales o pre-governance) se agrupan como
--    'unknown'.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_rec_by_policy
AS
SELECT
  COALESCE(cal.after_state->>'policy_key', 'unknown') AS policy_evaluation,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE mr.status = 'approved') AS approved,
  COUNT(*) FILTER (WHERE mr.status = 'dismissed') AS dismissed,
  COUNT(*) FILTER (WHERE mr.status = 'converted_to_wo') AS converted_to_wo,
  COALESCE(
    COUNT(*) FILTER (WHERE mr.status = 'converted_to_wo')::NUMERIC
    / NULLIF(
      COUNT(*) FILTER (WHERE mr.status IN ('approved', 'converted_to_wo')),
      0
    ),
    0
  ) AS conversion_rate,
  COALESCE(
    COUNT(*) FILTER (WHERE mr.status = 'dismissed')::NUMERIC
    / NULLIF(COUNT(*), 0),
    0
  ) AS dismissal_rate
FROM public.maintenance_recommendations mr
LEFT JOIN public.condition_audit_log cal
  ON cal.entity_type = 'maintenance_recommendations'
  AND cal.entity_id = mr.id::TEXT
  AND cal.action = 'rec_auto_generated'
GROUP BY policy_evaluation
ORDER BY total DESC;

COMMENT ON VIEW public.condition_rec_by_policy
  IS 'Efectividad de recomendaciones por política HITL. policy_evaluation se obtiene desde condition_audit_log.after_state->>policy_key para acciones rec_auto_generated. Fallback a unknown para recomendaciones sin registro. Incluye totales, aprobados, descartados, convertidos y tasas.';
