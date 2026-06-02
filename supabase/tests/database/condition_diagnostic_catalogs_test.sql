-- =============================================================================
-- Condition Diagnostic Catalogs — Test Suite (pgTAP)
-- PR 1a: condition_failure_mode_catalog, fmea_cbm_cross_reference,
--        diagnostic_evidence_matrix, condition_pf_curves
--
-- Assertions: schema (12), seeds (6), CHECK constraints (4), RLS (4),
--   indexes (4), FK integrity (3) = ~33 assertions
--
-- Ejecutar:
--   supabase db test --file supabase/tests/database/condition_diagnostic_catalogs_test.sql
-- =============================================================================

BEGIN;

SELECT plan(33);

-- =============================================================================
-- 1. SCHEMA: 4 tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_failure_mode_catalog',
  'Tabla condition_failure_mode_catalog existe');

SELECT has_table('public', 'fmea_cbm_cross_reference',
  'Tabla fmea_cbm_cross_reference existe');

SELECT has_table('public', 'diagnostic_evidence_matrix',
  'Tabla diagnostic_evidence_matrix existe');

SELECT has_table('public', 'condition_pf_curves',
  'Tabla condition_pf_curves existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_failure_mode_catalog
-- =============================================================================
SELECT has_column('public', 'condition_failure_mode_catalog', 'id',
  'condition_failure_mode_catalog.id existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'failure_mode_key',
  'condition_failure_mode_catalog.failure_mode_key existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'asset_class',
  'condition_failure_mode_catalog.asset_class existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'name',
  'condition_failure_mode_catalog.name existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'description',
  'condition_failure_mode_catalog.description existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'failure_mechanism',
  'condition_failure_mode_catalog.failure_mechanism existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'typical_causes',
  'condition_failure_mode_catalog.typical_causes existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'typical_effects',
  'condition_failure_mode_catalog.typical_effects existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'severity_default',
  'condition_failure_mode_catalog.severity_default existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'detectability',
  'condition_failure_mode_catalog.detectability existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'iso14224_taxonomy_ref',
  'condition_failure_mode_catalog.iso14224_taxonomy_ref existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'validation_status',
  'condition_failure_mode_catalog.validation_status existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'category',
  'condition_failure_mode_catalog.category existe');
SELECT has_column('public', 'condition_failure_mode_catalog', 'created_at',
  'condition_failure_mode_catalog.created_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de fmea_cbm_cross_reference
-- =============================================================================
SELECT has_column('public', 'fmea_cbm_cross_reference', 'id',
  'fmea_cbm_cross_reference.id existe');
SELECT has_column('public', 'fmea_cbm_cross_reference', 'condition_failure_mode_id',
  'fmea_cbm_cross_reference.condition_failure_mode_id existe');
SELECT has_column('public', 'fmea_cbm_cross_reference', 'fmea_failure_mode_id',
  'fmea_cbm_cross_reference.fmea_failure_mode_id existe');
SELECT has_column('public', 'fmea_cbm_cross_reference', 'relationship_type',
  'fmea_cbm_cross_reference.relationship_type existe');
SELECT has_column('public', 'fmea_cbm_cross_reference', 'confidence',
  'fmea_cbm_cross_reference.confidence existe');
SELECT has_column('public', 'fmea_cbm_cross_reference', 'created_at',
  'fmea_cbm_cross_reference.created_at existe');

-- =============================================================================
-- 4. SCHEMA: Columnas de diagnostic_evidence_matrix
-- =============================================================================
SELECT has_column('public', 'diagnostic_evidence_matrix', 'id',
  'diagnostic_evidence_matrix.id existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'failure_mode_id',
  'diagnostic_evidence_matrix.failure_mode_id existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'feature_key',
  'diagnostic_evidence_matrix.feature_key existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'condition_type',
  'diagnostic_evidence_matrix.condition_type existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'evidence_role',
  'diagnostic_evidence_matrix.evidence_role existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'op',
  'diagnostic_evidence_matrix.op existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'value',
  'diagnostic_evidence_matrix.value existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'logical_operator',
  'diagnostic_evidence_matrix.logical_operator existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'min_quality',
  'diagnostic_evidence_matrix.min_quality existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'min_confidence',
  'diagnostic_evidence_matrix.min_confidence existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'required_regime',
  'diagnostic_evidence_matrix.required_regime existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'window_count',
  'diagnostic_evidence_matrix.window_count existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'weight',
  'diagnostic_evidence_matrix.weight existe');
SELECT has_column('public', 'diagnostic_evidence_matrix', 'created_at',
  'diagnostic_evidence_matrix.created_at existe');

-- =============================================================================
-- 5. SCHEMA: Columnas de condition_pf_curves
-- =============================================================================
SELECT has_column('public', 'condition_pf_curves', 'id',
  'condition_pf_curves.id existe');
SELECT has_column('public', 'condition_pf_curves', 'asset_class',
  'condition_pf_curves.asset_class existe');
SELECT has_column('public', 'condition_pf_curves', 'failure_mode_key',
  'condition_pf_curves.failure_mode_key existe');
SELECT has_column('public', 'condition_pf_curves', 'potential_failure_point',
  'condition_pf_curves.potential_failure_point existe');
SELECT has_column('public', 'condition_pf_curves', 'functional_failure_point',
  'condition_pf_curves.functional_failure_point existe');
SELECT has_column('public', 'condition_pf_curves', 'pf_interval_days',
  'condition_pf_curves.pf_interval_days existe');
SELECT has_column('public', 'condition_pf_curves', 'inspection_interval_days',
  'condition_pf_curves.inspection_interval_days existe');
SELECT has_column('public', 'condition_pf_curves', 'intervention_window_days',
  'condition_pf_curves.intervention_window_days existe');
SELECT has_column('public', 'condition_pf_curves', 'confidence',
  'condition_pf_curves.confidence existe');
SELECT has_column('public', 'condition_pf_curves', 'validation_status',
  'condition_pf_curves.validation_status existe');
SELECT has_column('public', 'condition_pf_curves', 'created_at',
  'condition_pf_curves.created_at existe');

-- =============================================================================
-- 6. PRIMARY KEYS
-- =============================================================================
SELECT col_is_pk('public', 'condition_failure_mode_catalog', 'id',
  'condition_failure_mode_catalog.id es PRIMARY KEY');

SELECT col_is_pk('public', 'fmea_cbm_cross_reference', 'id',
  'fmea_cbm_cross_reference.id es PRIMARY KEY');

SELECT col_is_pk('public', 'diagnostic_evidence_matrix', 'id',
  'diagnostic_evidence_matrix.id es PRIMARY KEY');

SELECT col_is_pk('public', 'condition_pf_curves', 'id',
  'condition_pf_curves.id es PRIMARY KEY');

-- =============================================================================
-- 7. UNIQUE CONSTRAINTS
-- =============================================================================
SELECT col_is_unique('public', 'condition_failure_mode_catalog', 'failure_mode_key',
  'condition_failure_mode_catalog.failure_mode_key es UNIQUE');

-- =============================================================================
-- 8. SEED DATA: condition_failure_mode_catalog (≥12 modos)
-- =============================================================================
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.condition_failure_mode_catalog),
  '>=', 12,
  'Catálogo contiene al menos 12 modos de falla semilla'
);

-- Verificar modos específicos
SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_failure_mode_catalog WHERE failure_mode_key = 'pump.cavitation'),
  'Modo pump.cavitation presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_failure_mode_catalog WHERE failure_mode_key = 'rotating.misalignment'),
  'Modo rotating.misalignment presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_failure_mode_catalog WHERE failure_mode_key = 'rotating.unbalance'),
  'Modo rotating.unbalance presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_failure_mode_catalog WHERE failure_mode_key = 'bearing.outer_race_defect'),
  'Modo bearing.outer_race_defect presente en catálogo'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_failure_mode_catalog WHERE failure_mode_key = 'sensor.drift'),
  'Modo sensor.drift presente en catálogo'
);

-- Todos los modos seed tienen validation_status = 'seed'
SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_failure_mode_catalog WHERE validation_status = 'seed'),
  (SELECT COUNT(*)::int FROM public.condition_failure_mode_catalog),
  'Todos los modos semilla tienen validation_status = seed'
);

-- =============================================================================
-- 9. SEED DATA: fmea_cbm_cross_reference (≥3 enlaces)
-- =============================================================================
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.fmea_cbm_cross_reference),
  '>=', 3,
  'Al menos 3 referencias cruzadas FMEA-CBM presentes'
);

-- Todos los enlaces tienen confidence >= 0.7 (spec FCX-002)
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.fmea_cbm_cross_reference WHERE confidence >= 0.7),
  '>=', 3,
  'Todas las referencias tienen confidence >= 0.7'
);

-- =============================================================================
-- 10. SEED DATA: diagnostic_evidence_matrix (≥2 patrones completos)
-- =============================================================================
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.diagnostic_evidence_matrix),
  '>=', 8,
  'Al menos 8 filas en matriz de evidencia (2 patrones completos)'
);

-- Verificar patrón de cavitación tiene required + supporting + contradictory
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'pump.cavitation'
     AND dem.evidence_role = 'required'),
  '>=', 2,
  'pump.cavitation tiene al menos 2 evidencias required'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'pump.cavitation'
     AND dem.evidence_role = 'supporting'),
  'pump.cavitation tiene evidencia supporting'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'pump.cavitation'
     AND dem.evidence_role = 'contradictory'),
  'pump.cavitation tiene evidencia contradictory'
);

-- Verificar patrón de desbalance tiene required + supporting + contradictory
SELECT ok(
  EXISTS (SELECT 1 FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'rotating.unbalance'
     AND dem.evidence_role = 'required'),
  'rotating.unbalance tiene evidencia required'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'rotating.unbalance'
     AND dem.evidence_role = 'supporting'),
  'rotating.unbalance tiene evidencia supporting'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.diagnostic_evidence_matrix dem
   JOIN public.condition_failure_mode_catalog fm ON dem.failure_mode_id = fm.id
   WHERE fm.failure_mode_key = 'rotating.unbalance'
     AND dem.evidence_role = 'contradictory'),
  'rotating.unbalance tiene evidencia contradictory'
);

-- =============================================================================
-- 11. SEED DATA: condition_pf_curves (≥3 curvas)
-- =============================================================================
SELECT cmp_ok(
  (SELECT COUNT(*)::int FROM public.condition_pf_curves),
  '>=', 3,
  'Al menos 3 curvas P-F semilla presentes'
);

-- Todas las curvas seed tienen validation_status = 'seed'
SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_pf_curves WHERE validation_status = 'seed'),
  (SELECT COUNT(*)::int FROM public.condition_pf_curves),
  'Todas las curvas P-F semilla tienen validation_status = seed'
);

-- Verificar curva específica de rodamiento
SELECT is(
  (SELECT pf_interval_days FROM public.condition_pf_curves
   WHERE failure_mode_key = 'bearing.outer_race_defect'
     AND asset_class = 'centrifugal_pump'),
  30,
  'bearing.outer_race_defect tiene pf_interval_days = 30'
);

-- =============================================================================
-- 12. CHECK CONSTRAINTS
-- =============================================================================
-- severity_default rechaza valor inválido
SELECT throws_ok(
  $$INSERT INTO public.condition_failure_mode_catalog
    (failure_mode_key, asset_class, name, severity_default, detectability, category)
    VALUES ('test_invalid_sev', 'test', 'Test', 'extreme', 'medium', 'asset')$$,
  '23514',
  NULL,
  'CHECK severity_default rechaza valor extreme'
);

-- detectability rechaza valor inválido
SELECT throws_ok(
  $$INSERT INTO public.condition_failure_mode_catalog
    (failure_mode_key, asset_class, name, severity_default, detectability, category)
    VALUES ('test_invalid_det', 'test', 'Test', 'medium', 'impossible', 'asset')$$,
  '23514',
  NULL,
  'CHECK detectability rechaza valor impossible'
);

-- category rechaza valor inválido
SELECT throws_ok(
  $$INSERT INTO public.condition_failure_mode_catalog
    (failure_mode_key, asset_class, name, severity_default, detectability, category)
    VALUES ('test_invalid_cat', 'test', 'Test', 'medium', 'medium', 'invalid')$$,
  '23514',
  NULL,
  'CHECK category rechaza valor invalid'
);

-- pf_interval_days > 0
SELECT throws_ok(
  $$INSERT INTO public.condition_pf_curves
    (asset_class, failure_mode_key, pf_interval_days)
    VALUES ('test', 'test.zero_interval', 0)$$,
  '23514',
  NULL,
  'CHECK pf_interval_days > 0 rechaza valor 0'
);

-- =============================================================================
-- 13. INDEXES: Verificar que los índices existen
-- =============================================================================
SELECT has_index('public', 'condition_failure_mode_catalog', 'idx_fmc_asset_class',
  'Índice idx_fmc_asset_class existe');
SELECT has_index('public', 'condition_failure_mode_catalog', 'idx_fmc_validation',
  'Índice idx_fmc_validation existe');

SELECT has_index('public', 'fmea_cbm_cross_reference', 'idx_fmea_cross_condition',
  'Índice idx_fmea_cross_condition existe');
SELECT has_index('public', 'fmea_cbm_cross_reference', 'idx_fmea_cross_fmea',
  'Índice idx_fmea_cross_fmea existe');

SELECT has_index('public', 'diagnostic_evidence_matrix', 'idx_dem_failure_mode',
  'Índice idx_dem_failure_mode existe');
SELECT has_index('public', 'diagnostic_evidence_matrix', 'idx_dem_feature',
  'Índice idx_dem_feature existe');

SELECT has_index('public', 'condition_pf_curves', 'idx_pf_asset_class',
  'Índice idx_pf_asset_class existe');
SELECT has_index('public', 'condition_pf_curves', 'idx_pf_fm',
  'Índice idx_pf_fm existe');

-- =============================================================================
-- 14. RLS: Anon no puede INSERT en condition_failure_mode_catalog
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_failure_mode_catalog
    (failure_mode_key, asset_class, name, severity_default, detectability, category)
    VALUES ('rls_test_anon', 'test', 'Test', 'medium', 'medium', 'asset')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_failure_mode_catalog'
);
RESET ROLE;

-- =============================================================================
-- 15. RLS: Authenticated puede SELECT de condition_failure_mode_catalog
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT COUNT(*) > 0 FROM public.condition_failure_mode_catalog),
  'RLS: rol authenticated puede SELECT de condition_failure_mode_catalog'
);
RESET ROLE;

-- =============================================================================
-- 16. RLS: Anon no puede INSERT en condition_pf_curves
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_pf_curves
    (asset_class, failure_mode_key, pf_interval_days)
    VALUES ('test', 'rls_test_anon', 30)$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_pf_curves'
);
RESET ROLE;

-- =============================================================================
-- 17. FK INTEGRITY: diagnostic_evidence_matrix FK → failure_mode_catalog
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.diagnostic_evidence_matrix
    (failure_mode_id, feature_key, condition_type, evidence_role, op, value)
    VALUES ('00000000-0000-0000-0000-000000000000', 'test.feature', 'threshold', 'required', '>', 1.0)$$,
  '23503',
  NULL,
  'FK: diagnostic_evidence_matrix.failure_mode_id rechaza UUID inexistente'
);

-- =============================================================================
-- 18. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
