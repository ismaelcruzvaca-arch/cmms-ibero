-- =============================================================================
-- Performance Metrics + FP/FN Views + Daily Metrics Extension — Test Suite (pgTAP)
-- SDD 6, PR 2b: Functions + Views + ALTER
--
-- Assertions: functions (6), views (6), ALTER (3), compute_daily_metrics (4),
--   behavioral (6) = ~25 assertions
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_performance_metrics_test.sql
-- =============================================================================

BEGIN;

SELECT plan(25);

-- ===========================================================================
-- 1. FUNCTION: compute_performance_metrics (6 assertions)
-- ===========================================================================

SELECT has_function('public', 'compute_performance_metrics',
  ARRAY['text'],
  '1a: compute_performance_metrics(TEXT) existe'
);

SELECT is(
  (SELECT count(*)::int FROM information_schema.parameters
   WHERE specific_schema = 'public'
     AND specific_name = 'compute_performance_metrics'
     AND parameter_name = 'p_asset_id'),
  1,
  '1b: compute_performance_metrics tiene parámetro p_asset_id'
);

SELECT is(
  (SELECT data_type::text FROM information_schema.parameters
   WHERE specific_schema = 'public'
     AND specific_name = 'compute_performance_metrics'
     AND parameter_name = 'p_asset_id'
     AND ordinal_position = 1),
  'text',
  '1c: p_asset_id es de tipo TEXT'
);

-- Verificar que la función retorna las columnas esperadas
SELECT returns_table(
  'public', 'compute_performance_metrics', ARRAY['text'],
  ARRAY[
    'metric_name', 'metric_value', 'numerator', 'denominator',
    'breakdown_category', 'breakdown_key'
  ],
  '1d: compute_performance_metrics retorna columnas metric_name, metric_value, numerator, denominator, breakdown_category, breakdown_key'
);

-- Llamada en vacío debe retornar filas overall con 0s
SELECT is(
  (SELECT count(*)::int FROM public.compute_performance_metrics(NULL)
   WHERE breakdown_category = 'overall'),
  9,
  '1e: compute_performance_metrics retorna 9 filas overall (una por métrica)'
);

-- Verificar que métricas overall retornan 0 en datos vacíos
SELECT is(
  (SELECT metric_value::numeric FROM public.compute_performance_metrics(NULL)
   WHERE metric_name = 'total_diagnoses' AND breakdown_category = 'overall'),
  0,
  '1f: total_diagnoses = 0 cuando no hay datos'
);

-- ===========================================================================
-- 2. FUNCTION: compute_false_positives (3 assertions)
-- ===========================================================================

SELECT has_function('public', 'compute_false_positives',
  ARRAY['text'],
  '2a: compute_false_positives(TEXT) existe'
);

-- En datos vacíos, retorna 0 filas
SELECT is(
  (SELECT count(*)::int FROM public.compute_false_positives(NULL)),
  0,
  '2b: compute_false_positives retorna 0 filas en datos vacíos'
);

SELECT is(
  (SELECT count(*)::int FROM information_schema.parameters
   WHERE specific_schema = 'public'
     AND specific_name = 'compute_false_positives'
     AND parameter_name = 'p_asset_id'),
  1,
  '2c: compute_false_positives tiene parámetro p_asset_id'
);

-- ===========================================================================
-- 3. VIEW: condition_false_positives (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_false_positives',
  '3a: condition_false_positives view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_false_positives),
  0,
  '3b: condition_false_positives retorna 0 filas en datos vacíos'
);

-- ===========================================================================
-- 4. VIEW: condition_missed_detections (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_missed_detections',
  '4a: condition_missed_detections view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_missed_detections),
  0,
  '4b: condition_missed_detections retorna 0 filas sin OTs CM'
);

-- ===========================================================================
-- 5. VIEW: condition_noisy_rules (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_noisy_rules',
  '5a: condition_noisy_rules view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_noisy_rules),
  0,
  '5b: condition_noisy_rules retorna 0 filas sin datos'
);

-- ===========================================================================
-- 6. VIEW: condition_performance_by_fm (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_performance_by_fm',
  '6a: condition_performance_by_fm view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_performance_by_fm),
  0,
  '6b: condition_performance_by_fm retorna 0 filas sin diagnósticos'
);

-- ===========================================================================
-- 7. VIEW: condition_performance_by_rule (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_performance_by_rule',
  '7a: condition_performance_by_rule view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_performance_by_rule),
  0,
  '7b: condition_performance_by_rule retorna 0 filas sin datos'
);

-- ===========================================================================
-- 8. VIEW: condition_performance_by_source (2 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_performance_by_source',
  '8a: condition_performance_by_source view existe'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_performance_by_source),
  0,
  '8b: condition_performance_by_source retorna 0 filas sin datos'
);

-- ===========================================================================
-- 9. ALTER: condition_daily_metrics columns (3 assertions)
-- ===========================================================================

SELECT has_column('public', 'condition_daily_metrics', 'outcomes_confirmed',
  '9a: condition_daily_metrics.outcomes_confirmed existe'
);

SELECT has_column('public', 'condition_daily_metrics', 'outcomes_rejected',
  '9b: condition_daily_metrics.outcomes_rejected existe'
);

SELECT has_column('public', 'condition_daily_metrics', 'outcomes_pending',
  '9c: condition_daily_metrics.outcomes_pending existe'
);

-- ===========================================================================
-- 10. compute_daily_metrics() extended (4 assertions)
-- ===========================================================================

SELECT has_function('public', 'compute_daily_metrics',
  ARRAY['date'],
  '10a: compute_daily_metrics(DATE) existe'
);

-- Idempotente: ejecutar y verificar que no falla
SELECT lives_ok(
  $$SELECT public.compute_daily_metrics(CURRENT_DATE - INTERVAL '1 day')$$,
  '10b: compute_daily_metrics ejecuta sin error con fecha pasada'
);

-- La función retorna INT
SELECT is(
  (SELECT pg_typeof(public.compute_daily_metrics('2020-01-01'::date))::text),
  'integer',
  '10c: compute_daily_metrics retorna INTEGER'
);

-- Idempotencia: segunda llamada debe funcionar sin error (upsert)
SELECT lives_ok(
  $$SELECT public.compute_daily_metrics('2020-01-01'::date)$$,
  '10d: compute_daily_metrics es idempotente (segunda llamada no falla)'
);

-- ===========================================================================
-- FIN TEST SUITE
-- ===========================================================================

SELECT * FROM finish();

ROLLBACK;
