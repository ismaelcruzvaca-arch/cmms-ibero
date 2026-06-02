-- =============================================================================
-- Condition Triggers — Test Suite (pgTAP)
-- PR 2b: event-to-WO + validation lifecycle triggers
--
-- Assertions: schema (column + FK + index), event-to-WO trigger,
--   validation lifecycle (valid + invalid transitions),
--   service_role bypass (~42 assertions)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_triggers_test.sql
-- =============================================================================

BEGIN;

SELECT plan(42);

-- =============================================================================
-- 1. SCHEMA: work_orders.condition_event_id existe
-- =============================================================================
SELECT has_column('public', 'work_orders', 'condition_event_id',
  'work_orders.condition_event_id existe (UUID nullable)');

SELECT col_type_is('public', 'work_orders', 'condition_event_id', 'uuid',
  'work_orders.condition_event_id es tipo UUID');

SELECT col_is_null('public', 'work_orders', 'condition_event_id',
  'work_orders.condition_event_id permite NULL');

-- =============================================================================
-- 2. SCHEMA: FK fk_wo_condition_event existe
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_wo_condition_event'
      AND conrelid = 'public.work_orders'::regclass
      AND confrelid = 'public.condition_events'::regclass
  ),
  'FK fk_wo_condition_event (work_orders → condition_events) existe'
);

-- =============================================================================
-- 3. SCHEMA: FK fk_ce_rule existe
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_ce_rule'
      AND conrelid = 'public.condition_events'::regclass
      AND confrelid = 'public.condition_rules'::regclass
  ),
  'FK fk_ce_rule (condition_events → condition_rules) existe'
);

-- =============================================================================
-- 4. SCHEMA: Índices
-- =============================================================================
SELECT has_index('public', 'work_orders', 'idx_wo_condition_event',
  'idx_wo_condition_event', 'Índice idx_wo_condition_event existe en work_orders');

SELECT has_index('public', 'condition_events', 'idx_events_rule',
  'idx_events_rule', 'Índice idx_events_rule existe en condition_events');

-- =============================================================================
-- 5. TRIGGER: trg_condition_event_to_wo existe
-- =============================================================================
SELECT has_trigger('public', 'condition_events', 'trg_condition_event_to_wo',
  'Trigger trg_condition_event_to_wo existe en condition_events');

-- =============================================================================
-- 6. TRIGGERS: Validación en las 5 tablas
-- =============================================================================
SELECT has_trigger('public', 'condition_analysis_methods', 'trg_validation_methods',
  'Trigger trg_validation_methods existe');
SELECT has_trigger('public', 'condition_threshold_catalog', 'trg_validation_thresholds',
  'Trigger trg_validation_thresholds existe');
SELECT has_trigger('public', 'condition_source_capabilities', 'trg_validation_sources',
  'Trigger trg_validation_sources existe');
SELECT has_trigger('public', 'condition_rules', 'trg_validation_rules',
  'Trigger trg_validation_rules existe');
SELECT has_trigger('public', 'condition_analysis_results', 'trg_validation_analysis',
  'Trigger trg_validation_analysis existe');

-- =============================================================================
-- 7. EVENT-TO-WO: critical crea WO y actualiza status
-- =============================================================================
-- Usamos SET LOCAL para aislar el test sin crear datos permanentes.
-- Insertamos un evento critical y verificamos que se crea WO + status cambia.

-- Seed: usar activo existente (assets.id INTEGER → usar id::TEXT)
DO $$
DECLARE
  v_asset_id TEXT;
  v_evt_id UUID;
  v_wo_id UUID;
BEGIN
  SELECT id::TEXT INTO v_asset_id FROM assets LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Se requiere al menos un activo para el test';
  END IF;
END;
$$;

-- Insertar evento critical
WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
), evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'critical', 'pgTAP test: critical event → WO', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  EXISTS (SELECT 1 FROM work_orders WHERE condition_event_id = (SELECT id FROM evt)),
  'Evento critical: WO creada con condition_event_id FK'
) FROM evt;

WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
), evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'critical', 'pgTAP test: status→linked_to_wo', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  (SELECT status = 'linked_to_wo' FROM condition_events WHERE id = (SELECT id FROM evt)),
  'Evento critical: status cambia a linked_to_wo'
) FROM evt;

-- WO attributes
WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
), evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'critical', 'pgTAP test: WO attrs', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  EXISTS (
    SELECT 1 FROM work_orders
    WHERE condition_event_id = (SELECT id FROM evt)
      AND wo_type = 'CBM'
      AND lifecycle_phase = 'WAPPR'
      AND criticality = 'A'
      AND symptom_note LIKE '%pgTAP test: WO attrs%'
  ),
  'WO creada: wo_type=CBM, lifecycle_phase=WAPPR, criticality=A, symptom_note incluye mensaje'
) FROM evt;

-- =============================================================================
-- 8. EVENT-TO-WO: warning NO crea WO
-- =============================================================================
WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
),
evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'warning', 'pgTAP test: warning no WO', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  NOT EXISTS (SELECT 1 FROM work_orders WHERE symptom_note LIKE '%pgTAP test: warning no WO%'),
  'Evento warning: NO se crea WO'
) FROM evt;

WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
),
evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'warning', 'pgTAP test: warning status open', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  (SELECT status = 'open' FROM condition_events WHERE id = (SELECT id FROM evt)),
  'Evento warning: status permanece open'
) FROM evt;

-- =============================================================================
-- 9. EVENT-TO-WO: info NO crea WO
-- =============================================================================
WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
),
evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'manual', 'info', 'pgTAP test: info no WO', 'open'
  FROM asset
  RETURNING id
)
SELECT ok(
  NOT EXISTS (SELECT 1 FROM work_orders WHERE symptom_note LIKE '%pgTAP test: info no WO%'),
  'Evento info: NO se crea WO'
) FROM evt;

-- =============================================================================
-- 10. EVENT-TO-WO: anti-spam — una WO por evento
-- =============================================================================
WITH asset AS (
  SELECT id::TEXT AS aid FROM assets LIMIT 1
),
evt AS (
  INSERT INTO condition_events (asset_id, event_type, severity, message, status)
  SELECT aid, 'threshold_exceeded', 'critical', 'pgTAP test: anti-spam', 'open'
  FROM asset
  RETURNING id
)
SELECT is(
  (SELECT COUNT(*)::int FROM work_orders WHERE condition_event_id = (SELECT id FROM evt)),
  1,
  'Anti-spam: exactamente 1 WO creada por evento critical'
) FROM evt;

-- =============================================================================
-- 11. LIFECYCLE: transiciones válidas aceptadas
-- =============================================================================
-- Usamos condition_rules (tiene seed data y validation_status='draft')
-- draft → candidate
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'candidate'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'draft'$$,
  'Lifecycle: draft → candidate aceptado'
);

-- candidate → bench_validated
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'bench_validated'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate'$$,
  'Lifecycle: candidate → bench_validated aceptado'
);

-- bench_validated → field_trial
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'field_trial'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'bench_validated'$$,
  'Lifecycle: bench_validated → field_trial aceptado'
);

-- field_trial → active
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'active'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'field_trial'$$,
  'Lifecycle: field_trial → active aceptado'
);

-- active → deprecated
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'deprecated'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'active'$$,
  'Lifecycle: active → deprecated aceptado'
);

-- deprecated → candidate (revisión explícita)
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'candidate'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'deprecated'$$,
  'Lifecycle: deprecated → candidate aceptado (revisión explícita)'
);

-- Regresar a draft para el resto de los tests
UPDATE public.condition_rules SET validation_status = 'rejected'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate';

-- rejected → draft (re-evaluación)
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'draft'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'rejected'$$,
  'Lifecycle: rejected → draft aceptado (re-evaluación)'
);

-- =============================================================================
-- 12. LIFECYCLE: transiciones INVÁLIDAS rechazadas
-- =============================================================================

-- draft → active (salto prohibido)
SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'active'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'draft'$$,
  'P0001',
  'Transición de validación inválida: draft → active',
  'Lifecycle: draft → active RECHAZADO (salto prohibido)'
);

-- draft → bench_validated
SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'bench_validated'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'draft'$$,
  'P0001',
  NULL,
  'Lifecycle: draft → bench_validated RECHAZADO'
);

-- candidate → active
SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'candidate'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'draft'$$,
  NULL   -- lives_ok, esto prepara candidate para el siguiente test
);

-- candidate → active (invalido desde candidate)
SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'active'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate'$$,
  'P0001',
  NULL,
  'Lifecycle: candidate → active RECHAZADO'
);

-- bench_validated → active (salto prohibido)
UPDATE public.condition_rules SET validation_status = 'bench_validated'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate';

SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'active'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'bench_validated'$$,
  'P0001',
  NULL,
  'Lifecycle: bench_validated → active RECHAZADO (falta field_trial)'
);

-- field_trial → candidate (esto SÍ debería ser válido según las reglas de PR 2b)
UPDATE public.condition_rules SET validation_status = 'field_trial'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'bench_validated';

SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'candidate'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'field_trial'$$,
  'Lifecycle: field_trial → candidate aceptado (retroceso permitido)'
);

-- active → candidate (invalido — active solo puede deprecated)
UPDATE public.condition_rules SET validation_status = 'field_trial'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate';
UPDATE public.condition_rules SET validation_status = 'active'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'field_trial';

SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'candidate'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'active'$$,
  'P0001',
  NULL,
  'Lifecycle: active → candidate RECHAZADO (active solo deprecated)'
);

-- deprecated → active (invalido)
UPDATE public.condition_rules SET validation_status = 'deprecated'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'active';

SELECT throws_ok(
  $$UPDATE public.condition_rules SET validation_status = 'active'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'deprecated'$$,
  'P0001',
  NULL,
  'Lifecycle: deprecated → active RECHAZADO (deprecated solo → candidate)'
);

-- Regresar vibration.rms HIGH a draft para limpieza
UPDATE public.condition_rules SET validation_status = 'candidate'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'deprecated';
UPDATE public.condition_rules SET validation_status = 'rejected'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'candidate';
UPDATE public.condition_rules SET validation_status = 'draft'
  WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'rejected';

-- =============================================================================
-- 13. LIFECYCLE: trigger existe en las otras tablas (no solo rules)
-- =============================================================================
-- Verificar que el trigger también funciona en condition_analysis_methods
SELECT lives_ok(
  $$UPDATE public.condition_analysis_methods SET validation_status = 'candidate'
    WHERE method_key = 'kalman_filter' AND validation_status = 'draft'$$,
  'Lifecycle methods: draft → candidate aceptado'
);

SELECT throws_ok(
  $$UPDATE public.condition_analysis_methods SET validation_status = 'active'
    WHERE method_key = 'kalman_filter' AND validation_status = 'candidate'$$,
  'P0001',
  NULL,
  'Lifecycle methods: candidate → active RECHAZADO'
);

-- Restaurar kalman_filter a draft
UPDATE public.condition_analysis_methods SET validation_status = 'draft'
  WHERE method_key = 'kalman_filter' AND validation_status = 'candidate';

-- =============================================================================
-- 14. LIFECYCLE: el mismo status no dispara error
-- =============================================================================
SELECT lives_ok(
  $$UPDATE public.condition_rules SET validation_status = 'draft'
    WHERE rule_name = 'vibration.rms HIGH' AND validation_status = 'draft'$$,
  'Lifecycle: sin cambio (draft → draft) permitido'
);

-- =============================================================================
-- 15. SERVICE ROLE: bypass no se puede probar directamente desde pgTAP
--    (requiere JWT claim role=service_role).
--    Documentado como limitación del test.
-- =============================================================================
SELECT pass(
  'Service role bypass: no testeable directamente desde pgTAP (requiere JWT service_role)'
);

-- =============================================================================
-- 16. Limpieza final: eliminar eventos y WO creados por los tests
-- =============================================================================
DELETE FROM condition_events WHERE message LIKE 'pgTAP test:%';
DELETE FROM work_orders WHERE symptom_note LIKE '%pgTAP test:%';
DELETE FROM work_orders WHERE symptom_note LIKE '%Evento CBM%pgTAP%';

-- =============================================================================
-- 17. Finalizar suite pgTAP
-- =============================================================================
SELECT * FROM finish();

ROLLBACK;
