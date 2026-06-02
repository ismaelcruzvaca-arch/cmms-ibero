-- =============================================================================
-- Condition Monitoring Source Capabilities + Threshold Catalog — Test Suite (pgTAP)
-- PR 1b: condition_source_capabilities + condition_threshold_catalog
--
-- Assertions: schema, constraints, seed data, CHECKs, FKs, RLS (~52)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_source_thresholds_test.sql
-- =============================================================================

BEGIN;

SELECT plan(52);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_source_capabilities',
  'Tabla condition_source_capabilities existe');

SELECT has_table('public', 'condition_threshold_catalog',
  'Tabla condition_threshold_catalog existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_source_capabilities (13 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_source_capabilities', 'id',
  'condition_source_capabilities.id existe');
SELECT has_column('public', 'condition_source_capabilities', 'source_id',
  'condition_source_capabilities.source_id existe');
SELECT has_column('public', 'condition_source_capabilities', 'source_type',
  'condition_source_capabilities.source_type existe');
SELECT has_column('public', 'condition_source_capabilities', 'asset_id',
  'condition_source_capabilities.asset_id existe');
SELECT has_column('public', 'condition_source_capabilities', 'can_produce',
  'condition_source_capabilities.can_produce existe');
SELECT has_column('public', 'condition_source_capabilities', 'method_key',
  'condition_source_capabilities.method_key existe');
SELECT has_column('public', 'condition_source_capabilities', 'sample_rate_hz',
  'condition_source_capabilities.sample_rate_hz existe');
SELECT has_column('public', 'condition_source_capabilities', 'unit',
  'condition_source_capabilities.unit existe');
SELECT has_column('public', 'condition_source_capabilities', 'quality_expected',
  'condition_source_capabilities.quality_expected existe');
SELECT has_column('public', 'condition_source_capabilities', 'uncertainty_available',
  'condition_source_capabilities.uncertainty_available existe');
SELECT has_column('public', 'condition_source_capabilities', 'validation_status',
  'condition_source_capabilities.validation_status existe');
SELECT has_column('public', 'condition_source_capabilities', 'notes',
  'condition_source_capabilities.notes existe');
SELECT has_column('public', 'condition_source_capabilities', 'created_at',
  'condition_source_capabilities.created_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de condition_threshold_catalog (20 columnas)
--     INCLUYE method_key — columna crítica para G1 fix
-- =============================================================================
SELECT has_column('public', 'condition_threshold_catalog', 'id',
  'condition_threshold_catalog.id existe');
SELECT has_column('public', 'condition_threshold_catalog', 'feature_definition_id',
  'condition_threshold_catalog.feature_definition_id existe');
SELECT has_column('public', 'condition_threshold_catalog', 'method_key',
  'condition_threshold_catalog.method_key existe (CRITICAL: G1 fix)');
SELECT has_column('public', 'condition_threshold_catalog', 'asset_class',
  'condition_threshold_catalog.asset_class existe');
SELECT has_column('public', 'condition_threshold_catalog', 'power_range_min',
  'condition_threshold_catalog.power_range_min existe');
SELECT has_column('public', 'condition_threshold_catalog', 'power_range_max',
  'condition_threshold_catalog.power_range_max existe');
SELECT has_column('public', 'condition_threshold_catalog', 'mounting_type',
  'condition_threshold_catalog.mounting_type existe');
SELECT has_column('public', 'condition_threshold_catalog', 'regime',
  'condition_threshold_catalog.regime existe');
SELECT has_column('public', 'condition_threshold_catalog', 'measurement_location',
  'condition_threshold_catalog.measurement_location existe');
SELECT has_column('public', 'condition_threshold_catalog', 'zone_a_max',
  'condition_threshold_catalog.zone_a_max existe');
SELECT has_column('public', 'condition_threshold_catalog', 'zone_b_max',
  'condition_threshold_catalog.zone_b_max existe');
SELECT has_column('public', 'condition_threshold_catalog', 'zone_c_max',
  'condition_threshold_catalog.zone_c_max existe');
SELECT has_column('public', 'condition_threshold_catalog', 'zone_d_max',
  'condition_threshold_catalog.zone_d_max existe');
SELECT has_column('public', 'condition_threshold_catalog', 'unit',
  'condition_threshold_catalog.unit existe');
SELECT has_column('public', 'condition_threshold_catalog', 'severity',
  'condition_threshold_catalog.severity existe');
SELECT has_column('public', 'condition_threshold_catalog', 'iso_standard',
  'condition_threshold_catalog.iso_standard existe');
SELECT has_column('public', 'condition_threshold_catalog', 'standard_reference',
  'condition_threshold_catalog.standard_reference existe');
SELECT has_column('public', 'condition_threshold_catalog', 'validity_notes',
  'condition_threshold_catalog.validity_notes existe');
SELECT has_column('public', 'condition_threshold_catalog', 'validation_status',
  'condition_threshold_catalog.validation_status existe');
SELECT has_column('public', 'condition_threshold_catalog', 'created_at',
  'condition_threshold_catalog.created_at existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_source_capabilities', 'id',
  'condition_source_capabilities.id es PRIMARY KEY');

SELECT col_is_pk('public', 'condition_threshold_catalog', 'id',
  'condition_threshold_catalog.id es PRIMARY KEY');

-- =============================================================================
-- 5. CONSTRAINTS: Uniqueness
-- =============================================================================
-- source_capabilities: UNIQUE(source_id, can_produce, method_key)
SELECT lives_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('unique_scap_test', 'edge', 'vibration.rms', 'rms_velocity_window')$$,
  'SCAP: insert de capacidad única exitoso'
);

SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('unique_scap_test', 'edge', 'vibration.rms', 'rms_velocity_window')$$,
  '23505',
  NULL,
  'SCAP: UNIQUE(source_id, can_produce, method_key) rechaza duplicado'
);

-- Limpiar registro de prueba SCAP
DELETE FROM public.condition_source_capabilities WHERE source_id = 'unique_scap_test';

-- threshold_catalog: UNIQUE(feature_definition_id, method_key, asset_class, regime, measurement_location)
-- Usamos el vibration.rms feature_definition para la prueba de unicidad
DO $$
DECLARE
  v_fd_id UUID;
BEGIN
  SELECT id INTO v_fd_id FROM public.condition_feature_definitions
    WHERE feature_key = 'vibration.rms' LIMIT 1;

  -- Insertar un threshold de prueba único
  INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime, measurement_location,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard)
  VALUES
    (v_fd_id, 'rms_velocity_window', 'test_unique_class', 'FULL_LOAD', 'test_location',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-UNIQUE-TEST');

  -- Intentar insertar duplicado — debe fallar
  BEGIN
    INSERT INTO public.condition_threshold_catalog
      (feature_definition_id, method_key, asset_class, regime, measurement_location,
       zone_a_max, zone_b_max, zone_c_max, unit, iso_standard)
    VALUES
      (v_fd_id, 'rms_velocity_window', 'test_unique_class', 'FULL_LOAD', 'test_location',
       1.0, 2.0, 3.0, 'mm/s', 'ISO-UNIQUE-TEST-DUP');
    RAISE EXCEPTION 'Debería haber fallado por UNIQUE constraint';
  EXCEPTION WHEN unique_violation THEN
    -- Esperado: constraint funciona
  END;

  -- Limpiar
  DELETE FROM public.condition_threshold_catalog WHERE asset_class = 'test_unique_class';
END;
$$;

SELECT pass('CTHR: UNIQUE(feature_definition_id, method_key, asset_class, regime, measurement_location) funciona');

-- =============================================================================
-- 6. FOREIGN KEYS: source_capabilities.method_key → condition_analysis_methods
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('fk_test_scap', 'edge', 'vibration.rms', 'method_key_que_no_existe')$$,
  '23503',
  NULL,
  'SCAP: FK method_key → analysis_methods rechaza método inexistente'
);

-- =============================================================================
-- 7. FOREIGN KEYS: threshold_catalog.feature_definition_id → condition_feature_definitions
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard)
    VALUES
    ('00000000-0000-0000-0000-000000000000', 'rms_velocity_window', 'test', 'FULL_LOAD',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-TEST')$$,
  '23503',
  NULL,
  'CTHR: FK feature_definition_id → feature_definitions rechaza UUID inexistente'
);

-- =============================================================================
-- 8. CHECK CONSTRAINTS: source_type
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('check_st_test', 'satellite', 'test', 'rms_velocity_window')$$,
  '23514',
  NULL,
  'SCAP: CHECK source_type rechaza valor inválido (satellite)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('check_st_scada', 'scada', 'vibration.rms', 'rms_velocity_window')$$,
  'SCAP: CHECK source_type acepta scada (válido)'
);

-- Limpiar
DELETE FROM public.condition_source_capabilities WHERE source_id IN ('check_st_test', 'check_st_scada');

-- =============================================================================
-- 9. CHECK CONSTRAINTS: validation_status en source_capabilities
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key, validation_status)
    VALUES ('check_vs_test', 'edge', 'vibration.rms', 'rms_velocity_window', 'production')$$,
  '23514',
  NULL,
  'SCAP: CHECK validation_status rechaza valor inválido (production)'
);

-- =============================================================================
-- 10. CHECK CONSTRAINTS: quality_expected
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key, quality_expected)
    VALUES ('check_qe_test', 'edge', 'vibration.rms', 'rms_velocity_window', 'G5')$$,
  '23514',
  NULL,
  'SCAP: CHECK quality_expected rechaza valor inválido (G5)'
);

-- =============================================================================
-- 11. CHECK CONSTRAINTS: regime en threshold_catalog
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard)
    VALUES
    ((SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
     'rms_velocity_window', 'test_bad_regime', 'FULL_SPEED',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-TEST')$$,
  '23514',
  NULL,
  'CTHR: CHECK regime rechaza valor inválido (FULL_SPEED)'
);

-- =============================================================================
-- 12. CHECK CONSTRAINTS: severity en threshold_catalog
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, severity)
    VALUES
    ((SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
     'rms_velocity_window', 'test_bad_sev', 'FULL_LOAD',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-TEST', 'emergency')$$,
  '23514',
  NULL,
  'CTHR: CHECK severity rechaza valor inválido (emergency)'
);

-- =============================================================================
-- 13. SEED DATA: condition_source_capabilities (≥3 capacidades)
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 3 FROM public.condition_source_capabilities),
  'SCAP: Al menos 3 capacidades de fuente registradas en semilla'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_source_capabilities WHERE source_id = 'edge_001'),
  'SCAP: Capacidad edge_001 presente en semilla'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.condition_source_capabilities WHERE source_id = 'manual_route_001'),
  'SCAP: Capacidad manual_route_001 presente en semilla'
);

-- =============================================================================
-- 14. SEED DATA: condition_threshold_catalog (≥4 asset_classes con vibration.rms)
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 8 FROM public.condition_threshold_catalog),
  'CTHR: Al menos 8 thresholds registrados en semilla (4 asset_classes × 2 mountings)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_threshold_catalog
    WHERE asset_class = 'centrifugal_pump'
      AND method_key = 'rms_velocity_window'
      AND regime = 'FULL_LOAD'
  ),
  'CTHR: Umbral centrifugal_pump/rms_velocity_window/FULL_LOAD presente'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_threshold_catalog
    WHERE asset_class = 'electric_motor'
      AND method_key = 'rms_velocity_window'
      AND regime = 'FULL_LOAD'
  ),
  'CTHR: Umbral electric_motor/rms_velocity_window/FULL_LOAD presente'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_threshold_catalog
    WHERE asset_class = 'centrifugal_fan'
      AND method_key = 'rms_velocity_window'
      AND regime = 'FULL_LOAD'
  ),
  'CTHR: Umbral centrifugal_fan/rms_velocity_window/FULL_LOAD presente'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_threshold_catalog
    WHERE asset_class = 'centrifugal_compressor'
      AND method_key = 'rms_velocity_window'
      AND regime = 'FULL_LOAD'
  ),
  'CTHR: Umbral centrifugal_compressor/rms_velocity_window/FULL_LOAD presente'
);

-- =============================================================================
-- 15. SEED DATA: validation_status de thresholds semilla
-- =============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM public.condition_threshold_catalog
   WHERE validation_status = 'bench_validated'
     AND asset_class IN ('centrifugal_pump', 'electric_motor', 'centrifugal_fan', 'centrifugal_compressor')),
  8,
  'CTHR: Los 8 thresholds de asset_class específicas tienen validation_status = bench_validated'
);

-- =============================================================================
-- 16. SEED DATA: umbral genérico (asset_class=NULL) como fallback
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_threshold_catalog
    WHERE asset_class IS NULL
      AND method_key = 'rms_velocity_window'
      AND regime = 'FULL_LOAD'
  ),
  'CTHR: Umbral genérico (asset_class=NULL) presente como fallback'
);

-- =============================================================================
-- 17. RLS: source_capabilities — anon rechazado
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_source_capabilities
    (source_id, source_type, can_produce, method_key)
    VALUES ('rls_test_anon', 'edge', 'vibration.rms', 'rms_velocity_window')$$,
  '42501',
  NULL,
  'RLS SCAP: rol anon no puede INSERT en condition_source_capabilities'
);
RESET ROLE;

-- =============================================================================
-- 18. RLS: source_capabilities — authenticated SELECT funciona
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT COUNT(*) FROM public.condition_source_capabilities$$,
  'RLS SCAP: rol authenticated puede SELECT de condition_source_capabilities'
);
RESET ROLE;

-- =============================================================================
-- 19. RLS: threshold_catalog — anon rechazado
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard)
    VALUES
    ((SELECT id FROM public.condition_feature_definitions WHERE feature_key = 'vibration.rms' LIMIT 1),
     'rms_velocity_window', 'rls_anon_test', 'FULL_LOAD',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-TEST')$$,
  '42501',
  NULL,
  'RLS CTHR: rol anon no puede INSERT en condition_threshold_catalog'
);
RESET ROLE;

-- =============================================================================
-- 20. RLS: threshold_catalog — authenticated SELECT funciona
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT COUNT(*) FROM public.condition_threshold_catalog$$,
  'RLS CTHR: rol authenticated puede SELECT de condition_threshold_catalog'
);
RESET ROLE;

-- =============================================================================
-- 21. CRITICAL: method_key presente en UNIQUE constraint de threshold_catalog
--     (G1 fix — sin esto, thresholds con distinto método para mismo feature colisionan)
-- =============================================================================
DO $$
DECLARE
  v_fd_id UUID;
BEGIN
  SELECT id INTO v_fd_id FROM public.condition_feature_definitions
    WHERE feature_key = 'vibration.rms' LIMIT 1;

  -- Insertar dos thresholds con mismo feature + asset_class + regime + location
  -- pero distinto method_key — DEBEN coexistir
  INSERT INTO public.condition_threshold_catalog
    (feature_definition_id, method_key, asset_class, regime, measurement_location,
     zone_a_max, zone_b_max, zone_c_max, unit, iso_standard, validation_status)
  VALUES
    (v_fd_id, 'rms_velocity_window', 'g1_fix_class', 'FULL_LOAD', 'g1_fix_loc',
     1.0, 2.0, 3.0, 'mm/s', 'ISO-G1FIX-A', 'draft'),
    (v_fd_id, 'peak', 'g1_fix_class', 'FULL_LOAD', 'g1_fix_loc',
     10.0, 20.0, 30.0, 'mm/s', 'ISO-G1FIX-B', 'draft');

  -- Cleanup
  DELETE FROM public.condition_threshold_catalog WHERE asset_class = 'g1_fix_class';
END;
$$;

SELECT pass('CTHR: G1 fix — method_key en UNIQUE permite distintos métodos para mismo (feature,asset_class,regime,location)');

-- =============================================================================
-- 22. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
