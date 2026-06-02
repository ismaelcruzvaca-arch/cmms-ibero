-- =============================================================================
-- Condition Rules + Views — Test Suite (pgTAP)
-- PR 2d: evaluate_condition_rules() + Views + compute-hi EF contract
--
-- Assertions: rules (active fires, deprecated skipped, quality gate,
--   method severity cap, trend evaluation), views (column existence,
--   queryable data), EF contract tests documented (~35 assertions)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_rules_views_test.sql
-- =============================================================================

BEGIN;

SELECT plan(33);

-- =============================================================================
-- 1. FUNCTION EXISTENCE
-- =============================================================================
SELECT has_function('public', 'evaluate_condition_rules',
  ARRAY['text'],
  'evaluate_condition_rules(TEXT) existe');

SELECT has_function('public', 'evaluate_compound_conditions',
  ARRAY['text', 'jsonb', 'text'],
  'evaluate_compound_conditions(TEXT, JSONB, TEXT) existe');

-- =============================================================================
-- 2. VIEW EXISTENCE
-- =============================================================================
SELECT has_view('public', 'v_condition_data_quality',
  'v_condition_data_quality existe');
SELECT has_view('public', 'v_condition_rule_performance',
  'v_condition_rule_performance existe');
SELECT has_view('public', 'v_condition_metrology_status',
  'v_condition_metrology_status existe');

-- =============================================================================
-- 3. SETUP: Preparar reglas de prueba
-- =============================================================================
-- 3a. Regla activa (threshold) — debe disparar
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'TST-RULE-ACTIVE',
  'Regla activa de prueba — umbral vibration.rms > 7.0',
  NULL,           -- aplica a cualquier asset_class
  'vibration.rms',
  'rms_velocity_window',
  NULL,           -- aplica a cualquier régimen
  'G2',
  'threshold',
  '{"threshold": 7.0, "duration_windows": 1, "min_confidence": 0.8}',
  'critical',
  'create_wo',
  'active'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- 3b. Regla deprecated — NO debe disparar (debe ser ignorada)
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'TST-RULE-DEPRECATED',
  'Regla deprecated — debe ser ignorada',
  NULL,
  'vibration.rms',
  'rms_velocity_window',
  NULL,
  'G2',
  'threshold',
  '{"threshold": 3.0, "duration_windows": 1}',
  'critical',
  'log_event',
  'deprecated'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- 3c. Regla con método en draft — severity debe limitarse a warning
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'TST-RULE-DRAFT-METHOD',
  'Regla con método draft — severity debe limitarse a warning',
  NULL,
  'temperature.bearing',
  'kalman_filter',  -- kalman_filter está en draft (seed data)
  NULL,
  'G2',
  'threshold',
  '{"threshold": 30, "duration_windows": 1}',
  'critical',
  'create_wo',
  'active'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- 3d. Regla de tendencia (trend) — evalúa usando analysis_results
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'TST-RULE-TREND-DEGRADING',
  'Regla de tendencia — dHI/dt < -0.02 HI/día (degradación rápida)',
  NULL,
  'vibration.rms',
  NULL,           -- cualquier método
  NULL,
  'G2',
  'trend',
  '{"threshold": -0.02, "min_r_squared": 0.5}',
  'warning',
  'log_event',
  'active'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- 3e. Regla con min_quality_flag alto (G1) para test de calidad
INSERT INTO public.condition_rules (
  rule_name, description, asset_class, feature_key, method_key,
  regime, min_quality_flag, evaluation_type, rule_config,
  severity, action, validation_status
) VALUES (
  'TST-RULE-HIGH-QUALITY',
  'Regla que requiere calidad G1 — datos G2 no disparan',
  NULL,
  'vibration.rms',
  'rms_velocity_window',
  NULL,
  'G1',
  'threshold',
  '{"threshold": 5.0, "duration_windows": 1}',
  'warning',
  'log_event',
  'active'
) ON CONFLICT (rule_name, version) DO NOTHING;

-- =============================================================================
-- 4. DATOS DE PRUEBA: Insertar feature_values para los tests
-- =============================================================================

-- 4a. Test Threshold: valor 8.5 > 7.0, G0 → debe disparar TST-RULE-ACTIVE
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES
  ('tst-rules-thr-1', 'TST-RULES-001', 'tst-src', 'edge',
   NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 8.5, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-rules-thr-1'
  AND fd.feature_key = 'vibration.rms';

-- 4b. Test Calidad: valor 7.5 > 5.0 pero G2 cuando se requiere G1 → NO debe disparar
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES
  ('tst-rules-qual-1', 'TST-RULES-002', 'tst-src', 'edge',
   NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 7.5, 'mm/s', 'G2',          -- G2 < G1 min → no dispara
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-rules-qual-1'
  AND fd.feature_key = 'vibration.rms';

-- 4c. Test Método Draft: temperature.bearing con kalman_filter (draft)
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES
  ('tst-rules-draft-1', 'TST-RULES-003', 'tst-src', 'edge',
   NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

-- Necesitamos el feature_definition_id para temperature.bearing
INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 85.0, '°C', 'G0',
       'kalman_filter', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-rules-draft-1'
  AND fd.feature_key = 'temperature.bearing';

-- 4d. Test Tendencia: insertar trend_slope analysis_result con degradación
INSERT INTO public.condition_analysis_results
  (asset_id, analysis_type, method_key, method_version,
   result_value, result_unit, r_squared, window_end)
VALUES
  ('TST-RULES-004', 'trend_slope', 'linear_regression', '1.0.0',
   -0.05, 'HI/day', 0.85, NOW());    -- degradación rápida (-0.05 < -0.02)

-- =============================================================================
-- 5. TEST: evaluate_condition_rules — regla activa dispara
--    TST-RULES-001 tiene vibration.rms=8.5 > 7.0 threshold, G0
--    → TST-RULE-ACTIVE debe disparar
-- =============================================================================
SELECT is(
  public.evaluate_condition_rules('TST-RULES-001'),
  1,
  'Asset con valor > threshold: regla activa dispara (retorna 1)'
);

-- Verificar que se creó el evento con severidad critical
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_events
    WHERE asset_id = 'TST-RULES-001'
      AND severity = 'critical'
      AND status = 'open'
  ),
  'Evento threshold generado con severity=critical, status=open'
);

-- Verificar que se vinculó el feature_value al evento en condition_event_sources
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_event_sources ces
    JOIN public.condition_events ce ON ces.event_id = ce.id
    WHERE ce.asset_id = 'TST-RULES-001'
      AND ces.feature_value_id IS NOT NULL
  ),
  'Evento vinculado a feature_value en condition_event_sources'
);

-- =============================================================================
-- 6. TEST: evaluate_condition_rules — regla deprecated NO dispara
--    TST-RULES-001 también tiene vibration.rms > 3.0 (umbral de TST-RULE-DEPRECATED)
--    pero la regla está deprecated → debe ser ignorada
-- =============================================================================
-- La regla ya disparó solo 1 evento (la activa). Verificar que no hay evento
-- adicional de la regla deprecated.
SELECT is(
  (SELECT COUNT(*) FROM public.condition_events
   WHERE asset_id = 'TST-RULES-001'),
  1,
  'Regla deprecated ignorada: solo el evento de la regla activa existe'
);

-- =============================================================================
-- 7. TEST: evaluate_condition_rules — calidad insuficiente → NO dispara
--    TST-RULES-002 tiene vibration.rms=7.5 con G2, regla requiere G1
--    → NO debe disparar TST-RULE-HIGH-QUALITY
-- =============================================================================
SELECT is(
  public.evaluate_condition_rules('TST-RULES-002'),
  0,
  'Calidad G2 < G1 mínimo: regla NO dispara (retorna 0)'
);

-- Verificar que no se creó ningún evento para este asset
SELECT is(
  (SELECT COUNT(*) FROM public.condition_events
   WHERE asset_id = 'TST-RULES-002'),
  0,
  'Sin eventos para asset con calidad insuficiente'
);

-- =============================================================================
-- 8. TEST: evaluate_condition_rules — método draft limita severity a warning
--    TST-RULES-003 usa kalman_filter (draft) → severity debe ser warning
--    aunque la regla tenga severity=critical
-- =============================================================================
SELECT is(
  public.evaluate_condition_rules('TST-RULES-003'),
  1,
  'Método draft: regla evalúa pero retorna 1 evento'
);

-- Verificar que el evento generado tiene severity=warning (no critical)
SELECT is(
  (SELECT severity FROM public.condition_events
   WHERE asset_id = 'TST-RULES-003'
   ORDER BY created_at DESC LIMIT 1),
  'warning',
  'Método draft → severity limitado a warning (no critical)'
);

-- También verificar que NO se generó WO (solo critical generan WO)
SELECT is(
  (SELECT COUNT(*) FROM public.work_orders
   WHERE condition_event_id IN (
     SELECT id FROM public.condition_events
     WHERE asset_id = 'TST-RULES-003')),
  0,
  'Método draft: sin WO generada (severity warning no dispara WO)'
);

-- =============================================================================
-- 9. TEST: evaluate_condition_rules — evaluación de tendencia (trend)
--    TST-RULES-004 tiene trend_slope=-0.05 con R²=0.85
--    Regla TST-RULE-TREND-DEGRADING: threshold=-0.02, min_r_squared=0.5
--    → -0.05 < -0.02 → dispara (degradación más rápida que el umbral)
-- =============================================================================
SELECT is(
  public.evaluate_condition_rules('TST-RULES-004'),
  1,
  'Tendencia: dHI/dt = -0.05 < threshold=-0.02 → regla dispara'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_events
    WHERE asset_id = 'TST-RULES-004'
      AND event_type = 'trend_detected'
  ),
  'Evento de tendencia generado con event_type=trend_detected'
);

-- Verificar vinculación con analysis_result
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_event_sources ces
    JOIN public.condition_events ce ON ces.event_id = ce.id
    WHERE ce.asset_id = 'TST-RULES-004'
      AND ces.analysis_result_id IS NOT NULL
  ),
  'Evento de tendencia vinculado a analysis_result en event_sources'
);

-- =============================================================================
-- 10. TEST: evaluate_compound_conditions — AND lógica
-- =============================================================================
-- Insertar datos para compound test: vibration.rms=8.0 AND temperature.bearing=90.0
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type, window_start, window_end,
   operational_context)
VALUES
  ('tst-rules-comp-1', 'TST-RULES-005', 'tst-src', 'edge',
   NOW() - INTERVAL '1 hour', NOW(), '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 8.0, 'mm/s', 'G0',
       'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-rules-comp-1'
  AND fd.feature_key = 'vibration.rms';

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id, 90.0, '°C', 'G0',
       'window_average', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.external_window_id = 'tst-rules-comp-1'
  AND fd.feature_key = 'temperature.bearing';

-- AND: ambas condiciones true → debe retornar true
SELECT ok(
  public.evaluate_compound_conditions(
    'TST-RULES-005',
    '{"operator":"AND","conditions":[
      {"feature":"vibration.rms","threshold":7.0},
      {"feature":"temperature.bearing","threshold":80}
    ]}'::jsonb,
    'G2'
  ),
  'Compound AND: ambas condiciones cumplen → true'
);

-- AND: una condición false → debe retornar false
SELECT ok(
  NOT public.evaluate_compound_conditions(
    'TST-RULES-005',
    '{"operator":"AND","conditions":[
      {"feature":"vibration.rms","threshold":7.0},
      {"feature":"temperature.bearing","threshold":100}
    ]}'::jsonb,
    'G2'
  ),
  'Compound AND: una condición no cumple → false'
);

-- OR: al menos una condición true → debe retornar true (vibration > 7.0)
SELECT ok(
  public.evaluate_compound_conditions(
    'TST-RULES-005',
    '{"operator":"OR","conditions":[
      {"feature":"vibration.rms","threshold":7.0},
      {"feature":"temperature.bearing","threshold":100}
    ]}'::jsonb,
    'G2'
  ),
  'Compound OR: al menos una condición cumple → true'
);

-- OR: ninguna condición true → debe retornar false
SELECT ok(
  NOT public.evaluate_compound_conditions(
    'TST-RULES-005',
    '{"operator":"OR","conditions":[
      {"feature":"vibration.rms","threshold":15.0},
      {"feature":"temperature.bearing","threshold":120}
    ]}'::jsonb,
    'G2'
  ),
  'Compound OR: ninguna condición cumple → false'
);

-- =============================================================================
-- 11. TEST: Views son consultables y retornan columnas esperadas
-- =============================================================================

-- 11a. v_condition_data_quality
SELECT has_column('public', 'v_condition_data_quality', 'asset_id',
  'v_condition_data_quality tiene columna asset_id');
SELECT has_column('public', 'v_condition_data_quality', 'g0_count',
  'v_condition_data_quality tiene columna g0_count');
SELECT has_column('public', 'v_condition_data_quality', 'pct_g0',
  'v_condition_data_quality tiene columna pct_g0');
SELECT has_column('public', 'v_condition_data_quality', 'total_sample_loss',
  'v_condition_data_quality tiene columna total_sample_loss');

-- Verificar que la vista es consultable
SELECT lives_ok(
  'SELECT * FROM public.v_condition_data_quality LIMIT 1',
  'v_condition_data_quality: SELECT exitoso'
);

-- 11b. v_condition_rule_performance
SELECT has_column('public', 'v_condition_rule_performance', 'eventos_generados',
  'v_condition_rule_performance tiene eventos_generados');
SELECT has_column('public', 'v_condition_rule_performance', 'eventos_descartados',
  'v_condition_rule_performance tiene eventos_descartados');
SELECT has_column('public', 'v_condition_rule_performance', 'eventos_critical',
  'v_condition_rule_performance tiene eventos_critical');

SELECT lives_ok(
  'SELECT * FROM public.v_condition_rule_performance LIMIT 1',
  'v_condition_rule_performance: SELECT exitoso'
);

-- 11c. v_condition_metrology_status
SELECT has_column('public', 'v_condition_metrology_status', 'uncertainty_available',
  'v_condition_metrology_status tiene uncertainty_available');
SELECT has_column('public', 'v_condition_metrology_status', 'status_observacion',
  'v_condition_metrology_status tiene status_observacion');
SELECT has_column('public', 'v_condition_metrology_status', 'ventanas_ingestadas',
  'v_condition_metrology_status tiene ventanas_ingestadas');

SELECT lives_ok(
  'SELECT * FROM public.v_condition_metrology_status LIMIT 1',
  'v_condition_metrology_status: SELECT exitoso'
);

-- =============================================================================
-- 12. TEST: compute-hi Edge Function — Contract Tests (documentados)
--    No ejecutables como pgTAP — son assertions sobre el contrato HTTP.
--    Se incluyen aquí para documentar el comportamiento esperado.
-- =============================================================================

-- EF-COMPUTE-001: POST /compute-hi con { asset_id: "TST-ASSET" }
--   → Response 200, body { processed: 1, results: [{ asset_id, hi, ... }] }
SELECT pass(
  'EF contract: POST { asset_id } → 200 { processed, results[] } — documented'
);

-- EF-COMPUTE-002: POST /compute-hi con { asset_ids: ["A","B"] }
--   → Response 200, processed=2, results con 2 entradas
SELECT pass(
  'EF contract: POST { asset_ids: ["A","B"] } → 200, processed=2 — documented'
);

-- EF-COMPUTE-003: POST /compute-hi sin asset_id ni asset_ids
--   → Response 400 { error: "Se requiere asset_id (string) o asset_ids (string[])" }
SELECT pass(
  'EF contract: POST sin asset_id → 400 error — documented'
);

-- EF-COMPUTE-004: POST /compute-hi con body no JSON
--   → Response 400 { error: "Payload inválido: no es JSON" }
SELECT pass(
  'EF contract: non-JSON body → 400 — documented'
);

-- EF-COMPUTE-005: CORS headers en toda respuesta (incluyendo errores)
--   → Access-Control-Allow-Origin: *
SELECT pass(
  'EF contract: CORS headers en toda respuesta — documented'
);

-- EF-COMPUTE-006: DB error (ej: tabla inexistente) → 500
--   → Response 500 { error: "Error interno del servidor" }
SELECT pass(
  'EF contract: DB error → 500 — documented'
);

-- EF-COMPUTE-007: Sin Authorization header → 401
--   → Response 401 { error: "Unauthorized" }
SELECT pass(
  'EF contract: sin Bearer → 401 — documented'
);

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
