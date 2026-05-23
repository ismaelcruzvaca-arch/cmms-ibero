-- =============================================================================
-- PM Engine — Test Suite (pgTAP)
-- 7 test cases (TDD): Basic, Suppression 1N, No-Suppress, Suppression 3N,
--                     Material Inheritance, Empty, Clock Recalc
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test
--
-- NOTA: Requiere schema ISO 14224 completo (job_plans, pm_schedules, etc.)
-- No ejecutar en producción — el schema no coincide.
-- =============================================================================

BEGIN;

SELECT plan(14);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Seed global: assets, job_plans, job_plan_materials (compartido entre tests)
-- ─────────────────────────────────────────────────────────────────────────────
WITH seed_at AS (
  INSERT INTO asset_types (id, name) VALUES ('TEST_PM', 'PM Test Type')
  ON CONFLICT (id) DO NOTHING
)
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES
  ('PM-TEST-001', 'EQ-PM-001', 'Activo PM prueba #1', 'TEST_PM'),
  ('PM-TEST-002', 'EQ-PM-002', 'Activo PM prueba #2', 'TEST_PM')
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_plans (code, description, intervention_type, estimated_hours)
VALUES
  ('PM-TEST-JP1', 'Plan de prueba PM #1', 'INSPECTION', 2.5),
  ('PM-TEST-JP2', 'Plan de prueba PM #2', 'LUBRICATION', 1.0)
ON CONFLICT (code) DO NOTHING;

-- JP1 tiene 2 materiales; JP2 no tiene materiales
INSERT INTO job_plan_materials (job_plan_id, part_num, planned_qty)
SELECT jp.id, 'PART-001', 2
FROM job_plans jp WHERE jp.code = 'PM-TEST-JP1'
UNION ALL
SELECT jp.id, 'PART-002', 1
FROM job_plans jp WHERE jp.code = 'PM-TEST-JP1';

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: obtener IDs de datos sembrados
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP VIEW v_test_ids AS
SELECT
  (SELECT id FROM assets WHERE id = 'PM-TEST-001') AS asset_1_id,
  (SELECT id FROM assets WHERE id = 'PM-TEST-002') AS asset_2_id,
  (SELECT id FROM job_plans WHERE code = 'PM-TEST-JP1') AS jp_1_id,
  (SELECT id FROM job_plans WHERE code = 'PM-TEST-JP2') AS jp_2_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Test 1: Schedule vencido básico → 1 OT con wo_type='PM'
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test1;

INSERT INTO pm_schedules (asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT asset_1_id, jp_1_id, 30, CURRENT_DATE - INTERVAL '5 days'
FROM v_test_ids;

SELECT is(
  generate_due_preventive_work_orders(),
  1,
  'Test 1 — Schedule básico: retorna 1 OT creada'
);

SELECT results_eq(
  $$ SELECT wo_type, lifecycle_phase FROM work_orders
     WHERE asset_id = 'PM-TEST-001' AND wo_type = 'PM' $$,
  $$ VALUES ('PM'::text, 'WAPPR'::text) $$,
  'Test 1 — Schedule básico: wo_type = PM, lifecycle_phase = WAPPR'
);

ROLLBACK TO SAVEPOINT test1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Test 2: Padre + hijo vencidos → solo OT del padre (supresión 1 nivel)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test2;

-- Crear schedule padre
INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT '550e8400-e29b-41d4-a716-446655440001'::uuid, asset_1_id, jp_1_id, 90, CURRENT_DATE - INTERVAL '1 day'
FROM v_test_ids;

-- Crear schedule hijo (padre vencido → debe suprimirse)
INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, parent_schedule_id)
SELECT '550e8400-e29b-41d4-a716-446655440002'::uuid, asset_1_id, jp_2_id, 30, CURRENT_DATE - INTERVAL '1 day',
       '550e8400-e29b-41d4-a716-446655440001'::uuid;

SELECT is(
  generate_due_preventive_work_orders(),
  1,
  'Test 2 — Supresión 1 nivel: retorna 1 OT (solo padre)'
);

SELECT ok(
  (SELECT COUNT(*) = 1 FROM work_orders
   WHERE asset_id = 'PM-TEST-001' AND wo_type = 'PM'),
  'Test 2 — Supresión 1 nivel: exactamente 1 WO para PM-TEST-001'
);

ROLLBACK TO SAVEPOINT test2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Test 3: Hijo vencido, padre NO vencido → OT del hijo (sin supresión)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test3;

-- Crear schedule padre (NO vencido)
INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT '550e8400-e29b-41d4-a716-446655440003'::uuid, asset_1_id, jp_1_id, 90, CURRENT_DATE + INTERVAL '10 days'
FROM v_test_ids;

-- Crear schedule hijo (vencido, padre no vencido → NO se suprime)
INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, parent_schedule_id)
SELECT '550e8400-e29b-41d4-a716-446655440004'::uuid, asset_1_id, jp_2_id, 30, CURRENT_DATE - INTERVAL '1 day',
       '550e8400-e29b-41d4-a716-446655440003'::uuid;

SELECT is(
  generate_due_preventive_work_orders(),
  1,
  'Test 3 — Hijo vencido sin padre: retorna 1 OT (hijo)'
);

SELECT ok(
  (SELECT COUNT(*) = 1 FROM work_orders wo
   JOIN pm_schedules ps ON ps.id = '550e8400-e29b-41d4-a716-446655440004'
   WHERE wo.asset_id = 'PM-TEST-001' AND wo.wo_type = 'PM'),
  'Test 3 — Hijo vencido sin padre: WO generada para el hijo'
);

ROLLBACK TO SAVEPOINT test3;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Test 4: Abuelo + Padre + Hijo vencidos → solo OT del abuelo (3 niveles)
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test4;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT '550e8400-e29b-41d4-a716-446655440010'::uuid, asset_1_id, jp_1_id, 180, CURRENT_DATE - INTERVAL '1 day'
FROM v_test_ids;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, parent_schedule_id)
SELECT '550e8400-e29b-41d4-a716-446655440011'::uuid, asset_1_id, jp_1_id, 90, CURRENT_DATE - INTERVAL '1 day',
       '550e8400-e29b-41d4-a716-446655440010'::uuid;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, parent_schedule_id)
SELECT '550e8400-e29b-41d4-a716-446655440012'::uuid, asset_1_id, jp_2_id, 30, CURRENT_DATE - INTERVAL '1 day',
       '550e8400-e29b-41d4-a716-446655440011'::uuid;

SELECT is(
  generate_due_preventive_work_orders(),
  1,
  'Test 4 — Supresión 3 niveles: retorna 1 OT (solo abuelo)'
);

SELECT ok(
  (SELECT COUNT(*) = 0 FROM work_orders wo
   WHERE wo.asset_id = 'PM-TEST-001' AND wo.wo_type = 'PM'
     AND wo.job_plan_id = (SELECT jp_2_id FROM v_test_ids)),
  'Test 4 — Supresión 3 niveles: NO hay WO del job_plan del hijo/niño'
);

ROLLBACK TO SAVEPOINT test4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Test 5: Herencia de materiales — job_plan con 2 materiales
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test5;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT '550e8400-e29b-41d4-a716-446655440005'::uuid, asset_1_id, jp_1_id, 30, CURRENT_DATE - INTERVAL '1 day'
FROM v_test_ids;

SELECT generate_due_preventive_work_orders();

SELECT is(
  (SELECT COUNT(*) FROM material_requests mr
   JOIN work_orders wo ON wo.id = mr.work_order_id
   WHERE wo.asset_id = 'PM-TEST-001' AND wo.wo_type = 'PM'),
  2,
  'Test 5 — Herencia materiales: 2 material_requests creados desde job_plan'
);

ROLLBACK TO SAVEPOINT test5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Test 6: Sin schedules vencidas → retorna 0
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test6;

INSERT INTO pm_schedules (asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT asset_1_id, jp_1_id, 30, CURRENT_DATE + INTERVAL '30 days'
FROM v_test_ids;

SELECT is(
  generate_due_preventive_work_orders(),
  0,
  'Test 6 — Sin vencidos: retorna 0'
);

ROLLBACK TO SAVEPOINT test6;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Test 7: Recálculo de reloj — next_target_date avanza por frequency
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test7;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
SELECT '550e8400-e29b-41d4-a716-446655440020'::uuid, asset_1_id, jp_1_id, 30, CURRENT_DATE - INTERVAL '1 day'
FROM v_test_ids;

SELECT generate_due_preventive_work_orders();

SELECT is(
  (SELECT next_target_date::DATE FROM pm_schedules WHERE id = '550e8400-e29b-41d4-a716-446655440020'),
  (CURRENT_DATE - INTERVAL '1 day' + INTERVAL '30 days')::DATE,
  'Test 7 — Recálculo reloj: next_target_date = next_target_date + 30 días'
);

SELECT ok(
  (SELECT last_completion_date IS NOT NULL FROM pm_schedules
   WHERE id = '550e8400-e29b-41d4-a716-446655440020'),
  'Test 7 — Recálculo reloj: last_completion_date fue actualizado'
);

ROLLBACK TO SAVEPOINT test7;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cleanup: remover seed global
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_test_ids;

DELETE FROM job_plan_materials WHERE job_plan_id IN (SELECT id FROM job_plans WHERE code LIKE 'PM-TEST-%');
DELETE FROM job_plans WHERE code LIKE 'PM-TEST-%';
DELETE FROM assets WHERE id LIKE 'PM-TEST-%';
DELETE FROM asset_types WHERE id = 'TEST_PM';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Finalizar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
