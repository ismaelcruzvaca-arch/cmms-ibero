-- =============================================================================
-- Condition Monitoring Catalogs — Test Suite (pgTAP)
-- PR 1a: condition_feature_definitions + condition_analysis_methods
--
-- Assertions: schema, constraints, seed data, CHECKs, FK readiness, RLS (~37)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_catalogs_test.sql
-- =============================================================================

BEGIN;

SELECT plan(39);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_feature_definitions',
  'Tabla condition_feature_definitions existe');

SELECT has_table('public', 'condition_analysis_methods',
  'Tabla condition_analysis_methods existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_feature_definitions (7 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_feature_definitions', 'id',
  'condition_feature_definitions.id existe');
SELECT has_column('public', 'condition_feature_definitions', 'feature_key',
  'condition_feature_definitions.feature_key existe');
SELECT has_column('public', 'condition_feature_definitions', 'unit',
  'condition_feature_definitions.unit existe');
SELECT has_column('public', 'condition_feature_definitions', 'category',
  'condition_feature_definitions.category existe');
SELECT has_column('public', 'condition_feature_definitions', 'description',
  'condition_feature_definitions.description existe');
SELECT has_column('public', 'condition_feature_definitions', 'default_weight',
  'condition_feature_definitions.default_weight existe');
SELECT has_column('public', 'condition_feature_definitions', 'created_at',
  'condition_feature_definitions.created_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de condition_analysis_methods (9 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_analysis_methods', 'id',
  'condition_analysis_methods.id existe');
SELECT has_column('public', 'condition_analysis_methods', 'method_key',
  'condition_analysis_methods.method_key existe');
SELECT has_column('public', 'condition_analysis_methods', 'category',
  'condition_analysis_methods.category existe');
SELECT has_column('public', 'condition_analysis_methods', 'input_features',
  'condition_analysis_methods.input_features existe');
SELECT has_column('public', 'condition_analysis_methods', 'output_features',
  'condition_analysis_methods.output_features existe');
SELECT has_column('public', 'condition_analysis_methods', 'default_parameters',
  'condition_analysis_methods.default_parameters existe');
SELECT has_column('public', 'condition_analysis_methods', 'description',
  'condition_analysis_methods.description existe');
SELECT has_column('public', 'condition_analysis_methods', 'validation_status',
  'condition_analysis_methods.validation_status existe');
SELECT has_column('public', 'condition_analysis_methods', 'created_at',
  'condition_analysis_methods.created_at existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys y Uniqueness
-- =============================================================================
SELECT col_is_pk('public', 'condition_feature_definitions', 'id',
  'condition_feature_definitions.id es PRIMARY KEY');

SELECT col_is_pk('public', 'condition_analysis_methods', 'id',
  'condition_analysis_methods.id es PRIMARY KEY');

SELECT col_is_unique('public', 'condition_feature_definitions', 'feature_key',
  'condition_feature_definitions.feature_key es UNIQUE');

SELECT col_is_unique('public', 'condition_analysis_methods', 'method_key',
  'condition_analysis_methods.method_key es UNIQUE');

-- =============================================================================
-- 5. SEED DATA: Cantidad de registros (12 features, 12 métodos)
-- =============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_feature_definitions),
  12,
  'Catálogo contiene 12 features semilla'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_analysis_methods),
  12,
  'Catálogo contiene 12 métodos semilla'
);

-- =============================================================================
-- 6. SEED DATA: Features específicos presentes
-- =============================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms'),
  'Feature vibration.rms presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_feature_definitions WHERE feature_key = 'manual.leak_detected'),
  'Feature manual.leak_detected presente en catálogo'
);

-- =============================================================================
-- 7. SEED DATA: Métodos específicos presentes
-- =============================================================================
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_analysis_methods WHERE method_key = 'rms_velocity_window'),
  'Método rms_velocity_window presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_analysis_methods WHERE method_key = 'weighted_health_index'),
  'Método weighted_health_index presente en catálogo'
);

-- =============================================================================
-- 8. SEED DATA: validation_status de métodos semilla
-- =============================================================================
SELECT is(
  (SELECT validation_status FROM public.condition_analysis_methods
   WHERE method_key = 'rms_velocity_window'),
  'bench_validated',
  'rms_velocity_window tiene validation_status = bench_validated'
);

SELECT is(
  (SELECT validation_status FROM public.condition_analysis_methods
   WHERE method_key = 'manual_observation'),
  'active',
  'manual_observation tiene validation_status = active'
);

SELECT is(
  (SELECT validation_status FROM public.condition_analysis_methods
   WHERE method_key = 'kalman_filter'),
  'draft',
  'kalman_filter tiene validation_status = draft'
);

-- =============================================================================
-- 9. CHECK CONSTRAINTS: validation_status rechaza valor inválido
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_methods
    (method_key, category, validation_status)
    VALUES ('test_invalid_vs', 'time_domain', 'invalid_status')$$,
  '23514',
  NULL,
  'CHECK validation_status rechaza valor inválido'
);

-- =============================================================================
-- 10. CHECK CONSTRAINTS: validation_status acepta valor válido
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_analysis_methods
    (method_key, category, input_features, output_features, validation_status)
    VALUES ('test_valid_vs', 'time_domain', '{}', '{}', 'candidate')$$,
  'CHECK validation_status acepta candidate (válido)'
);

-- Limpiar registro de prueba
DELETE FROM public.condition_analysis_methods WHERE method_key = 'test_valid_vs';

-- =============================================================================
-- 11. CHECK CONSTRAINTS: default_weight >= 0 en feature_definitions
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_feature_definitions
    (feature_key, unit, category, default_weight)
    VALUES ('test_neg_weight', 'test', 'test', -0.5)$$,
  '23514',
  NULL,
  'CHECK default_weight >= 0 rechaza valor negativo'
);

-- =============================================================================
-- 12. CHECK CONSTRAINTS: category en analysis_methods
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_analysis_methods
    (method_key, category, validation_status)
    VALUES ('test_bad_cat', 'invalid_category', 'draft')$$,
  '23514',
  NULL,
  'CHECK category rechaza valor fuera de time_domain/frequency_domain/statistical/model_based/hybrid'
);

-- =============================================================================
-- 13. FK READINESS: feature_definitions.id puede ser referenciado
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_feature_definitions
    (feature_key, unit, category, description)
    VALUES ('test_fk_readiness', 'test', 'test', 'Registro para probar FK readiness')$$,
  'Insert en feature_definitions exitoso (FK readiness)'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_feature_definitions WHERE feature_key = 'test_fk_readiness'),
  'Feature test_fk_readiness existe y puede ser referenciado por FK'
);

-- =============================================================================
-- 14. RLS: Anon no puede INSERT en feature_definitions
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_feature_definitions
    (feature_key, unit, category)
    VALUES ('rls_test_anon', 'test', 'test')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_feature_definitions'
);
RESET ROLE;

-- =============================================================================
-- 15. RLS: Authenticated puede SELECT de feature_definitions
--      (policy: FOR SELECT TO authenticated USING (true))
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT COUNT(*) > 0 FROM public.condition_feature_definitions),
  'RLS: rol authenticated puede SELECT de condition_feature_definitions'
);
RESET ROLE;

-- =============================================================================
-- 16. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
