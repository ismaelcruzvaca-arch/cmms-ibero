-- =============================================================================
-- Condition Import Staging + Extended Capabilities — Test Suite (pgTAP)
-- PR 2 Slice 2a: condition_import_batches + condition_import_rows + seeds
--
-- Assertions: schema, CHECKs, FK cascade, RLS, extended capabilities (~20)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_staging_test.sql
-- =============================================================================

BEGIN;

SELECT plan(24);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_import_batches',
  'Tabla condition_import_batches existe');

SELECT has_table('public', 'condition_import_rows',
  'Tabla condition_import_rows existe');

-- =============================================================================
-- 2. SCHEMA: Columnas clave de condition_import_batches
-- =============================================================================
SELECT has_column('public', 'condition_import_batches', 'id',
  'condition_import_batches.id existe');
SELECT has_column('public', 'condition_import_batches', 'batch_id',
  'condition_import_batches.batch_id existe');
SELECT has_column('public', 'condition_import_batches', 'file_name',
  'condition_import_batches.file_name existe');
SELECT has_column('public', 'condition_import_batches', 'file_hash',
  'condition_import_batches.file_hash existe');
SELECT has_column('public', 'condition_import_batches', 'row_count',
  'condition_import_batches.row_count existe');
SELECT has_column('public', 'condition_import_batches', 'valid_rows',
  'condition_import_batches.valid_rows existe');
SELECT has_column('public', 'condition_import_batches', 'invalid_rows',
  'condition_import_batches.invalid_rows existe');
SELECT has_column('public', 'condition_import_batches', 'source_id',
  'condition_import_batches.source_id existe');
SELECT has_column('public', 'condition_import_batches', 'status',
  'condition_import_batches.status existe');
SELECT has_column('public', 'condition_import_batches', 'column_mapping',
  'condition_import_batches.column_mapping existe');
SELECT has_column('public', 'condition_import_batches', 'error_summary',
  'condition_import_batches.error_summary existe');
SELECT has_column('public', 'condition_import_batches', 'created_by',
  'condition_import_batches.created_by existe');
SELECT has_column('public', 'condition_import_batches', 'confirmed_at',
  'condition_import_batches.confirmed_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas clave de condition_import_rows
-- =============================================================================
SELECT has_column('public', 'condition_import_rows', 'id',
  'condition_import_rows.id existe');
SELECT has_column('public', 'condition_import_rows', 'batch_id',
  'condition_import_rows.batch_id existe');
SELECT has_column('public', 'condition_import_rows', 'row_number',
  'condition_import_rows.row_number existe');
SELECT has_column('public', 'condition_import_rows', 'raw_data',
  'condition_import_rows.raw_data existe');
SELECT has_column('public', 'condition_import_rows', 'mapped_data',
  'condition_import_rows.mapped_data existe');
SELECT has_column('public', 'condition_import_rows', 'validation_errors',
  'condition_import_rows.validation_errors existe');
SELECT has_column('public', 'condition_import_rows', 'status',
  'condition_import_rows.status existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_import_batches', 'id',
  'condition_import_batches.id es PRIMARY KEY');
SELECT col_is_pk('public', 'condition_import_rows', 'id',
  'condition_import_rows.id es PRIMARY KEY');

-- =============================================================================
-- 5. CONSTRAINTS: Uniqueness
-- =============================================================================
SELECT col_is_unique('public', 'condition_import_batches', 'batch_id',
  'condition_import_batches.batch_id es UNIQUE');

-- =============================================================================
-- 6. FOREIGN KEY: rows.batch_id → batches.id CASCADE
-- =============================================================================
SELECT col_is_fk('public', 'condition_import_rows', 'batch_id',
  'condition_import_rows.batch_id es FK → condition_import_batches');

-- =============================================================================
-- 7. CHECK CONSTRAINTS: batch status rechaza inválidos
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_import_batches
    (batch_id, file_name, file_hash, source_id, created_by, status)
    VALUES ('test_batch_check', 'test.csv', 'abc123', 'csv_import', 'tester', 'INVALID_STATUS')$$,
  '23514',
  NULL,
  'CHECK batch status rechaza valor inválido'
);

-- =============================================================================
-- 8. CHECK CONSTRAINTS: row status rechaza inválidos
-- =============================================================================
-- Primero crear un batch válido para FK
INSERT INTO public.condition_import_batches
  (batch_id, file_name, file_hash, source_id, created_by)
  VALUES ('test_batch_rows_check', 'test.csv', 'abc456', 'csv_import', 'tester');

SELECT throws_ok(
  $$INSERT INTO public.condition_import_rows
    (batch_id, row_number, raw_data, status)
    SELECT id, 1, '{"test":true}', 'INVALID_STATUS'
    FROM public.condition_import_batches WHERE batch_id = 'test_batch_rows_check'$$,
  '23514',
  NULL,
  'CHECK row status rechaza valor inválido'
);

-- =============================================================================
-- 9. UNIQUE: (batch_id, row_number) rechaza duplicado
-- =============================================================================
INSERT INTO public.condition_import_rows
  (batch_id, row_number, raw_data)
  SELECT id, 10, '{"test":true}'
  FROM public.condition_import_batches WHERE batch_id = 'test_batch_rows_check';

SELECT throws_ok(
  $$INSERT INTO public.condition_import_rows
    (batch_id, row_number, raw_data)
    SELECT id, 10, '{"test":true}'
    FROM public.condition_import_batches WHERE batch_id = 'test_batch_rows_check'$$,
  '23505',
  NULL,
  'UNIQUE(batch_id, row_number) rechaza duplicado'
);

-- =============================================================================
-- 10. FK CASCADE: eliminar batch elimina filas
-- =============================================================================
INSERT INTO public.condition_import_batches
  (batch_id, file_name, file_hash, source_id, created_by)
  VALUES ('test_cascade_batch', 'cascade.csv', 'cascade123', 'csv_import', 'tester');

INSERT INTO public.condition_import_rows
  (batch_id, row_number, raw_data)
  SELECT id, 1, '{"val":"A"}'
  FROM public.condition_import_batches WHERE batch_id = 'test_cascade_batch';

INSERT INTO public.condition_import_rows
  (batch_id, row_number, raw_data)
  SELECT id, 2, '{"val":"B"}'
  FROM public.condition_import_batches WHERE batch_id = 'test_cascade_batch';

-- Verificar que hay 2 filas
SELECT is(
  (SELECT COUNT(*) FROM public.condition_import_rows r
   JOIN public.condition_import_batches b ON b.id = r.batch_id
   WHERE b.batch_id = 'test_cascade_batch'),
  2,
  'FK: 2 filas existen antes de CASCADE'
);

-- Eliminar batch
DELETE FROM public.condition_import_batches WHERE batch_id = 'test_cascade_batch';

-- Verificar que las filas se eliminaron en cascada
SELECT is(
  (SELECT COUNT(*) FROM public.condition_import_rows r
   WHERE r.id IN (
     SELECT r2.id FROM public.condition_import_rows r2
     JOIN public.condition_import_batches b ON b.id = r2.batch_id
     WHERE b.batch_id = 'test_cascade_batch'
   ) OR 1=0),
  0,
  'FK: CASCADE — filas eliminadas tras borrar batch'
);

-- =============================================================================
-- 11. EXTENDED CAPABILITIES: edge_001 tiene ≥3 capacidades
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 3 FROM public.condition_source_capabilities WHERE source_id = 'edge_001'),
  'edge_001 tiene al menos 3 capacidades (rms + peak + temp)'
);

-- =============================================================================
-- 12. EXTENDED CAPABILITIES: edge_001 vibration.peak + peak activo
-- =============================================================================
SELECT is(
  (SELECT validation_status FROM public.condition_source_capabilities
   WHERE source_id = 'edge_001' AND can_produce = 'vibration.peak' AND method_key = 'peak'),
  'active',
  'edge_001 + vibration.peak + peak → active'
);

-- =============================================================================
-- 13. EXTENDED CAPABILITIES: manual_route_001 tiene manual.noise_score
-- =============================================================================
SELECT is(
  (SELECT validation_status FROM public.condition_source_capabilities
   WHERE source_id = 'manual_route_001' AND can_produce = 'manual.noise_score'),
  'active',
  'manual_route_001 + manual.noise_score → active'
);

-- =============================================================================
-- 14. EXTENDED CAPABILITIES: manual_route_001 tiene manual.temperature_reading
-- =============================================================================
SELECT is(
  (SELECT validation_status FROM public.condition_source_capabilities
   WHERE source_id = 'manual_route_001' AND can_produce = 'manual.temperature_reading'),
  'active',
  'manual_route_001 + manual.temperature_reading → active'
);

-- =============================================================================
-- 15. EXTENDED CAPABILITIES: mock_source tiene vibration.rms
-- =============================================================================
SELECT is(
  (SELECT validation_status FROM public.condition_source_capabilities
   WHERE source_id = 'mock_source' AND can_produce = 'vibration.rms'),
  'candidate',
  'mock_source + vibration.rms → candidate'
);

-- =============================================================================
-- 16. EXTENDED CAPABILITIES: csv_import tiene ≥2 capacidades
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 2 FROM public.condition_source_capabilities WHERE source_id = 'csv_import'),
  'csv_import tiene al menos 2 capacidades'
);

-- =============================================================================
-- 17. EXTENDED CAPABILITIES: portable_01 tiene ≥2 capacidades
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 2 FROM public.condition_source_capabilities WHERE source_id = 'portable_01'),
  'portable_01 tiene al menos 2 capacidades'
);

-- =============================================================================
-- 18. RLS: Políticas de batches existen
-- =============================================================================
SELECT policies_are('public', 'condition_import_batches',
  ARRAY['condition_import_batches_select', 'condition_import_batches_insert',
        'condition_import_batches_update', 'condition_import_batches_delete'],
  'RLS: condition_import_batches tiene 4 políticas');

-- =============================================================================
-- 19. RLS: Políticas de rows existen
-- =============================================================================
SELECT policies_are('public', 'condition_import_rows',
  ARRAY['condition_import_rows_select', 'condition_import_rows_insert',
        'condition_import_rows_update', 'condition_import_rows_delete'],
  'RLS: condition_import_rows tiene 4 políticas');

-- =============================================================================
-- 20. ÍNDICES: batches
-- =============================================================================
SELECT has_index('public', 'condition_import_batches', 'idx_batches_status',
  'idx_batches_status existe');

SELECT has_index('public', 'condition_import_batches', 'idx_batches_created_at',
  'idx_batches_created_at existe');

-- =============================================================================
-- 21. ÍNDICES: rows
-- =============================================================================
SELECT has_index('public', 'condition_import_rows', 'idx_import_rows_batch',
  'idx_import_rows_batch existe');

SELECT has_index('public', 'condition_import_rows', 'idx_import_rows_status',
  'idx_import_rows_status existe');

-- =============================================================================
-- 22. DEFAULT: batch status default = 'uploaded'
-- =============================================================================
INSERT INTO public.condition_import_batches
  (batch_id, file_name, file_hash, source_id, created_by)
  VALUES ('test_default_status', 'default.csv', 'def456', 'csv_import', 'tester');

SELECT is(
  (SELECT status FROM public.condition_import_batches WHERE batch_id = 'test_default_status'),
  'uploaded',
  'batch status DEFAULT = uploaded'
);

-- =============================================================================
-- 23. DEFAULT: row status default = 'pending'
-- =============================================================================
INSERT INTO public.condition_import_rows
  (batch_id, row_number, raw_data)
  SELECT id, 1, '{"test":true}'
  FROM public.condition_import_batches WHERE batch_id = 'test_default_status';

SELECT is(
  (SELECT status FROM public.condition_import_rows r
   JOIN public.condition_import_batches b ON b.id = r.batch_id
   WHERE b.batch_id = 'test_default_status' AND r.row_number = 1),
  'pending',
  'row status DEFAULT = pending'
);

-- =============================================================================
-- 24. DEFAULT: row_count default = 0
-- =============================================================================
SELECT is(
  (SELECT row_count FROM public.condition_import_batches WHERE batch_id = 'test_default_status'),
  0,
  'batch row_count DEFAULT = 0'
);

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
