-- =============================================================================
-- Condition Monitoring Hybrid Governance — Test Suite (pgTAP)
-- PR 1: condition_sources + outbox + failures + governance functions
--
-- Assertions: schema, CHECKs, seeds, RLS, SQL functions, outbox retry (~65)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_hybrid_governance_test.sql
-- =============================================================================

BEGIN;

-- NOTE: This test file expects pgTAP 1.3.3+ installed in the `public` schema.
-- The `policies_are` function requires pgTAP schema functions helper.
-- The `has_index` function uses the 4-argument signature: (schema, table, index_name, description).
SELECT plan(83);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_sources',
  'Tabla condition_sources existe');

SELECT has_table('public', 'condition_ingest_outbox',
  'Tabla condition_ingest_outbox existe');

SELECT has_table('public', 'condition_ingest_failures',
  'Tabla condition_ingest_failures existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_sources (13 columnas clave)
-- =============================================================================
SELECT has_column('public', 'condition_sources', 'id',
  'condition_sources.id existe');
SELECT has_column('public', 'condition_sources', 'source_id',
  'condition_sources.source_id existe');
SELECT has_column('public', 'condition_sources', 'source_type',
  'condition_sources.source_type existe');
SELECT has_column('public', 'condition_sources', 'name',
  'condition_sources.name existe');
SELECT has_column('public', 'condition_sources', 'status',
  'condition_sources.status existe');
SELECT has_column('public', 'condition_sources', 'asset_id',
  'condition_sources.asset_id existe');
SELECT has_column('public', 'condition_sources', 'owner',
  'condition_sources.owner existe');
SELECT has_column('public', 'condition_sources', 'last_seen_at',
  'condition_sources.last_seen_at existe');
SELECT has_column('public', 'condition_sources', 'validation_status',
  'condition_sources.validation_status existe');
SELECT has_column('public', 'condition_sources', 'late_event_cutoff_hours',
  'condition_sources.late_event_cutoff_hours existe');
SELECT has_column('public', 'condition_sources', 'created_by',
  'condition_sources.created_by existe');
SELECT has_column('public', 'condition_sources', 'created_at',
  'condition_sources.created_at existe');
SELECT has_column('public', 'condition_sources', 'updated_at',
  'condition_sources.updated_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas clave de condition_ingest_outbox
-- =============================================================================
SELECT has_column('public', 'condition_ingest_outbox', 'id',
  'condition_ingest_outbox.id existe');
SELECT has_column('public', 'condition_ingest_outbox', 'idempotency_key',
  'condition_ingest_outbox.idempotency_key existe');
SELECT has_column('public', 'condition_ingest_outbox', 'source_id',
  'condition_ingest_outbox.source_id existe');
SELECT has_column('public', 'condition_ingest_outbox', 'source_type',
  'condition_ingest_outbox.source_type existe');
SELECT has_column('public', 'condition_ingest_outbox', 'payload',
  'condition_ingest_outbox.payload existe');
SELECT has_column('public', 'condition_ingest_outbox', 'status',
  'condition_ingest_outbox.status existe');
SELECT has_column('public', 'condition_ingest_outbox', 'retry_count',
  'condition_ingest_outbox.retry_count existe');
SELECT has_column('public', 'condition_ingest_outbox', 'max_retries',
  'condition_ingest_outbox.max_retries existe');
SELECT has_column('public', 'condition_ingest_outbox', 'next_retry_at',
  'condition_ingest_outbox.next_retry_at existe');

-- =============================================================================
-- 4. SCHEMA: Columnas clave de condition_ingest_failures
-- =============================================================================
SELECT has_column('public', 'condition_ingest_failures', 'id',
  'condition_ingest_failures.id existe');
SELECT has_column('public', 'condition_ingest_failures', 'outbox_id',
  'condition_ingest_failures.outbox_id existe');
SELECT has_column('public', 'condition_ingest_failures', 'source_id',
  'condition_ingest_failures.source_id existe');
SELECT has_column('public', 'condition_ingest_failures', 'idempotency_key',
  'condition_ingest_failures.idempotency_key existe');
SELECT has_column('public', 'condition_ingest_failures', 'payload',
  'condition_ingest_failures.payload existe');
SELECT has_column('public', 'condition_ingest_failures', 'error_code',
  'condition_ingest_failures.error_code existe');
SELECT has_column('public', 'condition_ingest_failures', 'status',
  'condition_ingest_failures.status existe');
SELECT has_column('public', 'condition_ingest_failures', 'resolved_by',
  'condition_ingest_failures.resolved_by existe');

-- =============================================================================
-- 5. SCHEMA: ALTER columns en condition_windows
-- =============================================================================
SELECT has_column('public', 'condition_windows', 'ingested_by',
  'condition_windows.ingested_by existe (ALTER agregado)');
SELECT has_column('public', 'condition_windows', 'late_data_flag',
  'condition_windows.late_data_flag existe (ALTER agregado)');
SELECT has_column('public', 'condition_windows', 'late_data_hours',
  'condition_windows.late_data_hours existe (ALTER agregado)');
SELECT has_column('public', 'condition_windows', 'quality_gate_passed',
  'condition_windows.quality_gate_passed existe (ALTER agregado)');

-- =============================================================================
-- 6. SCHEMA: ALTER columns en condition_feature_values
-- =============================================================================
SELECT has_column('public', 'condition_feature_values', 'ingested_by',
  'condition_feature_values.ingested_by existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'measured_by',
  'condition_feature_values.measured_by existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'entered_by',
  'condition_feature_values.entered_by existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'measured_at',
  'condition_feature_values.measured_at existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'entered_at',
  'condition_feature_values.entered_at existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'instrument_ref',
  'condition_feature_values.instrument_ref existe (ALTER agregado)');
SELECT has_column('public', 'condition_feature_values', 'notes',
  'condition_feature_values.notes existe (ALTER agregado)');

-- =============================================================================
-- 7. SCHEMA: ALTER column en condition_source_capabilities
-- =============================================================================
SELECT has_column('public', 'condition_source_capabilities', 'late_event_cutoff_hours',
  'condition_source_capabilities.late_event_cutoff_hours existe (ALTER agregado)');

-- =============================================================================
-- 8. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_sources', 'id',
  'condition_sources.id es PRIMARY KEY');
SELECT col_is_pk('public', 'condition_ingest_outbox', 'id',
  'condition_ingest_outbox.id es PRIMARY KEY');
SELECT col_is_pk('public', 'condition_ingest_failures', 'id',
  'condition_ingest_failures.id es PRIMARY KEY');

-- =============================================================================
-- 9. CONSTRAINTS: Uniqueness
-- =============================================================================
SELECT col_is_unique('public', 'condition_sources', 'source_id',
  'condition_sources.source_id es UNIQUE');
SELECT col_is_unique('public', 'condition_ingest_outbox', 'idempotency_key',
  'condition_ingest_outbox.idempotency_key es UNIQUE');

-- =============================================================================
-- 10. FOREIGN KEYS: outbox_id en failures → outbox
-- =============================================================================
SELECT col_is_fk('public', 'condition_ingest_failures', 'outbox_id',
  'condition_ingest_failures.outbox_id es FK → condition_ingest_outbox');

-- =============================================================================
-- 11. CHECK CONSTRAINTS: source_type válidos en condition_sources
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_sources (source_id, source_type, name, created_by)
    VALUES ('test_bad_type', 'INVALID_TYPE', 'Test', 'tester')$$,
  '23514',
  NULL,
  'CHECK source_type rechaza valor inválido'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_sources (source_id, source_type, name, created_by)
    VALUES ('test_good_type', 'edge', 'Test Edge', 'tester')$$,
  'CHECK source_type acepta edge (válido)'
);

-- =============================================================================
-- 12. CHECK CONSTRAINTS: status válidos en condition_sources
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_sources (source_id, source_type, name, status, created_by)
    VALUES ('test_bad_status', 'edge', 'Test', 'INVALID', 'tester')$$,
  '23514',
  NULL,
  'CHECK status rechaza valor inválido en condition_sources'
);

-- =============================================================================
-- 13. CHECK CONSTRAINTS: status en outbox
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_ingest_outbox
    (idempotency_key, source_id, source_type, payload, status)
    VALUES ('test_outbox_status', 'src-001', 'edge', '{"test":true}', 'INVALID')$$,
  '23514',
  NULL,
  'CHECK outbox status rechaza valor inválido'
);

-- =============================================================================
-- 14. CHECK CONSTRAINTS: status en failures
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_ingest_failures
    (source_id, source_type, idempotency_key, payload, status)
    VALUES ('src-001', 'edge', 'test_fail_status', '{"test":true}', 'INVALID')$$,
  '23514',
  NULL,
  'CHECK failures status rechaza valor inválido'
);

-- =============================================================================
-- 15. SEEDS: 5 fuentes presentes
-- =============================================================================
SELECT is(
  (SELECT status FROM public.condition_sources WHERE source_id = 'edge_001'),
  'active',
  'Seed edge_001 con status=active'
);
SELECT is(
  (SELECT late_event_cutoff_hours FROM public.condition_sources WHERE source_id = 'edge_001'),
  24,
  'Seed edge_001 cutoff_hours=24'
);
SELECT is(
  (SELECT status FROM public.condition_sources WHERE source_id = 'manual_route_001'),
  'active',
  'Seed manual_route_001 con status=active'
);
SELECT is(
  (SELECT late_event_cutoff_hours FROM public.condition_sources WHERE source_id = 'manual_route_001'),
  0,
  'Seed manual_route_001 cutoff_hours=0'
);
SELECT is(
  (SELECT status FROM public.condition_sources WHERE source_id = 'csv_import'),
  'candidate',
  'Seed csv_import con status=candidate'
);
SELECT is(
  (SELECT late_event_cutoff_hours FROM public.condition_sources WHERE source_id = 'csv_import'),
  0,
  'Seed csv_import cutoff_hours=0'
);
SELECT is(
  (SELECT status FROM public.condition_sources WHERE source_id = 'mock_source'),
  'field_trial',
  'Seed mock_source con status=field_trial'
);
SELECT is(
  (SELECT status FROM public.condition_sources WHERE source_id = 'portable_01'),
  'field_trial',
  'Seed portable_01 con status=field_trial'
);

-- =============================================================================
-- 16. RLS: Políticas existen
-- =============================================================================
SELECT policies_are('public', 'condition_sources',
  ARRAY['condition_sources_select', 'condition_sources_insert',
        'condition_sources_update', 'condition_sources_delete'],
  'RLS: condition_sources tiene 4 políticas');

SELECT policies_are('public', 'condition_ingest_outbox',
  ARRAY['condition_ingest_outbox_select', 'condition_ingest_outbox_insert',
        'condition_ingest_outbox_delete'],
  'RLS: condition_ingest_outbox tiene 3 políticas');

SELECT policies_are('public', 'condition_ingest_failures',
  ARRAY['condition_ingest_failures_select', 'condition_ingest_failures_update',
        'condition_ingest_failures_delete'],
  'RLS: condition_ingest_failures tiene 3 políticas');

-- =============================================================================
-- 17. RLS: rol anon bloqueado para INSERT en condition_sources
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_sources (source_id, source_type, name, created_by)
    VALUES ('rls_anon_test', 'edge', 'RLS Test', 'anon')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_sources'
);
RESET ROLE;

-- =============================================================================
-- 18. RLS: authenticated puede SELECT de condition_sources
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT COUNT(*) FROM public.condition_sources$$,
  'RLS: rol authenticated puede SELECT de condition_sources'
);
RESET ROLE;

-- =============================================================================
-- 19. SQL FUNCTION: is_source_capable() — exact match activa
--    edge_001 tiene capability vibration.rms + rms_velocity_window con validation_status=active
-- =============================================================================
SELECT is(
  public.is_source_capable('edge_001', 'vibration.rms', 'rms_velocity_window'),
  true,
  'is_source_capable: edge_001 + vibration.rms + rms_velocity_window → TRUE (active)'
);

-- =============================================================================
-- 20. SQL FUNCTION: is_source_capable() — no match (method_key distinto)
-- =============================================================================
SELECT is(
  public.is_source_capable('edge_001', 'vibration.rms', 'peak_detection'),
  false,
  'is_source_capable: edge_001 + vibration.rms + peak_detection → FALSE (no existe)'
);

-- =============================================================================
-- 21. SQL FUNCTION: is_source_capable() — capability existe pero en candidate
--    mock_source_001 tiene vibration.rms + rms_velocity_window con validation_status=candidate
-- =============================================================================
SELECT is(
  public.is_source_capable('mock_source_001', 'vibration.rms', 'rms_velocity_window'),
  false,
  'is_source_capable: mock_source_001 + vibration.rms + rms_velocity_window → FALSE (candidate)'
);

-- =============================================================================
-- 22. SQL FUNCTION: is_source_capable() — source_id inexistente
-- =============================================================================
SELECT is(
  public.is_source_capable('nonexistent_source', 'vibration.rms', 'rms_velocity_window'),
  false,
  'is_source_capable: nonexistent_source → FALSE'
);

-- =============================================================================
-- 23. SQL FUNCTION: is_within_late_cutoff() — dentro del cutoff
--    edge_001 tiene cutoff=24h, ingestamos hace 2h → TRUE
-- =============================================================================
SELECT is(
  public.is_within_late_cutoff('edge_001', NOW() - INTERVAL '2 hours'),
  true,
  'is_within_late_cutoff: edge_001 2h atrás → TRUE (dentro de 24h cutoff)'
);

-- =============================================================================
-- 24. SQL FUNCTION: is_within_late_cutoff() — fuera del cutoff
--    edge_001 tiene cutoff=24h, ingestamos hace 48h → FALSE
-- =============================================================================
SELECT is(
  public.is_within_late_cutoff('edge_001', NOW() - INTERVAL '48 hours'),
  false,
  'is_within_late_cutoff: edge_001 48h atrás → FALSE (fuera de 24h cutoff)'
);

-- =============================================================================
-- 25. SQL FUNCTION: is_within_late_cutoff() — cutoff=0 siempre late
--    csv_import tiene cutoff=0 → siempre FALSE
-- =============================================================================
SELECT is(
  public.is_within_late_cutoff('csv_import', NOW() - INTERVAL '1 hour'),
  false,
  'is_within_late_cutoff: csv_import 1h atrás → FALSE (cutoff=0, siempre late)'
);

-- =============================================================================
-- 26. SQL FUNCTION: is_within_late_cutoff() — fuente inexistente
-- =============================================================================
SELECT is(
  public.is_within_late_cutoff('nonexistent_source', NOW() - INTERVAL '1 hour'),
  false,
  'is_within_late_cutoff: nonexistent_source → FALSE (seguridad)'
);

-- =============================================================================
-- 27. OUTBOX: INSERT válido y round-trip
-- =============================================================================
SELECT lives_ok(
  $$INSERT INTO public.condition_ingest_outbox
    (idempotency_key, source_id, source_type, payload)
    VALUES ('test_outbox_roundtrip', 'edge_001', 'edge',
            '{"external_window_id":"test_ow","asset_id":"ASSET-001","features":[]}')$$,
  'Outbox: INSERT válido exitoso'
);

-- Verificar que el payload se insertó con defaults correctos
SELECT is(
  (SELECT status FROM public.condition_ingest_outbox WHERE idempotency_key = 'test_outbox_roundtrip'),
  'pending',
  'Outbox: status DEFAULT = pending'
);

SELECT is(
  (SELECT retry_count FROM public.condition_ingest_outbox WHERE idempotency_key = 'test_outbox_roundtrip'),
  0,
  'Outbox: retry_count DEFAULT = 0'
);

SELECT is(
  (SELECT max_retries FROM public.condition_ingest_outbox WHERE idempotency_key = 'test_outbox_roundtrip'),
  3,
  'Outbox: max_retries DEFAULT = 3'
);

-- =============================================================================
-- 28. OUTBOX: UNIQUE idempotency_key rechaza duplicado
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_ingest_outbox
    (idempotency_key, source_id, source_type, payload)
    VALUES ('test_outbox_roundtrip', 'edge_001', 'edge', '{"test":true}')$$,
  '23505',
  NULL,
  'Outbox: UNIQUE idempotency_key rechaza duplicado'
);

-- =============================================================================
-- 29. SQL FUNCTION: retry_failed_ingests() existe y retorna INT
-- =============================================================================
SELECT has_function('public', 'retry_failed_ingests', '{}',
  'Función retry_failed_ingests() existe');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'retry_failed_ingests'
      AND pg_get_function_result(p.oid) = 'integer'
  ),
  'retry_failed_ingests() retorna INTEGER'
);

-- =============================================================================
-- 30. SQL FUNCTION: purge_dead_letters() existe
-- =============================================================================
SELECT has_function('public', 'purge_dead_letters', ARRAY['integer'],
  'Función purge_dead_letters(INT) existe');

-- =============================================================================
-- 31. ÍNDICES: condition_sources
-- =============================================================================
SELECT has_index('public', 'condition_sources', 'idx_sources_type', 'idx_sources_type existe');
SELECT has_index('public', 'condition_sources', 'idx_sources_status', 'idx_sources_status existe');
SELECT has_index('public', 'condition_sources', 'idx_sources_asset', 'idx_sources_asset existe');
SELECT has_index('public', 'condition_sources', 'idx_sources_last_seen', 'idx_sources_last_seen existe');

-- =============================================================================
-- 32. ÍNDICES: condition_ingest_outbox
-- =============================================================================
SELECT has_index('public', 'condition_ingest_outbox', 'idx_outbox_status', 'idx_outbox_status existe');
SELECT has_index('public', 'condition_ingest_outbox', 'idx_outbox_source', 'idx_outbox_source existe');

-- =============================================================================
-- 33. ÍNDICES: condition_ingest_failures
-- =============================================================================
SELECT has_index('public', 'condition_ingest_failures', 'idx_failures_status', 'idx_failures_status existe');
SELECT has_index('public', 'condition_ingest_failures', 'idx_failures_source', 'idx_failures_source existe');

-- =============================================================================
-- Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
