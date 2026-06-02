-- =============================================================================
-- Condition Monitoring Ingest Schema — Test Suite (pgTAP)
-- PR 1c: condition_windows + condition_feature_values
--
-- Assertions: schema, constraints, FKs, CHECKs, unique, round-trip, RLS (~45)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_ingest_test.sql
-- =============================================================================

BEGIN;

SELECT plan(45);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_windows',
  'Tabla condition_windows existe');

SELECT has_table('public', 'condition_feature_values',
  'Tabla condition_feature_values existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_windows (12 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_windows', 'id',
  'condition_windows.id existe');
SELECT has_column('public', 'condition_windows', 'external_window_id',
  'condition_windows.external_window_id existe');
SELECT has_column('public', 'condition_windows', 'asset_id',
  'condition_windows.asset_id existe');
SELECT has_column('public', 'condition_windows', 'source_id',
  'condition_windows.source_id existe');
SELECT has_column('public', 'condition_windows', 'source_type',
  'condition_windows.source_type existe');
SELECT has_column('public', 'condition_windows', 'window_start',
  'condition_windows.window_start existe');
SELECT has_column('public', 'condition_windows', 'window_end',
  'condition_windows.window_end existe');
SELECT has_column('public', 'condition_windows', 'pipeline_version',
  'condition_windows.pipeline_version existe');
SELECT has_column('public', 'condition_windows', 'config_version',
  'condition_windows.config_version existe');
SELECT has_column('public', 'condition_windows', 'operational_context',
  'condition_windows.operational_context existe');
SELECT has_column('public', 'condition_windows', 'status',
  'condition_windows.status existe');
SELECT has_column('public', 'condition_windows', 'created_at',
  'condition_windows.created_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de condition_feature_values (14 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_feature_values', 'id',
  'condition_feature_values.id existe');
SELECT has_column('public', 'condition_feature_values', 'window_id',
  'condition_feature_values.window_id existe');
SELECT has_column('public', 'condition_feature_values', 'feature_definition_id',
  'condition_feature_values.feature_definition_id existe');
SELECT has_column('public', 'condition_feature_values', 'value',
  'condition_feature_values.value existe');
SELECT has_column('public', 'condition_feature_values', 'unit',
  'condition_feature_values.unit existe');
SELECT has_column('public', 'condition_feature_values', 'quality_flag',
  'condition_feature_values.quality_flag existe');
SELECT has_column('public', 'condition_feature_values', 'method_key',
  'condition_feature_values.method_key existe');
SELECT has_column('public', 'condition_feature_values', 'method_version',
  'condition_feature_values.method_version existe');
SELECT has_column('public', 'condition_feature_values', 'parameters',
  'condition_feature_values.parameters existe');
SELECT has_column('public', 'condition_feature_values', 'uncertainty',
  'condition_feature_values.uncertainty existe');
SELECT has_column('public', 'condition_feature_values', 'confidence',
  'condition_feature_values.confidence existe');
SELECT has_column('public', 'condition_feature_values', 'measurement_point_id',
  'condition_feature_values.measurement_point_id existe');
SELECT has_column('public', 'condition_feature_values', 'sample_count',
  'condition_feature_values.sample_count existe');
SELECT has_column('public', 'condition_feature_values', 'created_at',
  'condition_feature_values.created_at existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_windows', 'id',
  'condition_windows.id es PRIMARY KEY');
SELECT col_is_pk('public', 'condition_feature_values', 'id',
  'condition_feature_values.id es PRIMARY KEY');

-- =============================================================================
-- 5. CONSTRAINTS: Uniqueness
-- =============================================================================
SELECT col_is_unique('public', 'condition_windows', 'external_window_id',
  'condition_windows.external_window_id es UNIQUE');

-- =============================================================================
-- 6. FOREIGN KEYS: condition_feature_values FK constraints
-- =============================================================================
SELECT col_is_fk('public', 'condition_feature_values', 'window_id',
  'condition_feature_values.window_id es FK → condition_windows');

SELECT col_is_fk('public', 'condition_feature_values', 'feature_definition_id',
  'condition_feature_values.feature_definition_id es FK → condition_feature_definitions');

-- =============================================================================
-- 7. CHECK CONSTRAINTS: quality_flag (G0-G3) en condition_feature_values
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end)
    VALUES ('test_check_fv_g0', 'ASSET-001', 'src-001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z')$$,
  NULL,
  NULL,
  'Setup: ventana de prueba insertada para test de CHECK quality_flag'
);

SELECT throws_ok(
  $$INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version)
    SELECT w.id, fd.id, 3.2, 'mm/s', 'INVALID',
           'rms_velocity_window', '0.1.0'
    FROM public.condition_windows w
    CROSS JOIN public.condition_feature_definitions fd
    WHERE w.external_window_id = 'test_check_fv_g0'
      AND fd.feature_key = 'vibration.rms'
    LIMIT 1$$,
  '23514',
  NULL,
  'CHECK quality_flag rechaza valor inválido (INVALID)'
);

-- =============================================================================
-- 8. CHECK CONSTRAINTS: quality_flag acepta valores válidos (G0-G3)
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version)
    SELECT w.id, fd.id, 3.2, 'mm/s', 'G0',
           'rms_velocity_window', '0.1.0'
    FROM public.condition_windows w
    CROSS JOIN public.condition_feature_definitions fd
    WHERE w.external_window_id = 'test_check_fv_g0'
      AND fd.feature_key = 'vibration.rms'
    LIMIT 1$$,
  'CHECK quality_flag acepta G0 (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version)
    SELECT w.id, fd.id, 3.2, 'mm/s', 'G1',
           'rms_velocity_window', '0.1.0'
    FROM public.condition_windows w
    CROSS JOIN public.condition_feature_definitions fd
    WHERE w.external_window_id = 'test_check_fv_g0'
      AND fd.feature_key = 'vibration.rms'
    LIMIT 1$$,
  'CHECK quality_flag acepta G1 (válido)'
);

-- =============================================================================
-- 9. CHECK CONSTRAINTS: status en condition_windows
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end, status)
    VALUES ('test_status_bad', 'ASSET-001', 'src-001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z', 'INVALID_STATUS')$$,
  '23514',
  NULL,
  'CHECK status rechaza valor inválido'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end, status)
    VALUES ('test_status_ok', 'ASSET-001', 'src-001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z', 'received')$$,
  'CHECK status acepta received (válido)'
);

-- =============================================================================
-- 10. CHECK CONSTRAINTS: confidence [0, 1] en feature_values
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version, confidence)
    SELECT w.id, fd.id, 3.2, 'mm/s', 'G0',
           'rms_velocity_window', '0.1.0', -0.5
    FROM public.condition_windows w
    CROSS JOIN public.condition_feature_definitions fd
    WHERE w.external_window_id = 'test_check_fv_g0'
      AND fd.feature_key = 'vibration.rms'
    LIMIT 1$$,
  '23514',
  NULL,
  'CHECK confidence >= 0 rechaza valor negativo'
);

SELECT throws_ok(
  $$INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version, confidence)
    SELECT w.id, fd.id, 3.2, 'mm/s', 'G0',
           'rms_velocity_window', '0.1.0', 1.5
    FROM public.condition_windows w
    CROSS JOIN public.condition_feature_definitions fd
    WHERE w.external_window_id = 'test_check_fv_g0'
      AND fd.feature_key = 'vibration.rms'
    LIMIT 1$$,
  '23514',
  NULL,
  'CHECK confidence <= 1 rechaza valor > 1'
);

-- =============================================================================
-- 11. UNIQUE: external_window_id rechaza duplicado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end)
    VALUES ('test_status_ok', 'ASSET-002', 'src-002', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z')$$,
  '23505',
  NULL,
  'UNIQUE external_window_id rechaza duplicado'
);

-- =============================================================================
-- 12. FK CASCADE: eliminar ventana elimina sus feature_values
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_feature_values fv
    JOIN public.condition_windows w ON w.id = fv.window_id
    WHERE w.external_window_id = 'test_check_fv_g0'
  ),
  'Feature values asociados a ventana test_check_fv_g0 existen'
);

-- Eliminar ventana debe eliminar sus feature_values por CASCADE
DELETE FROM public.condition_windows WHERE external_window_id = 'test_check_fv_g0';

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_windows WHERE external_window_id = 'test_check_fv_g0'
  ),
  'Ventana test_check_fv_g0 eliminada (verificación FK CASCADE)'
);

-- =============================================================================
-- 13. INSERT ROUND-TRIP: datos válidos persisten correctamente
-- =============================================================================
-- Insertar una ventana con dos features
WITH new_window AS (
  INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end,
     pipeline_version, config_version, operational_context)
    VALUES ('test_roundtrip', 'BANDA-TR-01', 'edge_001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z',
            'v2.1.0', 'cfg-20260601', '{"regime":"FULL_LOAD","rpm":1500,"load_pct":85}')
    RETURNING id
)
INSERT INTO public.condition_feature_values
  (window_id, feature_definition_id, value, unit, quality_flag,
   method_key, method_version, parameters, uncertainty, confidence,
   measurement_point_id, sample_count)
SELECT
  nw.id, fd.id, 3.2, 'mm/s', 'G0',
  'rms_velocity_window', '0.1.0',
  '{"window_s": 1.0, "filter": "10-1000Hz"}',
  0.25, 0.95, 'motor_de', 2048
FROM new_window nw
CROSS JOIN public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms';

-- Verificar que la ventana se insertó con todos los campos
SELECT is(
  (SELECT status FROM public.condition_windows WHERE external_window_id = 'test_roundtrip'),
  'received',
  'Ventana insertada con status DEFAULT = received'
);

SELECT is(
  (SELECT operational_context->>'regime' FROM public.condition_windows WHERE external_window_id = 'test_roundtrip'),
  'FULL_LOAD',
  'Ventana insertada con operational_context.regime = FULL_LOAD'
);

SELECT is(
  (SELECT pipeline_version FROM public.condition_windows WHERE external_window_id = 'test_roundtrip'),
  'v2.1.0',
  'Ventana insertada con pipeline_version = v2.1.0'
);

-- Verificar que el feature value se insertó con todos los metadatos
SELECT is(
  (SELECT value::numeric(10,2) FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  3.2::numeric(10,2),
  'Feature value insertado con valor 3.2'
);

SELECT is(
  (SELECT quality_flag FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  'G0',
  'Feature value insertado con quality_flag = G0'
);

SELECT is(
  (SELECT method_key FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  'rms_velocity_window',
  'Feature value insertado con method_key = rms_velocity_window'
);

SELECT is(
  (SELECT method_version FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  '0.1.0',
  'Feature value insertado con method_version = 0.1.0'
);

SELECT is(
  (SELECT uncertainty::numeric(10,2) FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  0.25::numeric(10,2),
  'Feature value insertado con uncertainty = 0.25'
);

SELECT is(
  (SELECT confidence::numeric(10,2) FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  0.95::numeric(10,2),
  'Feature value insertado con confidence = 0.95'
);

SELECT is(
  (SELECT sample_count FROM public.condition_feature_values fv
   JOIN public.condition_windows w ON w.id = fv.window_id
   WHERE w.external_window_id = 'test_roundtrip'),
  2048,
  'Feature value insertado con sample_count = 2048'
);

-- =============================================================================
-- 14. FK: feature_definition_id debe referenciar un registro existente
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end)
    VALUES ('test_fk_bad', 'ASSET-001', 'src-001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z');
  INSERT INTO public.condition_feature_values
    (window_id, feature_definition_id, value, unit, quality_flag, method_key, method_version)
    SELECT w.id, '00000000-0000-0000-0000-000000000000', 3.2, 'mm/s', 'G0',
           'rms_velocity_window', '0.1.0'
    FROM public.condition_windows w
    WHERE w.external_window_id = 'test_fk_bad'
    LIMIT 1$$,
  '23503',
  NULL,
  'FK feature_definition_id rechaza UUID inexistente'
);

-- Limpiar ventana de prueba FK
DELETE FROM public.condition_windows WHERE external_window_id = 'test_fk_bad';

-- =============================================================================
-- 15. RLS: condition_windows policies existen
-- =============================================================================
SELECT policies_are('public', 'condition_windows',
  ARRAY['condition_windows_select', 'condition_windows_insert',
        'condition_windows_update', 'condition_windows_delete'],
  'RLS: condition_windows tiene 4 políticas');

-- =============================================================================
-- 16. RLS: condition_feature_values policies existen
-- =============================================================================
SELECT policies_are('public', 'condition_feature_values',
  ARRAY['condition_feature_values_select', 'condition_feature_values_insert',
        'condition_feature_values_update', 'condition_feature_values_delete'],
  'RLS: condition_feature_values tiene 4 políticas');

-- =============================================================================
-- 17. RLS: role anon no puede INSERT en condition_windows
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_windows
    (external_window_id, asset_id, source_id, source_type, window_start, window_end)
    VALUES ('rls_test_anon', 'ASSET-001', 'src-001', 'edge',
            '2026-06-01T10:00:00Z', '2026-06-01T10:01:00Z')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_windows'
);
RESET ROLE;

-- =============================================================================
-- 18. RLS: authenticated puede SELECT de condition_windows
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT COUNT(*) FROM public.condition_windows$$,
  'RLS: rol authenticated puede SELECT de condition_windows'
);
RESET ROLE;

-- =============================================================================
-- 19. Índices creados
-- =============================================================================
SELECT has_index('public', 'condition_windows', 'idx_windows_asset',
  'condition_windows', 'idx_windows_asset', 'Índice idx_windows_asset existe');
SELECT has_index('public', 'condition_windows', 'idx_windows_source',
  'condition_windows', 'idx_windows_source', 'Índice idx_windows_source existe');
SELECT has_index('public', 'condition_windows', 'idx_windows_start',
  'condition_windows', 'idx_windows_start', 'Índice idx_windows_start existe');
SELECT has_index('public', 'condition_windows', 'idx_windows_status',
  'condition_windows', 'idx_windows_status', 'Índice idx_windows_status existe');

SELECT has_index('public', 'condition_feature_values', 'idx_fv_window',
  'condition_feature_values', 'idx_fv_window', 'Índice idx_fv_window existe');
SELECT has_index('public', 'condition_feature_values', 'idx_fv_feature',
  'condition_feature_values', 'idx_fv_feature', 'Índice idx_fv_feature existe');
SELECT has_index('public', 'condition_feature_values', 'idx_fv_quality',
  'condition_feature_values', 'idx_fv_quality', 'Índice idx_fv_quality existe');
SELECT has_index('public', 'condition_feature_values', 'idx_fv_method',
  'condition_feature_values', 'idx_fv_method', 'Índice idx_fv_method existe');

-- =============================================================================
-- 20. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
