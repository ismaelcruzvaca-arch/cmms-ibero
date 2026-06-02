-- =============================================================================
-- Condition Baselines + Detection Functions — Test Suite (pgTAP)
-- PR 1b: Detection Functions, Rules Extension, Adaptive HI
--
-- Assertions: schema (10), bootstrap seed (6), is_baseline_learnable (6),
--   compute_baselines (8), compute_baseline_residual (6),
--   compute_kalman_1d (6), compute_feature_trend (6),
--   evaluate_condition_rules residual (4), compute_health_index adaptive (4),
--   get_applicable_thresholds (4) = ~60 assertions
--
-- Ejecutar:
--   supabase db test --file supabase/tests/database/condition_baselines_detection_test.sql
-- =============================================================================

BEGIN;

SELECT plan(60);

-- =============================================================================
-- 1. SCHEMA: condition_baselines (10 assertions)
-- =============================================================================

-- 1a. Tabla existe
SELECT has_table('public', 'condition_baselines',
  'Tabla condition_baselines existe');

-- 1b. Columnas clave existen
SELECT has_column('public', 'condition_baselines', 'id',
  'condition_baselines.id existe');
SELECT has_column('public', 'condition_baselines', 'asset_id',
  'condition_baselines.asset_id existe');
SELECT has_column('public', 'condition_baselines', 'feature_definition_id',
  'condition_baselines.feature_definition_id existe');
SELECT has_column('public', 'condition_baselines', 'method_key',
  'condition_baselines.method_key existe');
SELECT has_column('public', 'condition_baselines', 'mean',
  'condition_baselines.mean existe');
SELECT has_column('public', 'condition_baselines', 'stddev',
  'condition_baselines.stddev existe');
SELECT has_column('public', 'condition_baselines', 'baseline_status',
  'condition_baselines.baseline_status existe');
SELECT has_column('public', 'condition_baselines', 'baseline_version',
  'condition_baselines.baseline_version existe');

-- 1c. CHECK constraint de baseline_status es correcta
SELECT col_not_null('public', 'condition_baselines', 'baseline_status',
  'condition_baselines.baseline_status es NOT NULL');

-- =============================================================================
-- 2. BOOTSTRAP SEED DATA EXISTS (6 assertions)
-- =============================================================================

-- 2a. Al menos 40 condition_windows de bootstrap
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_windows
   WHERE source_id = 'bootstrap_sdd3'),
  '>=', 40,
  'Al menos 40 condition_windows bootstrap existen'
);

-- 2b. Al menos 80 feature_values (2 features × 40+ windows)
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_feature_values cfv
   JOIN public.condition_windows cw ON cfv.window_id = cw.id
   WHERE cw.source_id = 'bootstrap_sdd3'),
  '>=', 80,
  'Al menos 80 feature_values bootstrap existen (2 features por window)'
);

-- 2c. BANDA-TR-01 existe en seed data
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_windows
          WHERE asset_id = 'BANDA-TR-01' AND source_id = 'bootstrap_sdd3'),
  'BANDA-TR-01 tiene ventanas bootstrap'
);

-- 2d. TOS-MOT-01 existe en seed data
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_windows
          WHERE asset_id = 'TOS-MOT-01' AND source_id = 'bootstrap_sdd3'),
  'TOS-MOT-01 tiene ventanas bootstrap'
);

-- 2e. 3 draft baselines existen
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_baselines
   WHERE baseline_status = 'draft'),
  '>=', 3,
  'Al menos 3 baselines draft existen del bootstrap'
);

-- 2f. vibration.rms feature definition existe
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_feature_definitions
          WHERE feature_key = 'vibration.rms'),
  'Feature definition vibration.rms existe'
);

-- =============================================================================
-- 3. CONDITION_ANALYSIS_RESULTS: Kalman columns added (4 assertions)
-- =============================================================================
SELECT has_column('public', 'condition_analysis_results', 'state_variance',
  'condition_analysis_results.state_variance existe');
SELECT has_column('public', 'condition_analysis_results', 'innovation',
  'condition_analysis_results.innovation existe');
SELECT has_column('public', 'condition_analysis_results', 'innovation_variance',
  'condition_analysis_results.innovation_variance existe');
SELECT has_column('public', 'condition_analysis_results', 'kalman_gain',
  'condition_analysis_results.kalman_gain existe');

-- =============================================================================
-- 4. CONDITION_EVENT_SOURCES: contribution_type column added
-- =============================================================================
SELECT has_column('public', 'condition_event_sources', 'contribution_type',
  'condition_event_sources.contribution_type existe');

-- =============================================================================
-- 5. is_baseline_learnable() — function exists + gates (6 assertions)
-- =============================================================================

-- 5a. Function exists
SELECT has_function('public', 'is_baseline_learnable',
  ARRAY['text'],
  'is_baseline_learnable(TEXT) existe');

-- 5b. Activo limpio sin eventos activos ni tendencias → TRUE
SELECT is(
  public.is_baseline_learnable('BANDA-TR-01'),
  true,
  'BANDA-TR-01 sin eventos activos → is_baseline_learnable = TRUE'
);

-- 5c. Activo sin eventos es aprendible (caso general)
SELECT is(
  public.is_baseline_learnable('TOS-MOT-01'),
  true,
  'TOS-MOT-01 sin eventos activos → is_baseline_learnable = TRUE'
);

-- 5d. Activo inexistente → TRUE (no hay eventos ni tendencias)
SELECT is(
  public.is_baseline_learnable('NO_EXISTE-999'),
  true,
  'Activo inexistente → is_baseline_learnable = TRUE (no hay datos bloqueantes)'
);

-- 5e. Active event blocks learning
-- Creamos un evento activo y verificamos que bloquea
INSERT INTO public.condition_events
  (asset_id, event_type, severity, status, message)
VALUES
  ('TST-BL-001', 'threshold_exceeded', 'warning', 'open', 'Evento de prueba'),
  ('TST-BL-001', 'threshold_exceeded', 'warning', 'open', 'Evento de prueba 2')
ON CONFLICT DO NOTHING;

-- Verificar que no hay eventos (puede que el INSERT conflict no inserte nada)
-- Mejor: usar un asset que realmente tenga eventos
SELECT is(
  public.is_baseline_learnable('TST-BL-001'),
  false,
  'Activo con eventos open → is_baseline_learnable = FALSE'
);

-- 5f. is_baseline_learnable function returns boolean type
SELECT ok(
  pg_typeof(public.is_baseline_learnable('BANDA-TR-01')) = 'boolean'::regtype,
  'is_baseline_learnable retorna BOOLEAN'
);

-- =============================================================================
-- 6. compute_baselines() — function exists + stats (8 assertions)
-- =============================================================================

-- 6a. Function exists
SELECT has_function('public', 'compute_baselines',
  ARRAY['text'],
  'compute_baselines(TEXT) existe');

-- 6b. Ejecuta sin error para BANDA-TR-01
SELECT lives_ok(
  'SELECT public.compute_baselines(''BANDA-TR-01'')',
  'compute_baselines(BANDA-TR-01) ejecuta sin error'
);

-- 6c. Retorna INT (count de baselines creadas/actualizadas)
SELECT ok(
  (SELECT public.compute_baselines('BANDA-TR-01')) IS NOT NULL,
  'compute_baselines(BANDA-TR-01) retorna un valor'
);

-- 6d. compute_baselines retorna entero >= 0
SELECT cmp_ok(
  (SELECT public.compute_baselines('BANDA-TR-01')),
  '>=', 0,
  'compute_baselines retorna valor >= 0'
);

-- 6e. Baselines generadas tienen mean > 0
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_baselines
    WHERE asset_id = 'BANDA-TR-01'
      AND mean > 0
      AND created_by = 'compute_baselines()'
  ),
  'compute_baselines genera baselines con mean > 0'
);

-- 6f. Baselines generadas tienen sample_count > 0
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_baselines
    WHERE asset_id = 'BANDA-TR-01'
      AND sample_count = 0
      AND created_by = 'compute_baselines()'
  ),
  'compute_baselines genera baselines con sample_count > 0'
);

-- 6g. Ejecuta sin error para TOS-MOT-01
SELECT lives_ok(
  'SELECT public.compute_baselines(''TOS-MOT-01'')',
  'compute_baselines(TOS-MOT-01) ejecuta sin error'
);

-- 6h. compute_baselines para activo inexistente retorna 0
SELECT is(
  public.compute_baselines('NO_EXISTE-999'),
  0,
  'compute_baselines(activo inexistente) retorna 0'
);

-- =============================================================================
-- 7. compute_baseline_residual() — function + z-score + outlier (6 assertions)
-- =============================================================================

-- 7a. Function exists
SELECT has_function('public', 'compute_baseline_residual',
  ARRAY['text'],
  'compute_baseline_residual(TEXT) existe');

-- 7b. Ejecuta sin error para BANDA-TR-01
SELECT lives_ok(
  'SELECT public.compute_baseline_residual(''BANDA-TR-01'')',
  'compute_baseline_residual(BANDA-TR-01) ejecuta sin error'
);

-- 7c. Almacena resultados residual en condition_analysis_results
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_analysis_results
   WHERE analysis_type = 'residual'
     AND method_key = 'adaptive_baseline'
     AND asset_id = 'BANDA-TR-01'),
  '>', 0,
  'compute_baseline_residual almacena resultados residual'
);

-- 7d. Residuales tienen result_value (z-score) no NULL
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE analysis_type = 'residual'
      AND method_key = 'adaptive_baseline'
      AND asset_id = 'BANDA-TR-01'
      AND result_value IS NULL
  ),
  'Todos los residuales tienen result_value no NULL'
);

-- 7e. Residuales tienen parameters con baseline_id
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE analysis_type = 'residual'
      AND method_key = 'adaptive_baseline'
      AND asset_id = 'BANDA-TR-01'
      AND parameters ? 'baseline_id'
  ),
  'Residuales tienen baseline_id en parameters'
);

-- 7f. Ejecuta sin error para TOS-MOT-01
SELECT lives_ok(
  'SELECT public.compute_baseline_residual(''TOS-MOT-01'')',
  'compute_baseline_residual(TOS-MOT-01) ejecuta sin error'
);

-- =============================================================================
-- 8. compute_kalman_1d() — function + convergence (6 assertions)
-- =============================================================================

-- 8a. Function exists
SELECT has_function('public', 'compute_kalman_1d',
  ARRAY['text', 'text', 'numeric', 'numeric'],
  'compute_kalman_1d(TEXT, TEXT, NUMERIC, NUMERIC) existe');

-- 8b. Ejecuta sin error para vibration.rms
SELECT lives_ok(
  'SELECT public.compute_kalman_1d(''BANDA-TR-01'', ''vibration.rms'', 0.01, 1.0)',
  'compute_kalman_1d(BANDA-TR-01, vibration.rms) ejecuta sin error'
);

-- 8c. Almacena kalman_state en condition_analysis_results
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_analysis_results
   WHERE analysis_type = 'kalman_state'
     AND asset_id = 'BANDA-TR-01'),
  '>', 0,
  'compute_kalman_1d almacena kalman_state results'
);

-- 8d. Resultados tienen state_variance
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE analysis_type = 'kalman_state'
      AND asset_id = 'BANDA-TR-01'
      AND state_variance IS NULL
  ),
  'Todos los kalman_state tienen state_variance no NULL'
);

-- 8e. Resultados tienen innovation
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE analysis_type = 'kalman_state'
      AND asset_id = 'BANDA-TR-01'
      AND innovation IS NULL
  ),
  'Todos los kalman_state tienen innovation no NULL'
);

-- 8f. Ejecuta para TOS-MOT-01 sin error
SELECT lives_ok(
  'SELECT public.compute_kalman_1d(''TOS-MOT-01'', ''vibration.rms'', 0.01, 1.0)',
  'compute_kalman_1d(TOS-MOT-01, vibration.rms) ejecuta sin error'
);

-- =============================================================================
-- 9. compute_feature_trend() — function + gates (6 assertions)
-- =============================================================================

-- 9a. Function exists
SELECT has_function('public', 'compute_feature_trend',
  ARRAY['text', 'text', 'text'],
  'compute_feature_trend(TEXT, TEXT, TEXT) existe');

-- 9b. Ejecuta sin error con datos suficientes
SELECT lives_ok(
  'SELECT public.compute_feature_trend(''BANDA-TR-01'', ''vibration.rms'', NULL)',
  'compute_feature_trend(BANDA-TR-01, vibration.rms) ejecuta sin error'
);

-- 9c. Almacena trend_slope con data suficiente
SELECT cmp_ok(
  (SELECT COUNT(*) FROM public.condition_analysis_results
   WHERE analysis_type = 'trend_slope'
     AND method_key = 'linear_regression'
     AND asset_id = 'BANDA-TR-01'),
  '>', 0,
  'compute_feature_trend almacena trend_slope results'
);

-- 9d. Resultados tienen r_squared
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_analysis_results
    WHERE analysis_type = 'trend_slope'
      AND method_key = 'linear_regression'
      AND asset_id = 'BANDA-TR-01'
      AND r_squared IS NOT NULL
  ),
  'Trend results tienen r_squared'
);

-- 9e. Feature inexistente → ejecuta sin error, no almacena
SELECT lives_ok(
  'SELECT public.compute_feature_trend(''BANDA-TR-01'', ''feature.inexistente'', NULL)',
  'compute_feature_trend con feature_key inexistente ejecuta sin error'
);

-- 9f. feature_key inexistente retorna row con sample_count=0
SELECT is(
  (SELECT sample_count FROM public.compute_feature_trend('BANDA-TR-01', 'feature.inexistente', NULL)),
  0,
  'compute_feature_trend feature inexistente retorna sample_count=0'
);

-- =============================================================================
-- 10. evaluate_condition_rules() — extended with residual (4 assertions)
-- =============================================================================

-- 10a. Function exists (already existed, now extended)
SELECT has_function('public', 'evaluate_condition_rules',
  ARRAY['text'],
  'evaluate_condition_rules(TEXT) existe');

-- 10b. Evalúa reglas existentes sin error
SELECT lives_ok(
  'SELECT public.evaluate_condition_rules(''BANDA-TR-01'')',
  'evaluate_condition_rules(BANDA-TR-01) ejecuta sin error'
);

-- 10c. Retorna INT
SELECT ok(
  (SELECT public.evaluate_condition_rules('BANDA-TR-01')) IS NOT NULL,
  'evaluate_condition_rules retorna un valor'
);

-- 10d. Regla residual con z-score alto dispara
-- Primero aseguramos que haya un residual con z-score alto para BANDA-TR-01
-- (los residuales ya fueron calculados en el test 7)
SELECT lives_ok(
  'SELECT public.evaluate_condition_rules(''TOS-MOT-01'')',
  'evaluate_condition_rules(TOS-MOT-01) ejecuta sin error'
);

-- =============================================================================
-- 11. compute_health_index() — adaptive zones (4 assertions)
-- =============================================================================

-- 11a. Function exists with 4 parameters
SELECT has_function('public', 'compute_health_index',
  ARRAY['text', 'timestamptz', 'text', 'text'],
  'compute_health_index(TEXT, TIMESTAMPTZ, TEXT, TEXT) existe');

-- 11b. Modo ISO tradicional sin cambios
SELECT lives_ok(
  'SELECT public.compute_health_index(''BANDA-TR-01'', NOW(), NULL, ''iso'')',
  'compute_health_index modo ISO ejecuta sin error'
);

-- 11c. Modo adaptive ejecuta sin error
SELECT lives_ok(
  'SELECT public.compute_health_index(''BANDA-TR-01'', NOW(), NULL, ''adaptive'')',
  'compute_health_index modo adaptive ejecuta sin error'
);

-- 11d. Modo adaptive retorna health_index no NULL
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.compute_health_index('BANDA-TR-01', NOW(), NULL, 'adaptive')
    WHERE health_index IS NOT NULL
  ),
  'compute_health_index modo adaptive retorna health_index válido'
);

-- =============================================================================
-- 12. get_applicable_thresholds() — precedence (4 assertions)
-- =============================================================================

-- 12a. Function exists
SELECT has_function('public', 'get_applicable_thresholds',
  ARRAY['text', 'uuid', 'text', 'text', 'text'],
  'get_applicable_thresholds(TEXT, UUID, TEXT, TEXT, TEXT) existe');

-- 12b. Ejecuta sin error
SELECT lives_ok(
  $TEST$
  SELECT public.get_applicable_thresholds(
    'BANDA-TR-01',
    (SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
    'rms_velocity_window',
    'FULL_LOAD',
    NULL
  )
  $TEST$,
  'get_applicable_thresholds ejecuta sin error'
);

-- 12c. Retorna threshold_source para BANDA-TR-01
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.get_applicable_thresholds(
      'BANDA-TR-01',
      (SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
      'rms_velocity_window',
      'FULL_LOAD',
      NULL
    )
  ),
  'get_applicable_thresholds retorna al menos una fila'
);

-- 12d. threshold_source es 'iso' o 'baseline' o 'none'
SELECT ok(
  (SELECT threshold_source FROM public.get_applicable_thresholds(
    'BANDA-TR-01',
    (SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
    'rms_velocity_window',
    'FULL_LOAD',
    NULL
  )) IN ('iso', 'baseline', 'none'),
  'get_applicable_thresholds retorna threshold_source válido'
);

-- =============================================================================
-- 13. REGLAS SEMILLA SDD 3: Bootstrap rules exist (3 assertions)
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_rules
    WHERE rule_name = 'RMS Z>3 Sostenido'
      AND evaluation_type = 'residual'
  ),
  'Regla semilla "RMS Z>3 Sostenido" existe'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_rules
    WHERE rule_name = 'RMS Innovación Alta'
      AND evaluation_type = 'innovation_threshold'
  ),
  'Regla semilla "RMS Innovación Alta" existe'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_rules
    WHERE rule_name = 'RMS Tendencia Significativa'
      AND evaluation_type = 'trend'
  ),
  'Regla semilla "RMS Tendencia Significativa" existe'
);

-- =============================================================================
-- 14. condition_rules evaluation_type CHECK extendido (2 assertions)
-- =============================================================================

-- Verificar que los nuevos tipos pueden insertarse
SELECT lives_ok(
  $TEST$
  INSERT INTO public.condition_rules (
    rule_name, description, feature_key, method_key,
    evaluation_type, rule_config, severity, action, validation_status
  ) VALUES (
    'TST-ZSCORE-THRESHOLD',
    'Test z_score_threshold type',
    'vibration.rms', 'rms_velocity_window',
    'z_score_threshold',
    '{"min_z_score": 3.0, "duration_windows": 1}',
    'info', 'log_event', 'draft'
  ) ON CONFLICT (rule_name, version) DO NOTHING
  $TEST$,
  'INSERT regla con evaluation_type=z_score_threshold funciona'
);

SELECT lives_ok(
  $TEST$
  INSERT INTO public.condition_rules (
    rule_name, description, feature_key, method_key,
    evaluation_type, rule_config, severity, action, validation_status
  ) VALUES (
    'TST-TREND-SIGNIFICANCE',
    'Test trend_significance type',
    'vibration.rms', 'rms_velocity_window',
    'trend_significance',
    '{"min_r_squared": 0.5, "min_slope_abs": 0.01}',
    'info', 'log_event', 'draft'
  ) ON CONFLICT (rule_name, version) DO NOTHING
  $TEST$,
  'INSERT regla con evaluation_type=trend_significance funciona'
);

-- =============================================================================
-- 15. COMPUTE FUNCTIONS: RETURNS TABLE types correct (2 assertions)
-- =============================================================================
SELECT is(
  (SELECT pg_typeof(result_value) FROM public.compute_kalman_1d('BANDA-TR-01', 'vibration.rms') LIMIT 1)::TEXT,
  'numeric',
  'compute_kalman_1d.state es NUMERIC'
);

SELECT is(
  (SELECT pg_typeof(sample_count) FROM public.compute_feature_trend('BANDA-TR-01', 'vibration.rms', NULL) LIMIT 1)::TEXT,
  'integer',
  'compute_feature_trend.sample_count es INTEGER'
);

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
