-- ============================================================
-- MIGRATION: sdd6_drl_change_functions — Funciones de DRL y
--   Control de Cambios (SDD 6, PR 1b)
-- Change: condition-monitoring-performance-improvement (PR 1b)
-- ============================================================
-- Implementa:
--   1. assess_data_readiness() — evalúa DRL 0-6 por asset
--      con desglose de evidencia (no un número mágico)
--   2. compare_change_proposal() — diff JSONB entre
--      before_state y after_state
--   3. rollback_change() — crea nueva propuesta que revierte
--      un cambio activo, preservando el historial
--   4. condition_data_readiness VIEW — bulk query de DRL
--      sobre todos los assets
--
-- Idempotente: CREATE OR REPLACE FUNCTION, DROP VIEW IF
--   EXISTS + CREATE OR REPLACE VIEW.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN: assess_data_readiness
--    Evalúa Data Readiness Level (0-6) para uno o todos los
--    assets con desglose completo de evidencia.
--
--    Niveles:
--      0 = sin datos (sin ventanas)
--      1 = datos sintéticos/mock solamente
--      2 = datos reales (alguna fuente no-mock)
--      3 = baseline estable + calidad > 50% G0/G1
--      4 = eventos presentes + feedback técnico presente
--      5 = fallas/outcomes confirmados
--      6 = estadísticamente significativo (>100 muestras,
--          >365 días de histórico, ratio G0/G1 > 0.8)
--
--    Cuando p_asset_id IS NULL, evalúa TODOS los assets
--    (útil para la view condition_data_readiness).
-- ============================================================
CREATE OR REPLACE FUNCTION public.assess_data_readiness(
  p_asset_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  asset_id TEXT,
  drl_level INT,
  sample_count INT,
  time_span_days INT,
  g0g1_ratio NUMERIC,
  has_baseline BOOLEAN,
  has_events BOOLEAN,
  has_feedback BOOLEAN,
  has_confirmed_outcomes BOOLEAN,
  missing_features TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_total_windows INT;
  v_real_windows INT;
  v_sample_count INT;
  v_time_span_days INT;
  v_g0g1_ratio NUMERIC;
  v_has_baseline BOOLEAN;
  v_has_events BOOLEAN;
  v_has_feedback BOOLEAN;
  v_has_confirmed BOOLEAN;
  v_drl INT;
BEGIN
  FOR v_asset IN
    SELECT DISTINCT w.asset_id
    FROM public.condition_windows w
    WHERE p_asset_id IS NULL OR w.asset_id = p_asset_id
  LOOP
    -- 1. Contar ventanas totales y reales (no mock/synthetic)
    SELECT
      COUNT(*)::INT,
      COUNT(*) FILTER (WHERE w.source_type IS DISTINCT FROM 'mock')::INT
    INTO v_total_windows, v_real_windows
    FROM public.condition_windows w
    WHERE w.asset_id = v_asset.asset_id;

    -- DRL 0: sin datos
    IF v_total_windows = 0 THEN
      asset_id := v_asset.asset_id;
      drl_level := 0;
      sample_count := 0;
      time_span_days := 0;
      g0g1_ratio := 0;
      has_baseline := FALSE;
      has_events := FALSE;
      has_feedback := FALSE;
      has_confirmed_outcomes := FALSE;
      missing_features := '{}'::TEXT[];
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2. Calcular métricas de calidad
    SELECT
      COUNT(*)::INT,
      ROUND(
        COUNT(*) FILTER (WHERE cfv.quality_flag IN ('G0', 'G1'))::NUMERIC
        / NULLIF(COUNT(*), 0) * 100, 1
      )
    INTO v_sample_count, v_g0g1_ratio
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows w ON cfv.window_id = w.id
    WHERE w.asset_id = v_asset.asset_id;

    -- 3. Time span en días
    SELECT COALESCE(
      EXTRACT(DAY FROM MAX(w.window_end) - MIN(w.window_start))::INT, 0
    ) INTO v_time_span_days
    FROM public.condition_windows w
    WHERE w.asset_id = v_asset.asset_id;

    -- 4. Baseline activo existe?
    SELECT EXISTS (
      SELECT 1 FROM public.condition_baselines b
      WHERE b.asset_id = v_asset.asset_id
        AND b.baseline_status = 'active'
      LIMIT 1
    ) INTO v_has_baseline;

    -- 5. Eventos existen?
    SELECT EXISTS (
      SELECT 1 FROM public.condition_events e
      WHERE e.asset_id = v_asset.asset_id
      LIMIT 1
    ) INTO v_has_events;

    -- 6. Feedback técnico existe?
    SELECT EXISTS (
      SELECT 1 FROM public.condition_diagnosis_feedback df
      JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
      WHERE d.asset_id = v_asset.asset_id
      LIMIT 1
    ) INTO v_has_feedback;

    -- 7. Outcomes/fallas confirmadas?
    SELECT EXISTS (
      SELECT 1 FROM public.condition_diagnosis_feedback df
      JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
      WHERE d.asset_id = v_asset.asset_id
        AND df.feedback_status = 'confirmed'
      LIMIT 1
    ) INTO v_has_confirmed;

    -- 8. Determinar DRL progresivo
    IF v_real_windows = 0 THEN
      v_drl := 1; -- solo mock/synthetic
    ELSE
      v_drl := 2; -- datos reales como mínimo
    END IF;

    IF v_has_baseline AND v_g0g1_ratio > 50 THEN
      v_drl := 3; -- baseline estable + calidad aceptable
    END IF;

    IF v_has_events AND v_has_feedback THEN
      v_drl := 4; -- eventos + feedback
    END IF;

    IF v_has_confirmed THEN
      v_drl := 5; -- fallas confirmadas
    END IF;

    IF v_has_confirmed
       AND v_sample_count > 100
       AND v_time_span_days > 365
       AND v_g0g1_ratio > 80 THEN
      v_drl := 6; -- estadísticamente significativo
    END IF;

    -- Retornar fila con desglose completo
    asset_id := v_asset.asset_id;
    drl_level := v_drl;
    sample_count := COALESCE(v_sample_count, 0);
    time_span_days := v_time_span_days;
    g0g1_ratio := COALESCE(v_g0g1_ratio, 0);
    has_baseline := COALESCE(v_has_baseline, FALSE);
    has_events := COALESCE(v_has_events, FALSE);
    has_feedback := COALESCE(v_has_feedback, FALSE);
    has_confirmed_outcomes := COALESCE(v_has_confirmed, FALSE);
    missing_features := '{}'::TEXT[];
    RETURN NEXT;
  END LOOP;

  -- Si p_asset_id no nulo pero no encontrado en condition_windows
  IF p_asset_id IS NOT NULL AND NOT FOUND THEN
    asset_id := p_asset_id;
    drl_level := 0;
    sample_count := 0;
    time_span_days := 0;
    g0g1_ratio := 0;
    has_baseline := FALSE;
    has_events := FALSE;
    has_feedback := FALSE;
    has_confirmed_outcomes := FALSE;
    missing_features := '{}'::TEXT[];
    RETURN NEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assess_data_readiness(TEXT)
  IS 'Evalúa el Data Readiness Level (0-6) para uno o todos los assets. Retorna desglose completo de evidencia: sample_count, time_span_days, g0g1_ratio, baselines, eventos, feedback, outcomes. DRL progresivo: 0=sin datos, 1=mock, 2=real, 3=baseline, 4=eventos+feedback, 5=fallas, 6=suficiente.';

-- ============================================================
-- 2. FUNCIÓN: compare_change_proposal
--    Retorna diff estructurado entre before_state y after_state
--    de una propuesta de cambio.
--    Incluye keys agregadas, eliminadas y modificadas con
--    conteos totales.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compare_change_proposal(
  p_proposal_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_before_keys TEXT[];
  v_after_keys TEXT[];
  v_changed_keys TEXT[];
  v_result JSONB;
BEGIN
  SELECT * INTO v_proposal
  FROM public.condition_change_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Si alguno de los estados es NULL, retornar error
  IF v_proposal.before_state IS NULL OR v_proposal.after_state IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'no state to compare',
      'proposal_key', v_proposal.proposal_key,
      'entity_type', v_proposal.entity_type,
      'entity_id', v_proposal.entity_id
    );
  END IF;

  -- Extraer keys de ambos estados
  SELECT array_agg(key) INTO v_before_keys
  FROM jsonb_object_keys(v_proposal.before_state) AS key;

  SELECT array_agg(key) INTO v_after_keys
  FROM jsonb_object_keys(v_proposal.after_state) AS key;

  -- Encontrar keys que cambiaron
  WITH all_keys AS (
    SELECT UNNEST(v_before_keys) AS key
    UNION
    SELECT UNNEST(v_after_keys) AS key
  )
  SELECT array_agg(k.key ORDER BY k.key) INTO v_changed_keys
  FROM all_keys k
  WHERE (
    (v_proposal.before_state->>k.key IS DISTINCT FROM v_proposal.after_state->>k.key)
  );

  v_result := jsonb_build_object(
    'proposal_key', v_proposal.proposal_key,
    'entity_type', v_proposal.entity_type,
    'entity_id', v_proposal.entity_id,
    'change_type', v_proposal.change_type,
    'before', v_proposal.before_state,
    'after', v_proposal.after_state,
    'changed_keys', COALESCE(v_changed_keys, '{}'::TEXT[]),
    'total_before_fields', COALESCE(array_length(v_before_keys, 1), 0),
    'total_after_fields', COALESCE(array_length(v_after_keys, 1), 0),
    'total_changed_fields', COALESCE(array_length(v_changed_keys, 1), 0),
    'summary', COALESCE(array_length(v_changed_keys, 1), 0) || ' field(s) changed'
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.compare_change_proposal(UUID)
  IS 'Retorna diff estructurado entre before_state y after_state de una propuesta de cambio. Incluye keys agregadas, eliminadas y modificadas con conteos. Si before o after es NULL, retorna {error: "no state to compare"}.';

-- ============================================================
-- 3. FUNCIÓN: rollback_change
--    Revierte un cambio activo creando una NUEVA propuesta
--    que documenta el rollback. NO reescribe el historial.
--
--    Flujo:
--      1. Lee propuesta activa
--      2. Captura estado actual de la entidad
--      3. Re-aplica before_state a la entidad vía SQL dinámico
--      4. Crea nueva propuesta registrando el rollback
--      5. Marca propuesta original como rolled_back
--      6. Audita en condition_audit_log
--      7. Retorna UUID de la nueva propuesta
--
--    Seguridad: solo columns seguras (sin id, created_at,
--    updated_at) se restauran desde el JSONB.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rollback_change(
  p_proposal_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_new_proposal_id UUID;
  v_current_state JSONB;
  v_entity_table TEXT;
  v_set_clause TEXT;
  v_sql TEXT;
  v_col_name TEXT;
  v_col_value TEXT;
  v_changed_by TEXT;
BEGIN
  -- 1. Leer propuesta activa
  SELECT * INTO v_proposal
  FROM public.condition_change_proposals
  WHERE id = p_proposal_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot rollback: proposal % not found or not active', p_proposal_id;
  END IF;

  IF v_proposal.before_state IS NULL THEN
    RAISE EXCEPTION 'Cannot rollback: proposal % has no before_state', v_proposal.proposal_key;
  END IF;

  -- 2. Capturar quién ejecuta el rollback
  v_changed_by := COALESCE(
    current_setting('request.jwt.claims', true)::json->>'email',
    current_setting('request.jwt.claims', true)::json->>'sub',
    'system'
  );

  -- 3. Mapear entity_type a tabla
  v_entity_table := CASE v_proposal.entity_type
    WHEN 'threshold' THEN 'public.condition_threshold_catalog'
    WHEN 'rule' THEN 'public.condition_rules'
    WHEN 'diagnostic_pattern' THEN 'public.condition_diagnostic_patterns'
    WHEN 'baseline' THEN 'public.condition_baselines'
    WHEN 'hitl_policy' THEN 'public.condition_automation_policies'
    WHEN 'rul_method' THEN 'public.condition_analysis_methods'
    WHEN 'degradation_model' THEN 'public.condition_degradation_models'
    WHEN 'source_capability' THEN 'public.condition_source_capabilities'
    WHEN 'analysis_method' THEN 'public.condition_analysis_methods'
    WHEN 'failure_mode' THEN 'public.condition_failure_mode_catalog'
    ELSE NULL
  END;

  IF v_entity_table IS NULL THEN
    RAISE EXCEPTION 'Cannot rollback: unknown entity_type % for rollback mapping', v_proposal.entity_type;
  END IF;

  -- 4. Verificar que la tabla existe (seguridad)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = v_entity_table
  ) THEN
    RAISE EXCEPTION 'Cannot rollback: table % does not exist', v_entity_table;
  END IF;

  -- 5. Capturar estado actual de la entidad como JSONB
  --    (para registrar en la nueva propuesta de rollback)
  --    Usamos %L sin cast explícito — Postgres hace coerción
  --    implícita entre UUID y TEXT según la columna.
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE t.id = %L',
    v_entity_table, v_proposal.entity_id
  ) INTO v_current_state;

  IF v_current_state IS NULL THEN
    RAISE EXCEPTION 'Cannot rollback: entity % with id % not found in %',
      v_proposal.entity_type, v_proposal.entity_id, v_entity_table;
  END IF;

  -- 6. Re-aplicar before_state a la entidad vía SQL dinámico
  --    Solo restauramos columnas seguras (sin PK, FKs sistémicas ni timestamps automáticos)
  SELECT string_agg(
    format('%I = %L', key, v_proposal.before_state->>key),
    ', '
  ) INTO v_set_clause
  FROM jsonb_object_keys(v_proposal.before_state) AS key
  WHERE key NOT IN (
    'id', 'created_at', 'updated_at', 'changed_at'
  );

  IF v_set_clause IS NULL THEN
    RAISE EXCEPTION 'Cannot rollback: no updatable fields in before_state for proposal %',
      v_proposal.proposal_key;
  END IF;

  -- UPDATE sin cast explícito — Postgres hace coerción implícita UUID <-> TEXT
  v_sql := format(
    'UPDATE %I SET %s WHERE id = %L',
    v_entity_table, v_set_clause, v_proposal.entity_id
  );
  EXECUTE v_sql;

  -- 7. Crear NUEVA propuesta registrando el rollback
  INSERT INTO public.condition_change_proposals (
    proposal_key,
    title,
    description,
    entity_type,
    entity_id,
    change_type,
    before_state,
    after_state,
    justification,
    proposed_by,
    status
  ) VALUES (
    v_proposal.proposal_key || '_rollback_' || to_char(NOW(), 'YYYYMMDD_HH24MISS'),
    'Rollback: ' || v_proposal.title,
    'Rollback automático de la propuesta ' || v_proposal.proposal_key
      || '. Restaura el estado anterior a ' || v_proposal.change_type || '.',
    v_proposal.entity_type,
    v_proposal.entity_id,
    'update',
    v_current_state,
    v_proposal.before_state,
    'Rollback ejecutado: se restaura el estado previo al cambio ' || v_proposal.proposal_key,
    v_changed_by,
    'active'
  )
  RETURNING id INTO v_new_proposal_id;

  -- 8. Marcar propuesta original como rolled_back
  UPDATE public.condition_change_proposals
  SET status = 'rolled_back'
  WHERE id = p_proposal_id;

  -- 9. Auditar en condition_audit_log
  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id,
    before_state, after_state, reason, changed_by
  ) VALUES (
    'change_rolled_back',
    'condition_change_proposals',
    p_proposal_id::TEXT,
    jsonb_build_object(
      'status', 'active',
      'entity_type', v_proposal.entity_type,
      'entity_id', v_proposal.entity_id
    ),
    jsonb_build_object(
      'new_proposal_id', v_new_proposal_id,
      'new_status', 'active',
      'restored_from', v_proposal.proposal_key
    ),
    'Rollback de ' || v_proposal.proposal_key || ': se creó propuesta ' || v_new_proposal_id || ' con el estado anterior',
    v_changed_by
  );

  -- 10. Retornar ID de la nueva propuesta
  RETURN v_new_proposal_id;
END;
$$;

COMMENT ON FUNCTION public.rollback_change(UUID)
  IS 'Revierte un cambio activo creando una NUEVA propuesta que documenta el rollback. NO reescribe historial. Restaura before_state en la entidad, marca la original como rolled_back, y audita en condition_audit_log. Retorna UUID de la nueva propuesta.';

-- ============================================================
-- 4. VIEW: condition_data_readiness
--    Expande assess_data_readiness() como view para consultas
--    bulk sobre todos los assets con datos de condición.
-- ============================================================
DROP VIEW IF EXISTS public.condition_data_readiness;

CREATE OR REPLACE VIEW public.condition_data_readiness
AS
SELECT * FROM public.assess_data_readiness();

COMMENT ON VIEW public.condition_data_readiness
  IS 'Data Readiness Level (0-6) por asset. Desglose completo de evidencia: sample_count, time_span_days, g0g1_ratio, baselines, eventos, feedback, outcomes. DRL progresivo: 0=sin datos, 1=mock, 2=real, 3=baseline, 4=eventos+feedback, 5=fallas, 6=suficiente.';

-- ============================================================
-- FIN MIGRATION: sdd6_drl_change_functions
-- ============================================================
