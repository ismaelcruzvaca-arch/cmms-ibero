-- ============================================================
-- MIGRATION: sdd4_patch_prearchive — Correcciones pre-archive
--   para SDD 4 condition-monitoring-diagnostics-prognostics
-- Change: condition-monitoring-diagnostics-prognostics
-- Blocker fixes:
--   1. generate_recommendation() — gate reforzado con
--      condiciones de seguridad evidence_summary
--   2. evaluate_condition_rules() — evidencia persistente
--      con breakdown completo desde compute_diagnosis_confidence()
-- ============================================================
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- PATCH 1: generate_recommendation()
--   - Agrega d.evidence_summary al SELECT
--   - Gate reforzado: verifica contradictory_count,
--     completeness y quality_modifier antes de auto-confirmar
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
  -- 1. Leer diagnóstico + failure_mode + confianza + evidence_summary
  SELECT d.asset_id, d.diagnosis_status, d.confidence, d.evidence_summary,
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

  -- 4. Determinar requires_confirmation según ciclo de vida + condiciones de seguridad
  IF v_diag.diagnosis_status = 'field_trial' THEN
      -- field_trial siempre requiere confirmación
      v_confirm := true;
  ELSIF v_diag.diagnosis_status = 'active'
        AND v_diag.confidence >= 0.7 THEN
      -- Verificar condiciones de seguridad para automatización
      -- Principio: en ausencia de evidencia suficiente, no automatizar
      IF (v_diag.evidence_summary->>'contradictory_count')::INT > 0 THEN
          v_confirm := true;  -- evidencia contradictoria → revisión humana
      ELSIF (v_diag.evidence_summary->>'completeness')::NUMERIC < 0.5 THEN
          v_confirm := true;  -- poca cobertura de evidencia → revisión humana
      ELSIF (v_diag.evidence_summary->>'quality_modifier')::NUMERIC < 0.5 THEN
          v_confirm := true;  -- calidad de datos baja → revisión humana
      ELSE
          v_confirm := false;  -- todas las condiciones OK → puede auto-confirmar
      END IF;
  ELSE
      v_confirm := true;  -- candidate o baja confianza → revisión
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
  IS 'PATCH pre-archive: Genera recomendación de mantenimiento desde diagnóstico + confianza + PF-curva + RUL. Gate reforzado con contradictory_count, completeness, quality_modifier.';

-- ============================================================
-- PATCH 2: evaluate_condition_rules() — Bloque 'diagnostic'
--   - Agrega v_diag_breakdown JSONB en DECLARE anidado
--   - SELECT ahora captura c.breakdown desde
--     compute_diagnosis_confidence()
--   - evidence_summary fusiona rule metadata + breakdown
--     completo (evidence_present, evidence_total, required_met,
--     required_total, contradictory_count, contradictory_total,
--     quality_modifier, completeness, final_confidence)
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
    -- PATCH: v_diag_breakdown + breakdown completo en evidence_summary
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
        v_diag_breakdown JSONB;
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
          -- Compute diagnosis confidence + breakdown completo
          SELECT c.confidence, c.breakdown INTO v_diag_conf, v_diag_breakdown
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
            -- evidence_summary: rule metadata + breakdown completo
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
              ) || COALESCE(v_diag_breakdown, '{}'::JSONB)
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
  IS 'PATCH pre-archive: Evalúa reglas activas/field_trial para un activo. Diagnostic bloque ahora persiste breakdown completo de compute_diagnosis_confidence() en evidence_summary.';

-- ============================================================
-- FIN MIGRATION: sdd4_patch_prearchive
-- ============================================================
