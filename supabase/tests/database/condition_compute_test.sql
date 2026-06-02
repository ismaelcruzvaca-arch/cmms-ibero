-- =============================================================================
-- Condition Metrology Compute — Test Suite (pgTAP)
-- PR 2a: condition_analysis_results + condition_rules
--
-- Assertions: schema, constraints, seed data, CHECKs, FKs, RLS, indexes (~50)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_compute_test.sql
-- =============================================================================

BEGIN;

SELECT plan(50);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_analysis_results',
  'Tabla condition_analysis_results existe');

SELECT has_table('public', 'condition_rules',
  'Tabla condition_rules existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_analysis_results
-- =============================================================================
SELECT has_column('public', 'condition_analysis_results', 'id',
  'condition_analysis_results.id existe');
SELECT has_column('public', 'condition_analysis_results', 'asset_id',
  'condition_analysis_results.asset_id existe');
SELECT has_column('public', 'condition_analysis_results', 'feature_definition_id',
  'condition_analysis_results.feature_definition_id existe');
SELECT has_column('public', 'condition_analysis_results', 'analysis_type',
  'condition_analysis_results.analysis_type existe');
SELECT has_column('public', 'condition_analysis_results', 'method_key',
  'condition_analysis_results.method_key existe');
SELECT has_column('public', 'condition_analysis_results', 'method_version',
  'condition_analysis_results.method_version existe');
SELECT has_column('public', 'condition_analysis_results', 'result_value',
  'condition_analysis_results.result_value existe');
SELECT has_column('public', 'condition_analysis_results', 'confidence',
  'condition_analysis_results.confidence existe');
SELECT has_column('public', 'condition_analysis_results', 'r_squared',
  'condition_analysis_results.r_squared existe');
SELECT has_column('public', 'condition_analysis_results', 'input_window_ids',
  'condition_analysis_results.input_window_ids existe');
SELECT has_column('public', 'condition_analysis_results', 'validation_status',
  'condition_analysis_results.validation_status existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de condition_rules
-- =============================================================================
SELECT has_column('public', 'condition_rules', 'id',
  'condition_rules.id existe');
SELECT has_column('public', 'condition_rules', 'rule_name',
  'condition_rules.rule_name existe');
SELECT has_column('public', 'condition_rules', 'asset_class',
  'condition_rules.asset_class existe');
SELECT has_column('public', 'condition_rules', 'feature_key',
  'condition_rules.feature_key existe');
SELECT has_column('public', 'condition_rules', 'method_key',
  'condition_rules.method_key existe');
SELECT has_column('public', 'condition_rules', 'regime',
  'condition_rules.regime existe');
SELECT has_column('public', 'condition_rules', 'evaluation_type',
  'condition_rules.evaluation_type existe');
SELECT has_column('public', 'condition_rules', 'rule_config',
  'condition_rules.rule_config existe');
SELECT has_column('public', 'condition_rules', 'severity',
  'condition_rules.severity existe');
SELECT has_column('public', 'condition_rules', 'action',
  'condition_rules.action existe');
SELECT has_column('public', 'condition_rules', 'validation_status',
  'condition_rules.validation_status existe');
SELECT has_column('public', 'condition_rules', 'version',
  'condition_rules.version existe');
SELECT has_column('public', 'condition_rules', 'updated_at',
  'condition_rules.updated_at existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_analysis_results', 'id',
  'condition_analysis_results.id es PRIMARY KEY');

SELECT col_is_pk('public', 'condition_rules', 'id',
  'condition_rules.id es PRIMARY KEY');

-- =============================================================================
-- 5. CHECK CONSTRAINTS: analysis_type inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version)
    VALUES ('TEST-ASSET', 'invalid_type', 'rms_velocity_window', '1.0.0')$$,
  '23514',
  NULL,
  'CHECK analysis_type rechaza valor inválido'
);

-- =============================================================================
-- 6. CHECK CONSTRAINTS: analysis_type valores válidos aceptados
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version)
    VALUES ('TEST-ASSET', 'health_index', 'rms_velocity_window', '1.0.0')$$,
  'CHECK analysis_type acepta health_index (válido)'
);
DELETE FROM public.condition_analysis_results WHERE asset_id = 'TEST-ASSET';

-- =============================================================================
-- 7. CHECK CONSTRAINTS: confidence fuera de rango rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version, confidence)
    VALUES ('TEST-ASSET', 'health_index', 'rms_velocity_window', '1.0.0', -0.1)$$,
  '23514',
  NULL,
  'CHECK confidence >= 0 rechaza valor negativo'
);

SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version, confidence)
    VALUES ('TEST-ASSET', 'health_index', 'rms_velocity_window', '1.0.0', 1.5)$$,
  '23514',
  NULL,
  'CHECK confidence <= 1 rechaza valor > 1'
);

-- =============================================================================
-- 8. CHECK CONSTRAINTS: evaluation_type inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action)
    VALUES ('test_bad_eval', 'invalid_eval', '{}', 'warning', 'log_event')$$,
  '23514',
  NULL,
  'CHECK evaluation_type rechaza valor inválido'
);

-- =============================================================================
-- 9. CHECK CONSTRAINTS: evaluation_type válido (compound)
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action)
    VALUES ('test_compound', 'compound', '{"operator":"AND","conditions":[]}', 'warning', 'log_event')$$,
  'CHECK evaluation_type acepta compound (válido)'
);
DELETE FROM public.condition_rules WHERE rule_name = 'test_compound';

-- =============================================================================
-- 10. CHECK CONSTRAINTS: severity inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action)
    VALUES ('test_bad_sev', 'threshold', '{}', 'fatal', 'log_event')$$,
  '23514',
  NULL,
  'CHECK severity rechaza valor inválido'
);

-- =============================================================================
-- 11. CHECK CONSTRAINTS: action inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action)
    VALUES ('test_bad_action', 'threshold', '{}', 'warning', 'send_email')$$,
  '23514',
  NULL,
  'CHECK action rechaza valor fuera de log_event/create_wo/notify'
);

-- =============================================================================
-- 12. CHECK CONSTRAINTS: min_quality_flag inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action, min_quality_flag)
    VALUES ('test_bad_qflag', 'threshold', '{}', 'warning', 'log_event', 'G4')$$,
  '23514',
  NULL,
  'CHECK min_quality_flag rechaza valor inválido'
);

-- =============================================================================
-- 13. CHECK CONSTRAINTS: validation_status inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action, validation_status)
    VALUES ('test_bad_vs', 'threshold', '{}', 'warning', 'log_event', 'production')$$,
  '23514',
  NULL,
  'CHECK validation_status rechaza valor inválido en condition_rules'
);

-- =============================================================================
-- 14. CHECK CONSTRAINTS: validation_status válido (candidate)
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action, validation_status)
    VALUES ('test_valid_vs', 'threshold', '{}', 'warning', 'log_event', 'candidate')$$,
  'CHECK validation_status acepta candidate (válido)'
);
DELETE FROM public.condition_rules WHERE rule_name = 'test_valid_vs';

-- =============================================================================
-- 15. SEED DATA: Cantidad de reglas semilla
-- =============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_rules),
  2,
  'Catálogo contiene 2 reglas semilla'
);

-- =============================================================================
-- 16. SEED DATA: Regla 1 — vibration.rms HIGH
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_rules
    WHERE rule_name = 'vibration.rms HIGH'
      AND version = 1
      AND asset_class = 'centrifugal_pump'
      AND feature_key = 'vibration.rms'
      AND method_key = 'rms_velocity_window'
      AND evaluation_type = 'threshold'
      AND severity = 'critical'
      AND action = 'create_wo'
      AND validation_status = 'draft'
  ),
  'Regla vibration.rms HIGH presente con todos los atributos correctos'
);

-- =============================================================================
-- 17. SEED DATA: Regla 2 — temperature.bearing WARNING
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_rules
    WHERE rule_name = 'temperature.bearing WARNING'
      AND version = 1
      AND asset_class = 'electric_motor'
      AND feature_key = 'temperature.bearing'
      AND method_key = 'window_average'
      AND evaluation_type = 'threshold'
      AND severity = 'warning'
      AND action = 'log_event'
      AND validation_status = 'draft'
  ),
  'Regla temperature.bearing WARNING presente con todos los atributos correctos'
);

-- =============================================================================
-- 18. SEED DATA: rule_config contiene datos específicos
-- =============================================================================
SELECT is(
  (SELECT rule_config->>'threshold' FROM public.condition_rules
   WHERE rule_name = 'vibration.rms HIGH' AND version = 1),
  '7.1',
  'rule_config de vibration.rms HIGH contiene threshold=7.1'
);

SELECT is(
  (SELECT (rule_config->>'duration_windows')::int FROM public.condition_rules
   WHERE rule_name = 'vibration.rms HIGH' AND version = 1),
  3,
  'rule_config de vibration.rms HIGH contiene duration_windows=3'
);

-- =============================================================================
-- 19. FK CONSTRAINT: method_key inválido rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version)
    VALUES ('TEST-ASSET', 'health_index', 'metodo_inexistente', '1.0.0')$$,
  '23503',
  NULL,
  'FK method_key rechaza referencia inexistente en condition_analysis_methods'
);

-- =============================================================================
-- 20. FK CONSTRAINT: feature_definition_id válido aceptado
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version, feature_definition_id)
    VALUES (
      'TEST-ASSET', 'health_index', 'rms_velocity_window', '1.0.0',
      (SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms')
    )$$,
  'FK feature_definition_id acepta referencia válida'
);
DELETE FROM public.condition_analysis_results WHERE asset_id = 'TEST-ASSET';

-- =============================================================================
-- 21. UNIQUE CONSTRAINT: rule_name + version — duplicado rechazado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action, version)
    VALUES ('vibration.rms HIGH', 'threshold', '{}', 'warning', 'log_event', 1)$$,
  '23505',
  NULL,
  'UNIQUE (rule_name, version) rechaza duplicado'
);

-- =============================================================================
-- 22. RLS: Anon no puede INSERT en condition_analysis_results
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_results
    (asset_id, analysis_type, method_key, method_version)
    VALUES ('RLS-TEST', 'health_index', 'rms_velocity_window', '1.0.0')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_analysis_results'
);
RESET ROLE;

-- =============================================================================
-- 23. RLS: Anon no puede INSERT en condition_rules
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_rules
    (rule_name, evaluation_type, rule_config, severity, action)
    VALUES ('rls_test_anon', 'threshold', '{}', 'warning', 'log_event')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_rules'
);
RESET ROLE;

-- =============================================================================
-- 24. RLS: Authenticated puede SELECT de condition_analysis_results
--      (policy: FOR SELECT TO authenticated USING (true))
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT COUNT(*) >= 0 FROM public.condition_analysis_results),
  'RLS: rol authenticated puede SELECT de condition_analysis_results'
);
RESET ROLE;

-- =============================================================================
-- 25. RLS: Authenticated puede SELECT de condition_rules
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT COUNT(*) >= 0 FROM public.condition_rules),
  'RLS: rol authenticated puede SELECT de condition_rules'
);
RESET ROLE;

-- =============================================================================
-- 26. ÍNDICES: condition_analysis_results
-- =============================================================================
SELECT has_index('public', 'condition_analysis_results', 'idx_ar_asset',
  'idx_ar_asset', 'Índice idx_ar_asset existe en condition_analysis_results');

SELECT has_index('public', 'condition_analysis_results', 'idx_ar_type',
  'idx_ar_type', 'Índice idx_ar_type existe en condition_analysis_results');

SELECT has_index('public', 'condition_analysis_results', 'idx_ar_method_key',
  'idx_ar_method_key', 'Índice idx_ar_method_key existe en condition_analysis_results');

SELECT has_index('public', 'condition_analysis_results', 'idx_ar_window_end',
  'idx_ar_window_end', 'Índice idx_ar_window_end existe en condition_analysis_results');

SELECT has_index('public', 'condition_analysis_results', 'idx_ar_created_at',
  'idx_ar_created_at', 'Índice idx_ar_created_at existe en condition_analysis_results');

-- =============================================================================
-- 27. ÍNDICES: condition_rules
-- =============================================================================
SELECT has_index('public', 'condition_rules', 'idx_rules_feature',
  'idx_rules_feature', 'Índice idx_rules_feature existe en condition_rules');

SELECT has_index('public', 'condition_rules', 'idx_rules_asset_class',
  'idx_rules_asset_class', 'Índice idx_rules_asset_class existe en condition_rules');

SELECT has_index('public', 'condition_rules', 'idx_rules_validation',
  'idx_rules_validation', 'Índice idx_rules_validation existe en condition_rules');

SELECT has_index('public', 'condition_rules', 'idx_rules_severity',
  'idx_rules_severity', 'Índice idx_rules_severity existe en condition_rules');

-- =============================================================================
-- 28. TRIGGER: tgr_condition_rules_updated_at existe
-- =============================================================================
SELECT has_trigger('public', 'condition_rules', 'trg_condition_rules_updated_at',
  'Trigger tgr_condition_rules_updated_at existe en condition_rules');

-- =============================================================================
-- 29. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
