-- =============================================================================
-- RUL Calibration — Test Suite (pgTAP)
-- SDD 6, PR 4: condition_prediction_snapshots + calibration functions +
--   compute_rul_linear modification
--
-- Assertions: ~24
--   - Schema: table, columns, CHECK, FKs, indexes (8)
--   - Functions: existence (3)
--   - Calibration: NULLs sin datos, datos vinculados (3)
--   - Linking: outcomes linking snapshots (3)
--   - Snapshot: compute_rul_linear crea snapshot (3)
--   - View: existence, columns, queryable (3)
--   - RLS: enabled, policies exist (3)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_rul_calibration_test.sql
-- =============================================================================

BEGIN;
SELECT plan(26);

-- =============================================================================
-- 1. SCHEMA: condition_prediction_snapshots table (8 assertions)
-- =============================================================================
SELECT has_table('public', 'condition_prediction_snapshots',
  'Tabla condition_prediction_snapshots existe');

SELECT has_column('public', 'condition_prediction_snapshots', 'asset_id',
  'Columna asset_id existe');
SELECT has_column('public', 'condition_prediction_snapshots', 'rul_mid',
  'Columna rul_mid existe');
SELECT has_column('public', 'condition_prediction_snapshots', 'prediction_type',
  'Columna prediction_type existe');
SELECT has_column('public', 'condition_prediction_snapshots', 'confidence',
  'Columna confidence existe');
SELECT has_column('public', 'condition_prediction_snapshots', 'actual_outcome_id',
  'Columna actual_outcome_id (FK a outcomes) existe');
SELECT has_column('public', 'condition_prediction_snapshots', 'model_key',
  'Columna model_key (FK a degradation_models) existe');

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.table_constraints tc
      ON cc.constraint_name = tc.constraint_name
      AND cc.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'condition_prediction_snapshots'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause ILIKE '%prediction_type%'
  ),
  'CHECK constraint en prediction_type existe'
);

-- =============================================================================
-- 2. INDEXES (2 assertions)
-- =============================================================================
SELECT has_index('public', 'condition_prediction_snapshots', 'idx_snap_asset_time',
  'Índice idx_snap_asset_time (asset_id, predicted_at) existe');
SELECT has_index('public', 'condition_prediction_snapshots', 'idx_snap_diagnosis',
  'Índice idx_snap_diagnosis (diagnosis_id) existe');

-- =============================================================================
-- 3. FUNCTION EXISTENCE (3 assertions)
-- =============================================================================
SELECT has_function('public', 'compute_rul_calibration',
  ARRAY['text', 'text', 'integer'],
  'compute_rul_calibration(TEXT, TEXT, INT) existe');

SELECT has_function('public', 'link_rul_outcomes',
  ARRAY[]::TEXT[],
  'link_rul_outcomes() existe');

SELECT has_function('public', 'compute_rul_linear',
  ARRAY['text', 'text', 'text'],
  'compute_rul_linear(TEXT, TEXT, TEXT) existe (modificada SDD 6)');

-- =============================================================================
-- 4. SETUP: Datos de prueba
-- =============================================================================

-- 4a. Feature definition
INSERT INTO public.condition_feature_definitions
  (feature_key, category, display_name, unit, description)
VALUES
  ('rul-calc-test.feature', 'vibration', 'RUL Calc Test Feature', 'mm/s', 'Prueba RUL Calibration')
ON CONFLICT (feature_key) DO NOTHING;

-- 4b. Failure mode catalog
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, detectability,
   validation_status, category)
VALUES
  ('rul-calc-test.fm', 'pump', 'Prueba RUL Calibration FM',
   'high', 'medium', 'field_validated', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

-- 4c. Degradation model (para FK en snapshots)
INSERT INTO public.condition_degradation_models
  (model_key, model_name, model_type, min_data_readiness_level,
   validation_status, version)
VALUES
  ('rul-calc-test.model', 'Test Model', 'linear', 1, 'active', 1)
ON CONFLICT (model_key) DO NOTHING;

-- 4d. Thresholds (para compute_rul_linear)
-- Nota: condition_threshold_catalog requiere feature_definition_id y method_key,
-- pero el test salta compute_rul_linear si get_applicable_thresholds falla.
-- Los tests de linking y calibración no dependen de thresholds.

-- =============================================================================
-- 5. TEST: compute_rul_calibration retorna NULLs sin datos (1 assertion)
-- =============================================================================
SELECT results_eq(
  'SELECT bias IS NULL AND mape IS NULL AND underestimate_rate IS NULL
   FROM public.compute_rul_calibration(''rul-calc-nonexistent'', NULL, 365)',
  ARRAY[true],
  'compute_rul_calibration: sin datos retorna NULLs (no error)'
);

-- =============================================================================
-- 6. SETUP: Datos para linking test
-- =============================================================================

-- 6a. Snapshots sin vincular
INSERT INTO public.condition_prediction_snapshots
  (asset_id, failure_mode_key, prediction_type, predicted_at,
   rul_low, rul_mid, rul_high, unit, confidence,
   method_key, method_version, model_key, model_version)
VALUES
  ('RUL-CALC-TEST-LINK', 'rul-calc-test.fm', 'rul_estimate',
   NOW() - INTERVAL '10 days',
   150, 200, 250, 'hours', 0.85,
   'linear_extrapolation', '1.0', 'rul-calc-test.model', 1),
  ('RUL-CALC-TEST-LINK', 'rul-calc-test.fm', 'rul_estimate',
   NOW() - INTERVAL '5 days',
   50, 80, 110, 'hours', 0.75,
   'linear_extrapolation', '1.0', 'rul-calc-test.model', 1);

-- 6b. Diagnosis para linking
INSERT INTO public.condition_diagnoses
  (asset_id, failure_mode_id, diagnosis_status, confidence)
SELECT
  'RUL-CALC-TEST-LINK', cfmc.id, 'active', 0.8
FROM public.condition_failure_mode_catalog cfmc
WHERE cfmc.failure_mode_key = 'rul-calc-test.fm';

-- 6c. Outcome confirmado con failure_date (debe matchear con snapshots)
INSERT INTO public.condition_outcomes
  (diagnosis_id, confirmed_status, failure_date, created_at)
SELECT cd.id, 'confirmed', NOW() - INTERVAL '1 day', NOW()
FROM public.condition_diagnoses cd
WHERE cd.asset_id = 'RUL-CALC-TEST-LINK'
  AND cd.diagnosis_status = 'active'
LIMIT 1;

-- =============================================================================
-- 7. TEST: link_rul_outcomes (3 assertions)
-- =============================================================================
SELECT is(
  public.link_rul_outcomes(),
  2,
  'link_rul_outcomes: vincula 2 snapshots con outcome confirmado'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_prediction_snapshots
    WHERE asset_id = 'RUL-CALC-TEST-LINK'
      AND actual_outcome_id IS NOT NULL
  ),
  'Snapshots vinculados tienen actual_outcome_id no NULL'
);

-- Verificar que no hay snapshots sin vincular para este asset
SELECT is(
  (SELECT COUNT(*) FROM public.condition_prediction_snapshots
   WHERE asset_id = 'RUL-CALC-TEST-LINK' AND actual_outcome_id IS NULL),
  0,
  'Todos los snapshots del asset fueron vinculados'
);

-- =============================================================================
-- 8. TEST: compute_rul_calibration con datos vinculados (2 assertions)
-- =============================================================================
SELECT is(
  (SELECT COUNT(*) FROM public.compute_rul_calibration('RUL-CALC-TEST-LINK', NULL, 365)),
  1,
  'compute_rul_calibration: retorna exactamente 1 fila con datos'
);

SELECT ok(
  (SELECT bias IS NOT NULL FROM public.compute_rul_calibration('RUL-CALC-TEST-LINK', NULL, 365)),
  'compute_rul_calibration: bias calculado con datos vinculados'
);

-- =============================================================================
-- 9. SETUP: Datos para test de snapshot desde compute_rul_linear
-- =============================================================================

-- 9a. Windows con feature_values G0
INSERT INTO public.condition_windows
  (external_window_id, asset_id, source_id, source_type,
   window_start, window_end, operational_context)
VALUES
  ('rul-calc-lin-1', 'RUL-CALC-LIN-001', 'tst-src', 'edge',
   NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour',
   '{"regime":"FULL_LOAD"}'),
  ('rul-calc-lin-2', 'RUL-CALC-LIN-001', 'tst-src', 'edge',
   NOW() - INTERVAL '1 hour', NOW(),
   '{"regime":"FULL_LOAD"}');

INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, confidence)
SELECT cw.id, fd.id,
       CASE WHEN cw.external_window_id = 'rul-calc-lin-1' THEN 3.5 ELSE 4.2 END,
       'mm/s', 'G0', 'rms_velocity_window', '0.1.0', 1.0
FROM public.condition_windows cw
CROSS JOIN public.condition_feature_definitions fd
WHERE cw.asset_id = 'RUL-CALC-LIN-001'
  AND fd.feature_key = 'rul-calc-test.feature';

-- 9b. Trend analysis result (sample_count=15 > 10, r_squared=0.85 > 0.5)
INSERT INTO public.condition_analysis_results
  (asset_id, feature_definition_id, analysis_type, method_key, method_version,
   result_value, result_unit, r_squared, confidence, parameters, window_end)
SELECT
  'RUL-CALC-LIN-001', fd.id, 'trend_slope', 'linear_regression', '1.0.0',
  0.005, 'mm/s/day', 0.85, 0.9,
  jsonb_build_object('sample_count', 15),
  NOW()
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'rul-calc-test.feature';

-- 9c. Diagnosis activa
INSERT INTO public.condition_diagnoses
  (asset_id, failure_mode_id, diagnosis_status, confidence)
SELECT
  'RUL-CALC-LIN-001', cfmc.id, 'active', 0.85
FROM public.condition_failure_mode_catalog cfmc
WHERE cfmc.failure_mode_key = 'rul-calc-test.fm';

-- =============================================================================
-- 10. TEST: compute_rul_linear crea snapshot (3 assertions)
-- =============================================================================

-- Eliminar snapshots previos de este asset
DELETE FROM public.condition_prediction_snapshots
WHERE asset_id = 'RUL-CALC-LIN-001';

-- Ejecutar compute_rul_linear
SELECT * FROM public.compute_rul_linear(
  'RUL-CALC-LIN-001', 'rul-calc-test.feature', 'rul-calc-test.fm'
);

-- Verificar que se creó exactamente 1 snapshot
SELECT is(
  (SELECT COUNT(*) FROM public.condition_prediction_snapshots
   WHERE asset_id = 'RUL-CALC-LIN-001'),
  1,
  'compute_rul_linear: insertó 1 snapshot'
);

-- Verificar campos del snapshot
SELECT results_eq(
  'SELECT prediction_type, method_key, model_key, model_version, unit
   FROM public.condition_prediction_snapshots
   WHERE asset_id = ''RUL-CALC-LIN-001''
   ORDER BY created_at DESC LIMIT 1',
  $$VALUES ('rul_estimate'::TEXT, 'linear_extrapolation'::TEXT,
            'linear_extrapolation'::TEXT, 1, 'hours')$$,
  'Snapshot tiene prediction_type, method_key, model_key, model_version, unit correctos'
);

-- Verificar que rul_mid es positivo (cálculo exitoso)
SELECT ok(
  (SELECT rul_mid > 0 FROM public.condition_prediction_snapshots
   WHERE asset_id = 'RUL-CALC-LIN-001'),
  'Snapshot: rul_mid > 0 (RUL calculado correctamente)'
);

-- =============================================================================
-- 11. VIEW: condition_prediction_calibration (3 assertions)
-- =============================================================================
SELECT has_view('public', 'condition_prediction_calibration',
  'Vista condition_prediction_calibration existe');

SELECT has_column('public', 'condition_prediction_calibration', 'bias',
  'condition_prediction_calibration tiene columna bias');
SELECT has_column('public', 'condition_prediction_calibration', 'mape',
  'condition_prediction_calibration tiene columna mape');

SELECT lives_ok(
  'SELECT * FROM public.condition_prediction_calibration LIMIT 1',
  'condition_prediction_calibration: consultable sin error'
);

-- =============================================================================
-- 12. RLS: Verificar policies (3 assertions)
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_tables
    WHERE tablename = 'condition_prediction_snapshots'
      AND rowsecurity = true
  ),
  'RLS está habilitado en condition_prediction_snapshots'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'condition_prediction_snapshots'
      AND policyname = 'cps_select'
  ),
  'Policy cps_select (SELECT authenticated) existe'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'condition_prediction_snapshots'
      AND policyname = 'cps_update'
  ),
  'Policy cps_update (ADMIN UPDATE) existe'
);

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
