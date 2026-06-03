-- =============================================================================
-- Labor Records — Test Suite (pgTAP)
-- 9 test cases: Schema & constraints, RLS, FSM validation, COMP→CLOSED sum,
--               updated_at trigger
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/labor_records_test.sql
--
-- Ejecutar (manual, sin pgTAP):
--   psql -f supabase/tests/database/labor_records_test.sql
--
-- Dependencias: auth.users disponible (Supabase estándar), pgTAP instalado.
-- =============================================================================

BEGIN;

SELECT plan(11);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: seed data para FKs y escenarios
-- ─────────────────────────────────────────────────────────────────────────────

-- Tipos de activo y activo (para work_orders FK)
INSERT INTO asset_types (id, name) VALUES ('LABOR_TEST', 'Labor Test Asset Type')
ON CONFLICT (id) DO NOTHING;

INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('LABOR-TEST-ASSET', 'EQ-LABOR-TEST', 'Activo de prueba labor_records', 'LABOR_TEST')
ON CONFLICT (id) DO NOTHING;

-- Usuarios en auth.users (necesario para FK user_profiles)
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'tech1@labor-test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000102', 'tech2@labor-test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000103', 'planner@labor-test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000104', 'admin@labor-test.com', '$2a$10$placeholder', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Perfiles de usuario (para get_user_role() y FK technician_id)
INSERT INTO user_profiles (id, role) VALUES
  ('00000000-0000-0000-0000-000000000101', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000102', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000103', 'PLANNER'),
  ('00000000-0000-0000-0000-000000000104', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

-- Órdenes de trabajo en distintas fases del lifecycle
INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase) VALUES
  ('LR-TEST-INPRG', 'EQ-LR-1', 'LABOR-TEST-ASSET', 'INPRG'),
  ('LR-TEST-WAPPR', 'EQ-LR-2', 'LABOR-TEST-ASSET', 'WAPPR'),
  ('LR-TEST-COMP',  'EQ-LR-3', 'LABOR-TEST-ASSET', 'COMP')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Test 1: Tabla labor_records existe
-- ─────────────────────────────────────────────────────────────────────────────
SELECT has_table('labor_records', 'Test 1 — Tabla labor_records existe');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Test 2: CHECK constraint — código de actividad válido aceptado
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test2;

INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
VALUES (
  'LR-TEST-INPRG',
  '00000000-0000-0000-0000-000000000101',
  NOW(),
  'DIRECT_WORK'
);

SELECT is(
  (SELECT COUNT(*) FROM labor_records
   WHERE work_order_id = 'LR-TEST-INPRG'
     AND activity_code = 'DIRECT_WORK'),
  1::bigint,
  'Test 2 — INSERT con DIRECT_WORK aceptado'
);

ROLLBACK TO SAVEPOINT test2;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Test 3: CHECK constraint — código de actividad inválido rechazado
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test3;

SELECT throws_ok(
  $$ INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
     VALUES ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000101', NOW(), 'INVALID') $$,
  '23514',
  NULL,
  'Test 3 — Código INVALID rechazado por CHECK constraint'
);

ROLLBACK TO SAVEPOINT test3;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Test 4: FSM — INSERT sesión activa (end_time=NULL) para WO en INPRG
--    debe ser ACEPTADA
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test4;

INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
VALUES (
  'LR-TEST-INPRG',
  '00000000-0000-0000-0000-000000000101',
  NOW(),
  'DIRECT_WORK'
);

SELECT is(
  (SELECT COUNT(*) FROM labor_records
   WHERE work_order_id = 'LR-TEST-INPRG'
     AND end_time IS NULL),
  1::bigint,
  'Test 4 — Sesión activa para WO en INPRG aceptada'
);

ROLLBACK TO SAVEPOINT test4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Test 5: FSM — INSERT sesión activa (end_time=NULL) para WO en WAPPR
--    debe ser RECHAZADA
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test5;

SELECT throws_ok(
  $$ INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
     VALUES ('LR-TEST-WAPPR', '00000000-0000-0000-0000-000000000101', NOW(), 'DIRECT_WORK') $$,
  'P0001',
  NULL,
  'Test 5 — Sesión activa para WO en WAPPR rechazada por FSM'
);

ROLLBACK TO SAVEPOINT test5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Test 6: FSM — INSERT sesión activa para WO inexistente
--    debe ser RECHAZADA
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test6;

SELECT throws_ok(
  $$ INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
     VALUES ('LR-NONEXISTENT', '00000000-0000-0000-0000-000000000101', NOW(), 'DIRECT_WORK') $$,
  'P0001',
  NULL,
  'Test 6 — Sesión activa para WO inexistente rechazada'
);

ROLLBACK TO SAVEPOINT test6;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Test 7: trg_labor_sum_hours() — COMP→CLOSED suma horas en actual_hours
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test7;

-- Insertar dos registros de labor para la WO en COMP
INSERT INTO labor_records (work_order_id, technician_id, start_time, end_time, activity_code)
VALUES
  ('LR-TEST-COMP', '00000000-0000-0000-0000-000000000101',
   NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'DIRECT_WORK'),
  ('LR-TEST-COMP', '00000000-0000-0000-0000-000000000101',
   NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '15 minutes', 'TRAVEL');

-- Transicionar COMP → CLOSED
UPDATE work_orders
SET lifecycle_phase = 'CLOSED'
WHERE id = 'LR-TEST-COMP';

SELECT is(
  (SELECT actual_hours FROM work_orders WHERE id = 'LR-TEST-COMP'),
  (2.0 + 0.5)::numeric,  -- 2h + 0.5h = 2.5 horas
  'Test 7 — actual_hours = 2.5 después de COMP→CLOSED'
);

ROLLBACK TO SAVEPOINT test7;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Test 8: updated_at se actualiza automáticamente en UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test8;

INSERT INTO labor_records (work_order_id, technician_id, start_time, end_time, activity_code)
VALUES (
  'LR-TEST-INPRG',
  '00000000-0000-0000-0000-000000000101',
  NOW() - INTERVAL '2 hours',
  NOW() - INTERVAL '1 hour',
  'DIRECT_WORK'
);

-- Forzar pausa para que updated_at sea distinto
UPDATE labor_records
SET notes = 'Nota actualizada'
WHERE work_order_id = 'LR-TEST-INPRG'
  AND technician_id = '00000000-0000-0000-0000-000000000101';

SELECT ok(
  (SELECT updated_at > created_at FROM labor_records
   WHERE work_order_id = 'LR-TEST-INPRG'
     AND technician_id = '00000000-0000-0000-0000-000000000101'),
  'Test 8 — updated_at > created_at después de UPDATE'
);

ROLLBACK TO SAVEPOINT test8;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Test 9: RLS — TECHNICIAN ve solo sus propios registros
--    Pre-insertamos datos de 2 técnicos, luego consultamos como tech1
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test9;

INSERT INTO labor_records (work_order_id, technician_id, start_time, end_time, activity_code)
VALUES
  ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000101', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'DIRECT_WORK'),
  ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000102', NOW() - INTERVAL '1 hour', NOW(), 'TRAVEL');

-- Cambiar a rol authenticated + contexto de tech1
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000101';

SELECT is(
  (SELECT COUNT(*) FROM labor_records WHERE work_order_id = 'LR-TEST-INPRG'),
  1::bigint,
  'Test 9 — TECHNICIAN tech1 ve solo 1 registro propio (no el de tech2)'
);

-- Restaurar contexto
RESET ROLE;

ROLLBACK TO SAVEPOINT test9;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Test 10: RLS — TECHNICIAN no puede INSERT para otro técnico
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test10;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000101';

SELECT throws_ok(
  $$ INSERT INTO labor_records (work_order_id, technician_id, start_time, activity_code)
     VALUES ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000102', NOW(), 'DIRECT_WORK') $$,
  '23514',  -- policy violation
  NULL,
  'Test 10 — TECHNICIAN no puede INSERT para otro técnico'
);

RESET ROLE;

ROLLBACK TO SAVEPOINT test10;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Test 11: RLS — PLANNER puede SELECT todas
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT test11;

INSERT INTO labor_records (work_order_id, technician_id, start_time, end_time, activity_code)
VALUES
  ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000101', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'DIRECT_WORK'),
  ('LR-TEST-INPRG', '00000000-0000-0000-0000-000000000102', NOW() - INTERVAL '1 hour', NOW(), 'TRAVEL');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000103';

SELECT is(
  (SELECT COUNT(*) FROM labor_records WHERE work_order_id = 'LR-TEST-INPRG'),
  2::bigint,
  'Test 11 — PLANNER ve todos los registros (2)'
);

RESET ROLE;

ROLLBACK TO SAVEPOINT test11;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM labor_records WHERE work_order_id LIKE 'LR-TEST-%';
DELETE FROM work_orders WHERE id LIKE 'LR-TEST-%';
DELETE FROM user_profiles WHERE id LIKE '00000000-0000-0000-0000-00000000010%';
DELETE FROM auth.users WHERE id LIKE '00000000-0000-0000-0000-00000000010%';
DELETE FROM assets WHERE id = 'LABOR-TEST-ASSET';
DELETE FROM asset_types WHERE id = 'LABOR_TEST';

-- ─────────────────────────────────────────────────────────────────────────────
-- Finalizar (pgTAP)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
