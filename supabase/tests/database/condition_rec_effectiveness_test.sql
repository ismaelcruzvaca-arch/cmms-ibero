-- =============================================================================
-- Condition Monitoring — Recommendation Effectiveness Test Suite (pgTAP)
-- SDD 6, PR 3: Views for Recommendation Effectiveness
--
-- Assertions: schema (5), empty data (5), seed data (6) = 16
--
-- Ejecutar:
--   supabase db test --file supabase/tests/database/condition_rec_effectiveness_test.sql
-- =============================================================================

BEGIN;

SELECT plan(16);

-- ===========================================================================
-- SETUP: Shared fixtures
-- ===========================================================================
-- Need a failure_mode for diagnosis inserts
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('REC-EFF-TEST-FM', 'test', 'Rec Effectiveness Test FM', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

-- ===========================================================================
-- 1. SCHEMA TESTS (5 assertions)
-- ===========================================================================

SELECT has_view('public', 'condition_rec_effectiveness',
  '1a: condition_rec_effectiveness view existe');

SELECT has_view('public', 'condition_rec_by_priority',
  '1b: condition_rec_by_priority view existe');

SELECT has_view('public', 'condition_rec_by_policy',
  '1c: condition_rec_by_policy view existe');

SELECT has_column('public', 'condition_rec_effectiveness', 'total_recommendations',
  '1d: condition_rec_effectiveness.total_recommendations existe');

SELECT has_column('public', 'condition_rec_by_priority', 'priority',
  '1e: condition_rec_by_priority.priority existe');

-- ===========================================================================
-- 2. EMPTY DATA TESTS (5 assertions)
--   Las vistas deben retornar 0s, no errores, cuando no hay datos.
-- ===========================================================================

-- 2a: condition_rec_effectiveness siempre retorna 1 fila (COUNT sin GROUP BY)
SELECT row_eq(
  'SELECT count(*)::int FROM public.condition_rec_effectiveness',
  ROW(1),
  '2a: condition_rec_effectiveness retorna 1 fila con datos vacíos'
);

-- 2b: total_recommendations = 0 con datos vacíos
SELECT results_eq(
  'SELECT total_recommendations::int FROM public.condition_rec_effectiveness',
  ARRAY[0],
  '2b: total_recommendations = 0 con datos vacíos'
);

-- 2c: conversion_rate = 0 con datos vacíos (NULLIF denominator safety)
SELECT results_eq(
  'SELECT conversion_rate::numeric(5,4) FROM public.condition_rec_effectiveness',
  ARRAY[0::numeric(5,4)],
  '2c: conversion_rate = 0.0000 con datos vacíos'
);

-- 2d: condition_rec_by_priority retorna 0 filas con datos vacíos
SELECT results_eq(
  'SELECT count(*)::int FROM public.condition_rec_by_priority',
  ARRAY[0],
  '2d: condition_rec_by_priority retorna 0 filas con datos vacíos'
);

-- 2e: condition_rec_by_policy retorna 0 filas con datos vacíos
SELECT results_eq(
  'SELECT count(*)::int FROM public.condition_rec_by_policy',
  ARRAY[0],
  '2e: condition_rec_by_policy retorna 0 filas con datos vacíos'
);

-- ===========================================================================
-- 3. SEED DATA TESTS (6 assertions)
-- ===========================================================================

-- Insertar datos de prueba: 2 diagnósticos, 6 recomendaciones
-- con varios estados y prioridades
INSERT INTO public.condition_diagnoses
  (asset_id, failure_mode_id, diagnosis_status, confidence)
SELECT
  'rec-eff-test',
  id,
  'active',
  0.85
FROM public.condition_failure_mode_catalog
WHERE failure_mode_key = 'REC-EFF-TEST-FM';

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 1', 'critical', 'approved'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 2', 'critical', 'converted_to_wo'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 3', 'high', 'dismissed'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 4', 'high', 'converted_to_wo'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 5', 'medium', 'suggested'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

INSERT INTO public.maintenance_recommendations
  (diagnosis_id, recommended_action, priority, status)
SELECT id, 'Test action 6', 'medium', 'expired'
FROM public.condition_diagnoses
WHERE asset_id = 'rec-eff-test'
LIMIT 1;

-- 3a: condition_rec_effectiveness — total = 6
SELECT results_eq(
  'SELECT total_recommendations::int FROM public.condition_rec_effectiveness',
  ARRAY[6],
  '3a: total_recommendations = 6 con 6 recomendaciones'
);

-- 3b: correct counts per status
-- approved=1, converted_to_wo=2, dismissed=1, suggested=1, expired=1
-- review_required=0, superseded=0
PREPARE eff_status_counts AS
SELECT
  approved_count::int,
  converted_count::int,
  dismissed_count::int,
  suggested_count::int,
  expired_count::int,
  review_required_count::int,
  superseded_count::int
FROM public.condition_rec_effectiveness;

SELECT row_eq(
  'eff_status_counts',
  ROW(1, 2, 1, 1, 1, 0, 0),
  '3b: conteos por estado correctos (approved=1, converted=2, dismissed=1, suggested=1, expired=1, review_required=0, superseded=0)'
);

-- 3c: conversion_rate = 2 / (1 + 2) = 0.6667
SELECT results_eq(
  $$SELECT round(conversion_rate::numeric, 4) FROM public.condition_rec_effectiveness$$,
  ARRAY[0.6667::numeric],
  '3c: conversion_rate = 0.6667 (2 converted / (1 approved + 2 converted))'
);

-- 3d: dismissal_rate = 1 / 6 = 0.1667
SELECT results_eq(
  $$SELECT round(dismissal_rate::numeric, 4) FROM public.condition_rec_effectiveness$$,
  ARRAY[0.1667::numeric],
  '3d: dismissal_rate = 0.1667 (1 dismissed / 6 total)'
);

-- 3e: condition_rec_by_priority — 4 filas (una por prioridad)
SELECT results_eq(
  'SELECT count(*)::int FROM public.condition_rec_by_priority',
  ARRAY[4],
  '3e: condition_rec_by_priority retorna 4 filas (una por prioridad)'
);

-- 3f: Verificar critical row: 2 total, 1 approved, 1 converted_to_wo
--     conversion_rate = 1 / (1+1) = 0.5000
PREPARE critical_row AS
SELECT total::int, approved::int, dismissed::int,
       converted_to_wo::int, round(conversion_rate::numeric, 4)
FROM public.condition_rec_by_priority
WHERE priority = 'critical';

SELECT row_eq(
  'critical_row',
  ROW(2, 1, 0, 1, 0.5000::numeric),
  '3f: priority=critical → total=2, approved=1, converted=1, conversion_rate=0.5000'
);

-- ===========================================================================
-- CLEANUP
-- ===========================================================================
-- Las tablas temporales se limpian automáticamente con ROLLBACK
-- (implícito por pgTAP)

SELECT * FROM finish();

ROLLBACK;
