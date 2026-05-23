-- =============================================================================
-- CBM Alert Trigger — Test Suite
-- 4 test cases (TDD): Normal, Warning, Critical, Anti-Spam
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/cbm_trigger_test.sql
--
-- Ejecutar (manual, sin pgTAP):
--   psql -f supabase/tests/database/cbm_trigger_test.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: pgTAP plan (cuando está disponible)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

SELECT plan(4);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Seed: activo, medidor, punto de medición
-- ─────────────────────────────────────────────────────────────────────────────
WITH seed AS (
  INSERT INTO asset_types (id, name) VALUES ('TEST_MOTOR', 'Test Motor')
  ON CONFLICT (id) DO NOTHING
)
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('TEST-ASSET-001', 'EQ-TEST-001', 'Motor de prueba TDD', 'TEST_MOTOR')
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_plans (code, description, intervention_type)
VALUES ('TEST-CBM-PLAN', 'Plan de prueba CBM', 'INSPECTION')
ON CONFLICT (code) DO NOTHING;

WITH meter_id AS (
  INSERT INTO meters (asset_id, code, meter_type, uom)
  VALUES ('TEST-ASSET-001', 'TEMP-TEST', 'CONTINUOUS', '°C')
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO measure_points (meter_id, upper_limit_warning, upper_limit_critical)
SELECT id, 80, 90 FROM meter_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Test 1: Lectura Normal (50°C) — sin alerta, sin WO
-- ─────────────────────────────────────────────────────────────────────────────
WITH meter AS (
  SELECT id FROM meters WHERE code = 'TEMP-TEST' LIMIT 1
),
reading AS (
  INSERT INTO meter_readings (meter_id, reading_value)
  SELECT id, 50 FROM meter
  RETURNING is_alert_triggered
)
SELECT is(
  (SELECT is_alert_triggered FROM reading),
  false,
  'Test 1 — Normal 50°C: is_alert_triggered = false'
);

SELECT ok(
  (SELECT COUNT(*) = 0 FROM work_orders
   WHERE asset_id = 'TEST-ASSET-001' AND wo_type = 'CBM'),
  'Test 1 — Normal 50°C: no se creó WO'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Test 2: Lectura Warning (85°C) — alerta true, pero SIN WO
-- ─────────────────────────────────────────────────────────────────────────────
WITH meter AS (
  SELECT id FROM meters WHERE code = 'TEMP-TEST' LIMIT 1
),
reading AS (
  INSERT INTO meter_readings (meter_id, reading_value)
  SELECT id, 85 FROM meter
  RETURNING is_alert_triggered
)
SELECT is(
  (SELECT is_alert_triggered FROM reading),
  true,
  'Test 2 — Warning 85°C: is_alert_triggered = true'
);

SELECT ok(
  (SELECT COUNT(*) = 0 FROM work_orders
   WHERE asset_id = 'TEST-ASSET-001' AND wo_type = 'CBM'),
  'Test 2 — Warning 85°C: NO se creó WO (solo marcador)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Test 3: Lectura CRÍTICA (95°C) — alerta true + WO creada
-- ─────────────────────────────────────────────────────────────────────────────
WITH meter AS (
  SELECT id FROM meters WHERE code = 'TEMP-TEST' LIMIT 1
),
reading AS (
  INSERT INTO meter_readings (meter_id, reading_value)
  SELECT id, 95 FROM meter
  RETURNING is_alert_triggered
),
wo_count AS (
  SELECT COUNT(*) AS cnt FROM work_orders
  WHERE asset_id = 'TEST-ASSET-001' AND wo_type = 'CBM'
)
SELECT is(
  (SELECT is_alert_triggered FROM reading),
  true,
  'Test 3 — Critical 95°C: is_alert_triggered = true'
);

SELECT ok(
  (SELECT COUNT(*) = 1 FROM work_orders
   WHERE asset_id = 'TEST-ASSET-001' AND wo_type = 'CBM'),
  'Test 3 — Critical 95°C: exactamente 1 WO creada'
);

SELECT results_eq(
  'SELECT wo_type, criticality FROM work_orders
   WHERE asset_id = ''TEST-ASSET-001'' AND wo_type = ''CBM''',
  $$ VALUES ('CBM'::text, 'A'::text) $$,
  'Test 3 — Critical 95°C: wo_type = CBM, criticality = A'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Test 4: Anti-Spam — segunda lectura CRÍTICA (96°C) — alerta true, SIN nueva WO
-- ─────────────────────────────────────────────────────────────────────────────
WITH meter AS (
  SELECT id FROM meters WHERE code = 'TEMP-TEST' LIMIT 1
),
reading AS (
  INSERT INTO meter_readings (meter_id, reading_value)
  SELECT id, 96 FROM meter
  RETURNING is_alert_triggered
)
SELECT is(
  (SELECT is_alert_triggered FROM reading),
  true,
  'Test 4 — Anti-Spam 96°C: is_alert_triggered = true'
);

SELECT ok(
  (SELECT COUNT(*) = 1 FROM work_orders
   WHERE asset_id = 'TEST-ASSET-001' AND meter_id = (SELECT id FROM meters WHERE code = 'TEMP-TEST' LIMIT 1)
     AND wo_type = 'CBM'),
  'Test 4 — Anti-Spam 96°C: conteo WO sigue siendo 1 (no duplicó)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM meter_readings WHERE meter_id IN (SELECT id FROM meters WHERE code = 'TEMP-TEST');
DELETE FROM work_orders WHERE asset_id = 'TEST-ASSET-001' AND wo_type = 'CBM';
DELETE FROM measure_points WHERE meter_id IN (SELECT id FROM meters WHERE code = 'TEMP-TEST');
DELETE FROM meters WHERE code = 'TEMP-TEST';
DELETE FROM job_plans WHERE code = 'TEST-CBM-PLAN';
DELETE FROM assets WHERE id = 'TEST-ASSET-001';
DELETE FROM asset_types WHERE id = 'TEST_MOTOR';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Finalizar (pgTAP)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
