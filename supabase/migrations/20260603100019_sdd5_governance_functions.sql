-- ============================================================
-- MIGRATION: sdd5_governance_functions — Funciones de Governance
--   (SDD 5, PR 1b)
-- Change: condition-monitoring-operations-governance (PR 1b)
-- ============================================================
-- Crea 7 funciones PL/pgSQL para el pipeline de governance:
--   1. evaluate_automation_policy() — evalúa políticas HITL
--   2. generate_recommendation_v2() — genera recomendación v2
--   3. compute_source_quality_stats() — calidad por fuente
--   4. compute_daily_metrics() — métricas diarias agregadas
--   5. convert_recommendation_to_wo() — convierte rec → OT
--   6. expire_stale_recommendations() — expira vencidas
--   7. log_audit_entry() — entrada manual de auditoría
--
-- Idempotente: todas CREATE OR REPLACE FUNCTION.
-- Comentarios en español.
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN: evaluate_automation_policy
--    Evalúa políticas HITL configurables para un diagnóstico.
--    Retorna la primera política activa que matchea las
--    condiciones del diagnóstico, o un fallback conservador.
--
--    Condiciones evaluadas en orden por evaluation_order:
--      - min_confidence → diagnosis.confidence >= umbral
--      - max_contradictory_count ← evidence_summary
--      - min_completeness ← evidence_summary
--      - min_quality_flag ← quality_modifier → G0/G1/G2/G3
--      - asset_criticality_allowed ← severity_default del FM
--      - failure_mode_categories ← failure_mode_key
--      - requires_source_active ← sources activos del asset
--
--    Repeat-dismissal gate: si existe un diagnóstico previo
--    con mismo FM rechazado/superseded en últimos 30d,
--    fuerza requires_confirmation=true.
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_automation_policy(
  p_diagnosis_id UUID
) RETURNS TABLE(
  policy_key TEXT,
  requires_confirmation BOOLEAN,
  policy_metadata JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_diag RECORD;
  v_policy RECORD;
  v_conditions JSONB;
  v_prev_rejected BOOLEAN;
  v_min_quality NUMERIC;
  v_fm_failure_mode_key TEXT;
  v_fm_severity_default TEXT;
BEGIN
  -- 1. Leer diagnóstico + failure_mode (todo en un solo RECORD)
  SELECT d.*, fm.failure_mode_key, fm.severity_default
  INTO v_diag
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    -- Sin diagnóstico → sin política
    RETURN;
  END IF;

  -- Extraer campos del FM a variables locales
  v_fm_failure_mode_key := v_diag.failure_mode_key;
  v_fm_severity_default := v_diag.severity_default;

  -- 2. Repeat-dismissal gate: ¿existe un diagnóstico con el mismo
  --    failure_mode_key que fue rechazado o superseded en últimos 30d?
  SELECT EXISTS (
    SELECT 1
    FROM public.condition_diagnoses cd
    JOIN public.condition_failure_mode_catalog fm ON cd.failure_mode_id = fm.id
    WHERE fm.failure_mode_key = v_fm_failure_mode_key
      AND cd.diagnosis_status IN ('rejected', 'superseded')
      AND cd.created_at >= NOW() - INTERVAL '30 days'
      AND cd.id != p_diagnosis_id
  ) INTO v_prev_rejected;

  IF v_prev_rejected THEN
    -- Forzar confirmación humana sin importar la política
    RETURN QUERY SELECT
      'repeat_dismissal_gate'::TEXT AS policy_key,
      true::BOOLEAN AS requires_confirmation,
      jsonb_build_object(
        'reason', 'repeat_dismissal',
        'message', 'Diagnóstico previo del mismo FM fue rechazado/superseded en últimos 30d'
      )::JSONB AS policy_metadata;
    RETURN;
  END IF;

  -- 3. Evaluar políticas activas ordenadas por evaluation_order
  FOR v_policy IN
    SELECT *
    FROM public.condition_automation_policies
    WHERE is_active = true
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_to IS NULL OR valid_to >= NOW())
    ORDER BY evaluation_order ASC
  LOOP
    v_conditions := v_policy.conditions;

    -- -- min_confidence
    IF (v_conditions->>'min_confidence')::NUMERIC IS NOT NULL
       AND COALESCE(v_diag.confidence, 0) < (v_conditions->>'min_confidence')::NUMERIC
    THEN
      CONTINUE;
    END IF;

    -- max_contradictory_count
    IF (v_conditions->>'max_contradictory_count')::INT IS NOT NULL
       AND (v_diag.evidence_summary->>'contradictory_count')::INT >
           (v_conditions->>'max_contradictory_count')::INT
    THEN
      CONTINUE;
    END IF;

    -- min_completeness
    IF (v_conditions->>'min_completeness')::NUMERIC IS NOT NULL
       AND COALESCE((v_diag.evidence_summary->>'completeness')::NUMERIC, 0) <
           (v_conditions->>'min_completeness')::NUMERIC
    THEN
      CONTINUE;
    END IF;

    -- min_quality_flag: mapea G0→0.9, G1→0.7, G2→0.4, G3→0.0
    -- y compara contra quality_modifier del evidence_summary
    v_min_quality := CASE v_conditions->>'min_quality_flag'
      WHEN 'G0' THEN 0.9
      WHEN 'G1' THEN 0.7
      WHEN 'G2' THEN 0.4
      WHEN 'G3' THEN 0.0
      ELSE NULL
    END;
    IF v_min_quality IS NOT NULL
       AND COALESCE((v_diag.evidence_summary->>'quality_modifier')::NUMERIC, 0) < v_min_quality
    THEN
      CONTINUE;
    END IF;

    -- asset_criticality_allowed: array vacío = aplica a todos
    IF (v_conditions->>'asset_criticality_allowed') IS NOT NULL
       AND jsonb_typeof(v_conditions->'asset_criticality_allowed') = 'array'
       AND jsonb_array_length(v_conditions->'asset_criticality_allowed') > 0
       AND NOT (v_conditions->'asset_criticality_allowed') ? v_fm_severity_default
    THEN
      CONTINUE;
    END IF;

    -- failure_mode_categories: array vacío = aplica a todos
    IF (v_conditions->>'failure_mode_categories') IS NOT NULL
       AND jsonb_typeof(v_conditions->'failure_mode_categories') = 'array'
       AND jsonb_array_length(v_conditions->'failure_mode_categories') > 0
       AND NOT (v_conditions->'failure_mode_categories') ? v_fm_failure_mode_key
    THEN
      CONTINUE;
    END IF;

    -- requires_source_active: ¿el asset tiene al menos una fuente activa?
    IF (v_conditions->>'requires_source_active')::BOOLEAN = true
       AND NOT EXISTS (
         SELECT 1 FROM public.condition_sources
         WHERE asset_id = v_diag.asset_id
           AND status = 'active'
       )
    THEN
      CONTINUE;
    END IF;

    -- Primera política que matchea → retornar
    RETURN QUERY SELECT
      v_policy.policy_key::TEXT,
      COALESCE((v_conditions->>'requires_approval')::BOOLEAN, true) AS requires_confirmation,
      jsonb_build_object(
        'policy_id', v_policy.id,
        'policy_version', v_policy.policy_version,
        'evaluation_order', v_policy.evaluation_order,
        'conditions_applied', v_conditions
      )::JSONB AS policy_metadata;
    RETURN;
  END LOOP;

  -- 4. Fallback: ninguna política matcheó → requiere confirmación humana
  RETURN QUERY SELECT
    'fallback'::TEXT AS policy_key,
    true::BOOLEAN AS requires_confirmation,
    jsonb_build_object('reason', 'no matching policy')::JSONB AS policy_metadata;
END;
$$;

COMMENT ON FUNCTION public.evaluate_automation_policy(UUID)
  IS 'Evalúa políticas HITL configurables para un diagnóstico. Retorna la primera política activa que matchea las condiciones, repeat_dismissal_gate de 30d, o fallback conservador.';


-- ============================================================
-- 2. FUNCIÓN: generate_recommendation_v2
--    v2 de generate_recommendation(). Lee políticas HITL desde
--    condition_automation_policies vía evaluate_automation_policy().
--    Deprecada: generate_recommendation() original queda para
--    compatibilidad (marcada como @deprecated).
--
--    Si la política es 'fallback', la recomendación se crea con
--    requires_confirmation=true y status='review_required'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_recommendation_v2(
  p_diagnosis_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_diag RECORD;
  v_policy RECORD;
  v_action TEXT;
  v_priority TEXT;
  v_due_days INT;
  v_wo_type TEXT;
  v_confirm BOOLEAN;
  v_recommendation_id UUID;
  v_policy_metadata JSONB;
  v_status TEXT;
  v_is_fallback BOOLEAN;
  v_fm_severity_default TEXT;
  v_fm_failure_mode_key TEXT;
  v_fm_typical_effects TEXT;
BEGIN
  -- 1. Leer diagnóstico + failure_mode (todo en un RECORD)
  SELECT d.*, fm.severity_default, fm.failure_mode_key, fm.typical_effects
  INTO v_diag
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Extraer campos del FM
  v_fm_severity_default := v_diag.severity_default;
  v_fm_failure_mode_key := v_diag.failure_mode_key;
  v_fm_typical_effects := v_diag.typical_effects;

  -- 2. Evaluar política
  SELECT p.policy_key, p.requires_confirmation, p.policy_metadata
  INTO v_policy
  FROM public.evaluate_automation_policy(p_diagnosis_id) p;

  v_confirm := v_policy.requires_confirmation;
  v_policy_metadata := v_policy.policy_metadata;
  v_is_fallback := (v_policy.policy_key = 'fallback');

  -- 3. Determinar texto de acción (mismo approach que v1)
  v_action := 'Inspeccionar ' || v_fm_failure_mode_key || ' — '
              || COALESCE(v_fm_typical_effects, 'posible degradación');

  -- 4. Prioridad (severity + confidence)
  v_priority := CASE
    WHEN v_diag.confidence >= 0.85 AND v_fm_severity_default IN ('critical', 'high')
      THEN 'critical'
    WHEN v_diag.confidence >= 0.7 AND v_fm_severity_default IN ('high', 'medium')
      THEN 'high'
    WHEN v_diag.confidence >= 0.5 THEN 'medium'
    ELSE 'low'
  END;

  -- 5. Ventana de ejecución (desde PF-curve o RUL)
  v_due_days := COALESCE(
    (SELECT intervention_window_days FROM public.condition_pf_curves
     WHERE failure_mode_key = v_fm_failure_mode_key LIMIT 1),
    LEAST(CEIL(COALESCE(
      (SELECT result_value FROM public.condition_analysis_results
       WHERE asset_id = v_diag.asset_id
         AND analysis_type = 'rul_estimate'
       ORDER BY window_end DESC LIMIT 1), 30
    )), 90)::INT
  );

  -- 6. Tipo de OT según prioridad
  v_wo_type := CASE
    WHEN v_priority = 'critical' THEN 'CM'
    WHEN v_priority = 'high' THEN 'CBM'
    ELSE 'INSPECTION'
  END;

  -- 7. Status: fallback siempre review_required
  v_status := CASE
    WHEN v_is_fallback THEN 'review_required'
    WHEN v_confirm THEN 'review_required'
    ELSE 'suggested'
  END;

  -- 8. Insertar recomendación
  INSERT INTO public.maintenance_recommendations (
    diagnosis_id, recommended_action, priority,
    due_window_days, work_order_type, requires_confirmation,
    status
  ) VALUES (
    p_diagnosis_id, v_action, v_priority,
    v_due_days, v_wo_type, v_confirm,
    v_status
  ) RETURNING id INTO v_recommendation_id;

  -- 9. Auditar en condition_audit_log
  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id, after_state, reason, changed_by
  ) VALUES (
    'rec_auto_generated',
    'maintenance_recommendations',
    v_recommendation_id::TEXT,
    jsonb_build_object(
      'policy_key', v_policy.policy_key,
      'policy_metadata', v_policy_metadata,
      'diagnosis_id', p_diagnosis_id,
      'status', v_status,
      'priority', v_priority,
      'due_window_days', v_due_days
    ),
    'Recomendación generada vía política: ' || COALESCE(v_policy.policy_key, 'fallback'),
    'system'
  );

  RETURN v_recommendation_id;
END;
$$;

COMMENT ON FUNCTION public.generate_recommendation_v2(UUID)
  IS 'v2 de generate_recommendation(). Lee políticas HITL desde condition_automation_policies vía evaluate_automation_policy(). Fallback conservador si no hay política o es fallback.';


-- ============================================================
-- 3. FUNCIÓN: compute_source_quality_stats
--    Calcula distribución de calidad G0-G3 por fuente de datos,
--    última fecha de dato, y conteo de dead-letter.
--    Usada por el dashboard y SourceManagementPanel.
--    STABLE = read-only, no modifica datos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_source_quality_stats()
RETURNS TABLE(
  source_id TEXT,
  source_name TEXT,
  total_values BIGINT,
  g0_pct NUMERIC,
  g1_pct NUMERIC,
  g2_pct NUMERIC,
  g3_pct NUMERIC,
  last_data_at TIMESTAMPTZ,
  dead_letter_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH quality_counts AS (
    SELECT
      cs.source_id,
      cs.name AS source_name,
      COUNT(cfv.id)::BIGINT AS total_values,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G0')::BIGINT AS g0_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G1')::BIGINT AS g1_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G2')::BIGINT AS g2_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G3')::BIGINT AS g3_count,
      MAX(cw.window_end) AS last_data_at
    FROM public.condition_sources cs
    LEFT JOIN public.condition_source_capabilities csc
      ON cs.source_id = csc.source_id
    LEFT JOIN public.condition_feature_definitions cfd
      ON csc.can_produce = cfd.feature_key
    LEFT JOIN public.condition_feature_values cfv
      ON cfv.feature_definition_id = cfd.id
    LEFT JOIN public.condition_windows cw
      ON cfv.window_id = cw.id AND cw.source_id = cs.source_id
    GROUP BY cs.source_id, cs.name
  ),
  dead_letter_counts AS (
    SELECT
      cid.source_id,
      COUNT(*)::BIGINT AS dl_count
    FROM public.condition_ingest_failures cid
    GROUP BY cid.source_id
  )
  SELECT
    qc.source_id,
    qc.source_name,
    qc.total_values,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g0_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g1_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g2_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g3_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    qc.last_data_at,
    COALESCE(dlc.dl_count, 0)::BIGINT AS dead_letter_count
  FROM quality_counts qc
  LEFT JOIN dead_letter_counts dlc ON qc.source_id = dlc.source_id
  ORDER BY qc.source_name;
END;
$$;

COMMENT ON FUNCTION public.compute_source_quality_stats()
  IS 'Calcula distribución de calidad G0-G3 por fuente, última fecha de dato, y conteo de dead-letter. STABLE — no modifica datos.';


-- ============================================================
-- 4. FUNCIÓN: compute_daily_metrics
--    Agrega métricas diarias por asset a condition_daily_metrics.
--    Idempotente: INSERT ... ON CONFLICT (metric_date, asset_id)
--    DO UPDATE. Acepta cualquier fecha pasada para backfill.
--    Retorna cantidad de assets procesados.
--
--    Métricas computadas:
--      - diagnoses_created, confirmed, rejected
--      - recommendations_created, approved, dismissed,
--        converted_to_wo
--      - cbm_wo_created, cbm_wo_closed
--      - feedback_pending_count
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
      feedback_pending_count
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
         AND diagnosis_status IN ('active', 'confirmed'))
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
      feedback_pending_count = EXCLUDED.feedback_pending_count;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.compute_daily_metrics(DATE)
  IS 'Agrega métricas diarias por asset a condition_daily_metrics. Idempotente: ON CONFLICT DO UPDATE. Acepta cualquier fecha pasada para backfill. Retorna cantidad de assets procesados.';


-- ============================================================
-- 5. FUNCIÓN: convert_recommendation_to_wo
--    Convierte una recomendación aprobada en OT (work_order).
--    Atómica: INSERT work_order + UPDATE recommendation + audit.
--
--    Gates:
--      - La recomendación debe tener status = 'approved'
--      - No debe existir una OT abierta para el mismo diagnóstico
--
--    Retorna el UUID de la work_order creada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.convert_recommendation_to_wo(
  p_recommendation_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_wo_id UUID;
  v_diag RECORD;
  v_audit_before JSONB;
BEGIN
  -- 1. Leer recomendación + diagnóstico (asset_id)
  SELECT mr.*, cd.asset_id
  INTO v_rec
  FROM public.maintenance_recommendations mr
  JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
  WHERE mr.id = p_recommendation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recomendación no encontrada: %', p_recommendation_id;
  END IF;

  -- 2. Gate: solo recomendaciones aprobadas pueden convertirse
  IF v_rec.status != 'approved' THEN
    RAISE EXCEPTION 'No se puede convertir una recomendación con estado % (requiere approved)', v_rec.status;
  END IF;

  -- 3. Gate: no duplicar OT para el mismo diagnóstico
  IF EXISTS (
    SELECT 1 FROM public.maintenance_recommendations mr
    JOIN public.work_orders wo ON mr.work_order_id = wo.id
    WHERE mr.diagnosis_id = v_rec.diagnosis_id
      AND mr.status = 'converted_to_wo'
      AND wo.lifecycle_phase NOT IN ('COMP', 'CLOSED')
      AND mr.id != p_recommendation_id
  ) THEN
    RAISE EXCEPTION 'Ya existe una OT abierta para el mismo diagnóstico (recomendación previa convertida)';
  END IF;

  -- Capturar estado previo para auditoría
  v_audit_before := jsonb_build_object(
    'status', v_rec.status,
    'work_order_id', v_rec.work_order_id
  );

  -- 4. Crear work_order
  INSERT INTO public.work_orders (
    asset_id,
    equipment_id,
    wo_type,
    lifecycle_phase,
    criticality,
    symptom_note,
    action_note,
    created_by
  ) VALUES (
    v_rec.asset_id,
    v_rec.asset_id,  -- equipment_id = asset_id (el asset es el equipo)
    COALESCE(v_rec.work_order_type, 'CBM'),
    'WAPPR',
    v_rec.priority,
    v_rec.recommended_action,
    'Generado desde recomendación de condición: ' || v_rec.id::TEXT,
    NULL  -- created_by NULL (trazabilidad vía audit_log)
  ) RETURNING id INTO v_wo_id;

  -- 5. Actualizar recomendación
  UPDATE public.maintenance_recommendations
  SET status = 'converted_to_wo',
      work_order_id = v_wo_id::TEXT,
      reviewed_by = COALESCE(
        current_setting('request.jwt.claims', true)::json->>'email',
        current_user
      ),
      reviewed_at = NOW()
  WHERE id = p_recommendation_id;

  -- 6. Auditar (triggers aún no existen, PR 1c)
  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id,
    before_state, after_state, reason, changed_by
  ) VALUES (
    'rec_converted_to_wo',
    'maintenance_recommendations',
    p_recommendation_id::TEXT,
    v_audit_before,
    jsonb_build_object(
      'status', 'converted_to_wo',
      'work_order_id', v_wo_id::TEXT
    ),
    'Recomendación convertida a OT: ' || v_wo_id::TEXT,
    COALESCE(
      current_setting('request.jwt.claims', true)::json->>'email',
      current_user
    )
  );

  RETURN v_wo_id;
END;
$$;

COMMENT ON FUNCTION public.convert_recommendation_to_wo(UUID)
  IS 'Convierte una recomendación aprobada en OT. Crea work_order (lifecycle_phase=WAPPR), actualiza recommendation status a converted_to_wo y linkea work_order_id. Previene duplicados de OT para el mismo diagnóstico.';


-- ============================================================
-- 6. FUNCIÓN: expire_stale_recommendations
--    Marca como expired las recomendaciones cuyo due_window_days
--    ya pasó y siguen en estado suggested, review_required
--    o approved.
--    Cada expiración se registra en condition_audit_log.
--    Retorna la cantidad de recomendaciones expiradas.
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_stale_recommendations()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  FOR v_rec IN
    SELECT id, diagnosis_id, status, created_at, due_window_days
    FROM public.maintenance_recommendations
    WHERE status IN ('suggested', 'review_required', 'approved')
      AND due_window_days IS NOT NULL
      AND created_at + (due_window_days || ' days')::INTERVAL < NOW()
    FOR UPDATE
  LOOP
    UPDATE public.maintenance_recommendations
    SET status = 'expired'
    WHERE id = v_rec.id;

    INSERT INTO public.condition_audit_log (
      action, entity_type, entity_id,
      before_state, after_state, reason, changed_by
    ) VALUES (
      'rec_status_changed',
      'maintenance_recommendations',
      v_rec.id::TEXT,
      jsonb_build_object('status', v_rec.status),
      jsonb_build_object('status', 'expired'),
      'Expiración automática: ventana de ' || v_rec.due_window_days || ' días vencida',
      'system'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_recommendations()
  IS 'Marca como expired recomendaciones cuyo due_window_days pasó y siguen en suggested, review_required o approved. Cada expiración se registra en audit_log.';


-- ============================================================
-- 7. FUNCIÓN: log_audit_entry
--    Inserta una entrada manual en condition_audit_log.
--    Para uso de ADMIN en overrides o acciones no cubiertas
--    por triggers automáticos.
--    SECURITY DEFINER para poder insertar sin policy directa.
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit_entry(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_before_state JSONB DEFAULT '{}',
  p_after_state JSONB DEFAULT '{}',
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_id UUID;
BEGIN
  -- Obtener usuario actual (current_user = sesión de BD)
  v_changed_by := current_user;

  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id,
    before_state, after_state, reason, changed_by
  ) VALUES (
    p_action, p_entity_type, p_entity_id,
    CASE WHEN p_before_state = '{}'::JSONB THEN NULL ELSE p_before_state END,
    CASE WHEN p_after_state = '{}'::JSONB THEN NULL ELSE p_after_state END,
    p_reason, v_changed_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_audit_entry(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT)
  IS 'Inserta entrada manual en audit log con current_user como changed_by. SECURITY DEFINER — permite insert sin policy directa.';


-- ============================================================
-- DEPRECACIÓN: generate_recommendation() original
--   Marcamos la función original como @deprecated.
--   La función original sigue funcionando para compatibilidad
--   pero nuevas llamadas deben usar generate_recommendation_v2().
-- ============================================================
COMMENT ON FUNCTION public.generate_recommendation(UUID)
  IS '@deprecated Usar generate_recommendation_v2() en su lugar. Esta función se mantiene para compatibilidad con código existente.';


-- ============================================================
-- FIN MIGRATION: sdd5_governance_functions
-- ============================================================
