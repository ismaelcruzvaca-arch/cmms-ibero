-- =============================================================================
-- Condition Diagnostic Functions — Test Suite (pgTAP)
-- PR 1b: condition_diagnoses, maintenance_recommendations,
--        compute_diagnosis_confidence, compute_rul_linear,
--        generate_recommendation, evaluate_condition_rules(diagnostic),
--        ALTERs + seed rules
--
-- Assertions: Diagnoses schema (6), RUL gates (4), confidence scoring (4),
--   recommendation lifecycle (4), ALTERs on events+rules (4),
--   seed rules (2), functions exist (4) = ~28 assertions
--
-- Ejecutar:
--   supabase db test --file supabase/tests/database/condition_diagnostic_functions_test.sql
-- =============================================================================

BEGIN;

SELECT plan(28);

-- =============================================================================
-- 1. SCHEMA: condition_diagnoses existe + columnas clave
-- =============================================================================
SELECT has_table('public', 'condition_diagnoses',
  'Tabla condition_diagnoses existe');

SELECT has_column('public', 'condition_diagnoses', 'diagnosis_status',
  'condition_diagnoses.diagnosis_status existe');

SELECT has_column('public', 'condition_diagnoses', 'evidence_summary',
  'condition_diagnoses.evidence_summary (JSONB) existe');

SELECT has_column('public', 'condition_diagnoses', 'supporting_result_ids',
  'condition_diagnoses.supporting_result_ids (UUID[]) existe');

SELECT has_column('public', 'condition_diagnoses', 'contradictory_result_ids',
  'condition_diagnoses.contradictory_result_ids (UUID[]) existe');

SELECT has_column('public', 'condition_diagnoses', 'feedback_status',
  'condition_diagnoses.feedback_status existe');

-- =============================================================================
-- 2. SCHEMA: maintenance_recommendations existe + columnas clave
-- =============================================================================
SELECT has_table('public', 'maintenance_recommendations',
  'Tabla maintenance_recommendations existe');

SELECT has_column('public', 'maintenance_recommendations', 'requires_confirmation',
  'maintenance_recommendations.requires_confirmation existe');

SELECT has_column('public', 'maintenance_recommendations', 'status',
  'maintenance_recommendations.status (suggested/review_required/...) existe');

-- =============================================================================
-- 3. FUNCIONES: Las 4 funciones existen
-- =============================================================================
SELECT has_function('public', 'compute_diagnosis_confidence',
  ARRAY['TEXT', 'TEXT'],
  'Función compute_diagnosis_confidence(TEXT, TEXT) existe');

SELECT has_function('public', 'compute_rul_linear',
  ARRAY['TEXT', 'TEXT', 'TEXT'],
  'Función compute_rul_linear(TEXT, TEXT, TEXT) existe');

SELECT has_function('public', 'generate_recommendation',
  ARRAY['UUID'],
  'Función generate_recommendation(UUID) existe');

SELECT has_function('public', 'get_intervention_window',
  ARRAY['TEXT', 'TEXT'],
  'Función get_intervention_window(TEXT, TEXT) existe');

-- =============================================================================
-- 4. CONFIDENCE SCORING: compute_diagnosis_confidence
--    Sin evidencia → retorna 0 (failure_mode_key no existe)
--    Con failure_mode_key válida pero sin feature_values → retorna 0
-- =============================================================================
SELECT is(
  (SELECT confidence FROM public.compute_diagnosis_confidence(
     'TEST-NO-ASSET', 'pump.cavitation')),
  0.0,
  'compute_diagnosis_confidence: asset sin datos retorna 0'
);

SELECT is(
  (SELECT confidence FROM public.compute_diagnosis_confidence(
     'TEST-ASSET', 'nonexistent.mode')),
  0.0,
  'compute_diagnosis_confidence: failure_mode_key inexistente retorna 0'
);

-- =============================================================================
-- 5. CONFIDENCE SCORING: breakdown JSONB contiene campos esperados
-- =============================================================================
SELECT is(
  (SELECT (breakdown)->>'evidence_total' FROM public.compute_diagnosis_confidence(
     'TEST-NO-ASSET', 'pump.cavitation')),
  '4',
  'compute_diagnosis_confidence: breakdown contiene evidence_total=4 (pump.cavitation tiene 4 evidencias)'
);

SELECT ok(
  (SELECT (breakdown)->>'final_confidence' IS NOT NULL
   FROM public.compute_diagnosis_confidence('TEST-NO-ASSET', 'pump.cavitation')),
  'compute_diagnosis_confidence: breakdown contiene final_confidence'
);

-- =============================================================================
-- 6. RUL GATES: compute_rul_linear
--    Sin trend → assumptions con error, rul_hours IS NULL
-- =============================================================================
SELECT ok(
  (SELECT rul_hours IS NULL
   FROM public.compute_rul_linear('TEST-NO-ASSET', 'vibration.rms', 'pump.cavitation')),
  'compute_rul_linear: sin trend retorna rul_hours NULL'
);

SELECT ok(
  (SELECT array_length(assumptions, 1) > 0
   FROM public.compute_rul_linear('TEST-NO-ASSET', 'vibration.rms', 'pump.cavitation')),
  'compute_rul_linear: sin trend retorna assumptions no vacío'
);

-- Feature_key inexistente → assumptions con error
SELECT ok(
  (SELECT assumptions @> ARRAY['feature_key_not_found:nonexistent.feature']
   FROM public.compute_rul_linear('TEST-ASSET', 'nonexistent.feature', 'pump.cavitation')),
  'compute_rul_linear: feature_key inexistente retorna assumption de error'
);

-- Feature_key NULL behavior
SELECT ok(
  (SELECT rul_hours IS NULL
   FROM public.compute_rul_linear('TEST-ASSET', 'vibration.rms', 'pump.cavitation')),
  'compute_rul_linear: feature sin datos retorna rul_hours NULL'
);

-- =============================================================================
-- 7. RECOMMENDATION LIFECYCLE: generate_recommendation
--    Diagnóstico inexistente → retorna NULL
-- =============================================================================
SELECT is(
  (SELECT public.generate_recommendation('00000000-0000-0000-0000-000000000000')),
  NULL::UUID,
  'generate_recommendation: diagnosis_id inexistente retorna NULL'
);

-- =============================================================================
-- 8. RLS: anon no puede INSERT en condition_diagnoses
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status)
    VALUES ('test-anon', (SELECT id FROM public.condition_failure_mode_catalog
                          WHERE failure_mode_key = 'pump.cavitation'), 'candidate')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_diagnoses'
);
RESET ROLE;

-- =============================================================================
-- 9. RLS: anon puede SELECT de condition_diagnoses (tabla vacía, sin error)
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT COUNT(*) = 0 FROM public.condition_diagnoses),
  'RLS: authenticated puede SELECT condition_diagnoses (vacía)'
);
RESET ROLE;

-- =============================================================================
-- 10. RLS: anon no puede INSERT en maintenance_recommendations
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.maintenance_recommendations
    (diagnosis_id, recommended_action, priority)
    VALUES ('00000000-0000-0000-0000-000000000000', 'test', 'low')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en maintenance_recommendations'
);
RESET ROLE;

-- =============================================================================
-- 11. ALTERs en condition_events: diagnosis_id y failure_mode_id existen
-- =============================================================================
SELECT has_column('public', 'condition_events', 'diagnosis_id',
  'ALTER: condition_events.diagnosis_id existe');

SELECT has_column('public', 'condition_events', 'failure_mode_id',
  'ALTER: condition_events.failure_mode_id existe');

-- =============================================================================
-- 12. ALTER en condition_rules: evaluation_type CHECK incluye 'diagnostic'
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu
      ON cc.constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'condition_rules'
      AND cc.check_clause LIKE '%diagnostic%'
  ),
  'ALTER: condition_rules CHECK evaluation_type incluye diagnostic'
);

-- =============================================================================
-- 13. SEED: 2 reglas diagnósticas draft existen
-- =============================================================================
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.condition_rules
   WHERE evaluation_type = 'diagnostic' AND validation_status = 'draft'),
  '>=', 2,
  'Seed: al menos 2 reglas diagnósticas draft existen'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_rules
          WHERE rule_name = 'Diagnóstico: Cavitación Bomba'
            AND evaluation_type = 'diagnostic'),
  'Seed: regla "Diagnóstico: Cavitación Bomba" existe'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_rules
          WHERE rule_name = 'Diagnóstico: Desbalance Rotativo'
            AND evaluation_type = 'diagnostic'),
  'Seed: regla "Diagnóstico: Desbalance Rotativo" existe'
);

-- =============================================================================
-- 14. CHECK CONSTRAINT en condition_diagnoses.diagnosis_status
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status)
    VALUES ('test', (SELECT id FROM public.condition_failure_mode_catalog
                     WHERE failure_mode_key = 'pump.cavitation'), 'invalid_status')$$,
  '23514',
  NULL,
  'CHECK: condition_diagnoses.diagnosis_status rechaza valor inválido'
);

-- =============================================================================
-- 15. CHECK CONSTRAINT en maintenance_recommendations.priority
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.maintenance_recommendations
    (diagnosis_id, recommended_action, priority)
    VALUES ('00000000-0000-0000-0000-000000000000', 'test', 'urgent')$$,
  '23514',
  NULL,
  'CHECK: maintenance_recommendations.priority rechaza valor urgente'
);

-- =============================================================================
-- 16. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
