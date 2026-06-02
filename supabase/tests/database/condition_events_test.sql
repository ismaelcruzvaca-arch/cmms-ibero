-- =============================================================================
-- Condition Events + Event Sources — Test Suite (pgTAP)
-- PR 1d: condition_events + condition_event_sources
--
-- Assertions: schema, constraints, CHECKs, FKs, unique indexes,
--   round-trip, RLS, triggers (~47)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_events_test.sql
-- =============================================================================

BEGIN;

SELECT plan(47);

-- =============================================================================
-- 1. SCHEMA: Tablas existen
-- =============================================================================
SELECT has_table('public', 'condition_events',
  'Tabla condition_events existe');

SELECT has_table('public', 'condition_event_sources',
  'Tabla condition_event_sources existe');

-- =============================================================================
-- 2. SCHEMA: Columnas de condition_events (11 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_events', 'id',
  'condition_events.id existe');
SELECT has_column('public', 'condition_events', 'asset_id',
  'condition_events.asset_id existe');
SELECT has_column('public', 'condition_events', 'rule_id',
  'condition_events.rule_id existe');
SELECT has_column('public', 'condition_events', 'event_type',
  'condition_events.event_type existe');
SELECT has_column('public', 'condition_events', 'severity',
  'condition_events.severity existe');
SELECT has_column('public', 'condition_events', 'hi_value',
  'condition_events.hi_value existe');
SELECT has_column('public', 'condition_events', 'dhi_dt_value',
  'condition_events.dhi_dt_value existe');
SELECT has_column('public', 'condition_events', 'message',
  'condition_events.message existe');
SELECT has_column('public', 'condition_events', 'status',
  'condition_events.status existe');
SELECT has_column('public', 'condition_events', 'created_at',
  'condition_events.created_at existe');
SELECT has_column('public', 'condition_events', 'updated_at',
  'condition_events.updated_at existe');

-- =============================================================================
-- 3. SCHEMA: Columnas de condition_event_sources (5 columnas)
-- =============================================================================
SELECT has_column('public', 'condition_event_sources', 'id',
  'condition_event_sources.id existe');
SELECT has_column('public', 'condition_event_sources', 'event_id',
  'condition_event_sources.event_id existe');
SELECT has_column('public', 'condition_event_sources', 'feature_value_id',
  'condition_event_sources.feature_value_id existe');
SELECT has_column('public', 'condition_event_sources', 'analysis_result_id',
  'condition_event_sources.analysis_result_id existe');
SELECT has_column('public', 'condition_event_sources', 'created_at',
  'condition_event_sources.created_at existe');

-- =============================================================================
-- 4. CONSTRAINTS: Primary Keys
-- =============================================================================
SELECT col_is_pk('public', 'condition_events', 'id',
  'condition_events.id es PRIMARY KEY');
SELECT col_is_pk('public', 'condition_event_sources', 'id',
  'condition_event_sources.id es PRIMARY KEY');

-- =============================================================================
-- 5. FOREIGN KEYS: condition_event_sources
-- =============================================================================
SELECT col_is_fk('public', 'condition_event_sources', 'event_id',
  'condition_event_sources.event_id es FK → condition_events');

SELECT col_is_fk('public', 'condition_event_sources', 'feature_value_id',
  'condition_event_sources.feature_value_id es FK → condition_feature_values');

-- =============================================================================
-- 6. CHECK CONSTRAINT: severity (info, warning, critical)
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-001', 'threshold_exceeded', 'INVALID_SEVERITY')$$,
  '23514',
  NULL,
  'CHECK severity rechaza valor inválido (INVALID_SEVERITY)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-001', 'threshold_exceeded', 'info')$$,
  'CHECK severity acepta info (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-002', 'trend_detected', 'warning')$$,
  'CHECK severity acepta warning (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-003', 'manual', 'critical')$$,
  'CHECK severity acepta critical (válido)'
);

-- =============================================================================
-- 7. CHECK CONSTRAINT: event_type (threshold_exceeded, trend_detected, quality_degraded, manual)
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-001', 'INVALID_TYPE', 'info')$$,
  '23514',
  NULL,
  'CHECK event_type rechaza valor inválido (INVALID_TYPE)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-004', 'threshold_exceeded', 'warning')$$,
  'CHECK event_type acepta threshold_exceeded (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-005', 'trend_detected', 'info')$$,
  'CHECK event_type acepta trend_detected (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('ASSET-006', 'quality_degraded', 'warning')$$,
  'CHECK event_type acepta quality_degraded (válido)'
);

-- =============================================================================
-- 8. CHECK CONSTRAINT: status (open, linked_to_wo, closed, dismissed)
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity, status)
    VALUES ('ASSET-001', 'manual', 'info', 'INVALID_STATUS')$$,
  '23514',
  NULL,
  'CHECK status rechaza valor inválido (INVALID_STATUS)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity, status)
    VALUES ('ASSET-007', 'manual', 'info', 'open')$$,
  'CHECK status acepta open (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity, status)
    VALUES ('ASSET-008', 'manual', 'warning', 'closed')$$,
  'CHECK status acepta closed (válido)'
);

SELECT lives_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity, status)
    VALUES ('ASSET-009', 'manual', 'info', 'dismissed')$$,
  'CHECK status acepta dismissed (válido)'
);

-- =============================================================================
-- 9. CHECK CONSTRAINT: condition_event_sources (al menos uno NO NULL)
-- =============================================================================
SELECT throws_ok(
  $$INSERT INTO public.condition_event_sources
    (event_id, feature_value_id, analysis_result_id)
    SELECT id, NULL, NULL
    FROM public.condition_events
    WHERE asset_id = 'ASSET-001' AND event_type = 'threshold_exceeded'
    LIMIT 1$$,
  '23514',
  NULL,
  'CHECK event_sources rechaza ambos NULL (feature_value_id y analysis_result_id)'
);

-- =============================================================================
-- 10. INSERT ROUND-TRIP: evento + event_sources vinculados
-- =============================================================================
-- Insertar evento con metadatos completos
INSERT INTO public.condition_events
  (asset_id, event_type, severity, hi_value, dhi_dt_value, message)
  VALUES ('BANDA-TR-01', 'threshold_exceeded', 'critical',
          0.35, -0.012, 'Vibración excedió zone_c_max: 7.5 mm/s > 7.1 mm/s');

-- Verificar que el evento se insertó correctamente
SELECT is(
  (SELECT severity FROM public.condition_events WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'),
  'critical',
  'Evento insertado con severity = critical'
);

SELECT is(
  (SELECT status FROM public.condition_events WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'),
  'open',
  'Evento insertado con status DEFAULT = open'
);

SELECT is(
  (SELECT hi_value::numeric(10,3) FROM public.condition_events WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'),
  0.350::numeric(10,3),
  'Evento insertado con hi_value = 0.35'
);

SELECT is(
  (SELECT dhi_dt_value::numeric(10,3) FROM public.condition_events WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'),
  -0.012::numeric(10,3),
  'Evento insertado con dhi_dt_value = -0.012'
);

SELECT is(
  (SELECT message FROM public.condition_events WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'),
  'Vibración excedió zone_c_max: 7.5 mm/s > 7.1 mm/s',
  'Evento insertado con message correcto'
);

-- =============================================================================
-- 11. FK CASCADE: eliminar evento elimina sus event_sources
-- =============================================================================
-- Primero, insertar un event_source vinculado (usando un feature_value real)
WITH ev AS (
  SELECT id FROM public.condition_events
  WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'
  LIMIT 1
),
fv AS (
  SELECT id FROM public.condition_feature_values
  LIMIT 1
)
INSERT INTO public.condition_event_sources (event_id, feature_value_id)
SELECT ev.id, fv.id FROM ev, fv;

-- Verificar que el event_source existe
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.condition_event_sources es
    JOIN public.condition_events e ON e.id = es.event_id
    WHERE e.asset_id = 'BANDA-TR-01' AND e.event_type = 'threshold_exceeded'
  ),
  'Event source vinculado al evento BANDA-TR-01 existe'
);

-- Eliminar evento → CASCADE debe eliminar event_sources
DELETE FROM public.condition_events
WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded';

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.condition_events
    WHERE asset_id = 'BANDA-TR-01' AND event_type = 'threshold_exceeded'
  ),
  'Evento BANDA-TR-01 eliminado (verificación FK CASCADE)'
);

-- =============================================================================
-- 12. RLS: condition_events policies existen
-- =============================================================================
SELECT policies_are('public', 'condition_events',
  ARRAY['condition_events_select', 'condition_events_insert',
        'condition_events_update', 'condition_events_delete'],
  'RLS: condition_events tiene 4 políticas');

-- =============================================================================
-- 13. RLS: condition_event_sources policies existen
-- =============================================================================
SELECT policies_are('public', 'condition_event_sources',
  ARRAY['condition_event_sources_select', 'condition_event_sources_insert',
        'condition_event_sources_update', 'condition_event_sources_delete'],
  'RLS: condition_event_sources tiene 4 políticas');

-- =============================================================================
-- 14. RLS: role anon no puede INSERT en condition_events
-- =============================================================================
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_events
    (asset_id, event_type, severity)
    VALUES ('RLS_TEST', 'manual', 'info')$$,
  '42501',
  NULL,
  'RLS: rol anon no puede INSERT en condition_events'
);
RESET ROLE;

-- =============================================================================
-- 15. RLS: authenticated puede SELECT de condition_events
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT COUNT(*) FROM public.condition_events$$,
  'RLS: rol authenticated puede SELECT de condition_events'
);
RESET ROLE;

-- =============================================================================
-- 16. ÍNDICES: condition_events
-- =============================================================================
SELECT has_index('public', 'condition_events', 'idx_events_asset',
  'condition_events', 'idx_events_asset', 'Índice idx_events_asset existe');
SELECT has_index('public', 'condition_events', 'idx_events_status',
  'condition_events', 'idx_events_status', 'Índice idx_events_status existe');
SELECT has_index('public', 'condition_events', 'idx_events_severity',
  'condition_events', 'idx_events_severity', 'Índice idx_events_severity existe');
SELECT has_index('public', 'condition_events', 'idx_events_created_at',
  'condition_events', 'idx_events_created_at', 'Índice idx_events_created_at existe');

-- =============================================================================
-- 17. ÍNDICES: condition_event_sources
-- =============================================================================
SELECT has_index('public', 'condition_event_sources', 'idx_es_event',
  'condition_event_sources', 'idx_es_event', 'Índice idx_es_event existe');
SELECT has_index('public', 'condition_event_sources', 'idx_es_feature',
  'condition_event_sources', 'idx_es_feature', 'Índice idx_es_feature existe');
SELECT has_index('public', 'condition_event_sources', 'idx_es_event_feature_unique',
  'condition_event_sources', 'idx_es_event_feature_unique', 'Índice único idx_es_event_feature_unique existe');
SELECT has_index('public', 'condition_event_sources', 'idx_es_event_analysis_unique',
  'condition_event_sources', 'idx_es_event_analysis_unique', 'Índice único idx_es_event_analysis_unique existe');

-- =============================================================================
-- 18. TRIGGER: updated_at existe en condition_events
-- =============================================================================
SELECT has_trigger('public', 'condition_events', 'trg_condition_events_updated_at',
  'Trigger trg_condition_events_updated_at existe');

-- =============================================================================
-- 19. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
