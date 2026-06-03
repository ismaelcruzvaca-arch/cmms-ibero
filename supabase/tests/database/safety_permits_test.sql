-- =============================================================================
-- Safety & Permits (PTW + LOTO) — Test Suite (pgTAP)
-- 50 test cases: Schema (20), PTW FSM (10), LOTO FSM (8), RLS (8), Cascade (4)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/safety_permits_test.sql
--
-- Ejecutar (manual):
--   psql -f supabase/tests/database/safety_permits_test.sql
--
-- Dependencias: pgTAP instalado, auth.users disponible (Supabase estándar),
--   migrations 1-14 ejecutadas.
-- =============================================================================

BEGIN;

SELECT plan(50);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: seed data global para FKs en todos los escenarios
-- ─────────────────────────────────────────────────────────────────────────────

-- Asset type for testing
INSERT INTO asset_types (id, name) VALUES ('SAFETY_TEST', 'Safety Test Asset Type')
ON CONFLICT (id) DO NOTHING;

-- Asset
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('SAFETY-TEST-ASSET', 'EQ-SFTY', 'Safety & Permits test asset', 'SAFETY_TEST')
ON CONFLICT (id) DO NOTHING;

-- Work order (needed for FK work_permits.work_order_id and lockout_tagout.work_order_id)
INSERT INTO work_orders (id, equipment_id, asset_id, lifecycle_phase)
VALUES ('PTW-TEST-WO', 'EQ-PTW-001', 'SAFETY-TEST-ASSET', 'WAPPR')
ON CONFLICT (id) DO NOTHING;

-- Users for test roles (auth.users required for auth.uid() + get_user_role())
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000201', 'safety-tech@test.com',    '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000202', 'safety-planner@test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000203', 'safety-officer@test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000204', 'safety-admin@test.com',   '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000205', 'safety-tech2@test.com',   '$2a$10$placeholder', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- User profiles (get_user_role() reads from here)
INSERT INTO user_profiles (id, role)
VALUES
  ('00000000-0000-0000-0000-000000000201', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000202', 'PLANNER'),
  ('00000000-0000-0000-0000-000000000203', 'SAFETY_OFFICER'),
  ('00000000-0000-0000-0000-000000000204', 'ADMIN'),
  ('00000000-0000-0000-0000-000000000205', 'TECHNICIAN')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.1 — SCHEMA TESTS (tests 1-20)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1-5: Tables exist
SELECT has_table('permit_types',     'Test 1  — Table permit_types exists');
SELECT has_table('work_permits',     'Test 2  — Table work_permits exists');
SELECT has_table('permit_tasks',     'Test 3  — Table permit_tasks exists');
SELECT has_table('lockout_tagout',   'Test 4  — Table lockout_tagout exists');
SELECT has_table('tagout_devices',   'Test 5  — Table tagout_devices exists');

-- 6-8: ENUM types exist
SELECT has_type('permit_status', 'Test 6  — ENUM permit_status exists');
SELECT has_type('loto_status',   'Test 7  — ENUM loto_status exists');
SELECT has_type('device_type',   'Test 8  — ENUM device_type exists');

-- 9-11: ENUM values correct
SELECT is(
  (SELECT enum_range(NULL::permit_status)::text[]),
  ARRAY['REQUESTED','APPROVED','ACTIVE','COMPLETED','REJECTED','CANCELLED','EXPIRED']::text[],
  'Test 9  — permit_status has 7 correct values'
);

SELECT is(
  (SELECT enum_range(NULL::loto_status)::text[]),
  ARRAY['PLANNED','LOCKED','VERIFIED','REMOVED']::text[],
  'Test 10 — loto_status has 4 correct values'
);

SELECT is(
  (SELECT enum_range(NULL::device_type)::text[]),
  ARRAY['LOCK','TAG','HASPS','CHAIN']::text[],
  'Test 11 — device_type has 4 correct values'
);

-- 12: Seed data: exactly 7 permit_types
SELECT is(
  (SELECT COUNT(*)::int FROM permit_types),
  7,
  'Test 12 — permit_types has 7 seed rows'
);

-- 13-15: FK references
SELECT col_is_fk('work_permits', 'permit_type_id',
  'permit_types(id)',
  'Test 13 — work_permits.permit_type_id FK → permit_types(id)'
);

SELECT col_is_fk('permit_tasks', 'work_permit_id',
  'work_permits(id)',
  'Test 14 — permit_tasks.work_permit_id FK → work_permits(id) ON DELETE CASCADE'
);

SELECT col_is_fk('tagout_devices', 'lockout_tagout_id',
  'lockout_tagout(id)',
  'Test 15 — tagout_devices.lockout_tagout_id FK → lockout_tagout(id) ON DELETE CASCADE'
);

-- 16-18: Key column type checks
SELECT col_type_is('work_permits', 'permit_status', 'permit_status',
  'Test 16 — work_permits.permit_status is of type permit_status'
);

SELECT col_not_null('work_permits', 'description',
  'Test 17 — work_permits.description is NOT NULL'
);

SELECT col_type_is('lockout_tagout', 'loto_status', 'loto_status',
  'Test 18 — lockout_tagout.loto_status is of type loto_status'
);

-- 19: Default value for permit_status
SELECT col_has_default('work_permits', 'permit_status',
  'Test 19 — work_permits.permit_status has default value'
);

-- 20: CHECK constraint on gas_test_result
SELECT col_has_check('work_permits', 'gas_test_result',
  'Test 20 — work_permits.gas_test_result has CHECK (PASS/FAIL/NULL)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.2 — PTW FSM TESTS (tests 21-29)
-- ─────────────────────────────────────────────────────────────────────────────

-- 21-23: Full lifecycle REQUESTED → APPROVED → ACTIVE → COMPLETED
SAVEPOINT ptw_full;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  (SELECT id FROM permit_types WHERE code = 'HOT_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW full lifecycle test'
);

-- REQUESTED → APPROVED (gas_test not required for HOT_WORK? Actually HOT_WORK has requires_gas_test=true, so set gas_test_result='PASS' first)
UPDATE work_permits SET gas_test_result = 'PASS' WHERE id = '00000000-0000-0000-0000-000000000101';
UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000101';

UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000101';

UPDATE work_permits SET permit_status = 'COMPLETED' WHERE id = '00000000-0000-0000-0000-000000000101';

SELECT is(
  (SELECT permit_status::text FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000101'),
  'COMPLETED',
  'Test 21 — PTW full lifecycle ends at COMPLETED'
);

SELECT ok(
  (SELECT issued_at IS NOT NULL FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000101'),
  'Test 22 — issued_at was set on APPROVED→ACTIVE'
);

SELECT ok(
  (SELECT expires_at IS NOT NULL FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000101'),
  'Test 23 — expires_at was calculated on APPROVED→ACTIVE'
);

ROLLBACK TO SAVEPOINT ptw_full;

-- 24: Backward transition COMPLETED → ACTIVE rejected
SAVEPOINT ptw_back_completed;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000102',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW backward test'
);

UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000102';
UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000102';
UPDATE work_permits SET permit_status = 'COMPLETED' WHERE id = '00000000-0000-0000-0000-000000000102';

SELECT throws_ok(
  $$ UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000102' $$,
  'P0001',
  NULL,
  'Test 24 — COMPLETED → ACTIVE backward transition rejected'
);

ROLLBACK TO SAVEPOINT ptw_back_completed;

-- 25: Gas test gate — APPROVED → ACTIVE rejected when gas_test_result IS NULL
SAVEPOINT ptw_gas_gate;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description, gas_test_required)
VALUES (
  '00000000-0000-0000-0000-000000000103',
  (SELECT id FROM permit_types WHERE code = 'HOT_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW gas test gate test',
  true
);

UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000103';

SELECT throws_ok(
  $$ UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000103' $$,
  'P0001',
  NULL,
  'Test 25 — Gas test gate: APPROVED→ACTIVE rejected when gas_test_result IS NULL'
);

ROLLBACK TO SAVEPOINT ptw_gas_gate;

-- 26: Gas test PASS — APPROVED → ACTIVE succeeds with gas_test_result='PASS'
SAVEPOINT ptw_gas_pass;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description, gas_test_required)
VALUES (
  '00000000-0000-0000-0000-000000000104',
  (SELECT id FROM permit_types WHERE code = 'HOT_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW gas test pass test',
  true
);

UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000104';
UPDATE work_permits SET gas_test_result = 'PASS' WHERE id = '00000000-0000-0000-0000-000000000104';
UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000104';

SELECT is(
  (SELECT permit_status::text FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000104'),
  'ACTIVE',
  'Test 26 — Gas test PASS: APPROVED→ACTIVE succeeds with gas_test_result=''PASS'''
);

ROLLBACK TO SAVEPOINT ptw_gas_pass;

-- 27: Auto-expiry — ACTIVE with past expires_at transitions to EXPIRED on UPDATE
SAVEPOINT ptw_auto_expiry;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description, gas_test_required)
VALUES (
  '00000000-0000-0000-0000-000000000105',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW auto-expiry test',
  false
);

UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000105';
UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000105';

-- Set expires_at to the past (must keep chk_expires_after_issued happy)
UPDATE work_permits
SET expires_at = NOW() - INTERVAL '1 hour',
    issued_at  = NOW() - INTERVAL '10 hours'
WHERE id = '00000000-0000-0000-0000-000000000105';

-- Confirm still ACTIVE (auto-expiry checks OLD.expires_at, which was future on first write)
SELECT is(
  (SELECT permit_status::text FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000105'),
  'ACTIVE',
  'Test 27a — ACTIVE preserved after manual expires_at set to past'
);

-- Trigger auto-expiry via any UPDATE that does NOT change permit_status
UPDATE work_permits SET description = 'Trigger auto-expiry' WHERE id = '00000000-0000-0000-0000-000000000105';

SELECT is(
  (SELECT permit_status::text FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000105'),
  'EXPIRED',
  'Test 27b — Auto-expiry: ACTIVE with past expires_at → EXPIRED on UPDATE'
);

ROLLBACK TO SAVEPOINT ptw_auto_expiry;

-- 28: Invalid permit_status value rejected
SAVEPOINT ptw_invalid_status;

SELECT throws_ok(
  $$ INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
     VALUES (
       '00000000-0000-0000-0000-000000000106',
       (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
       'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
       'INVALID_STATUS',
       '00000000-0000-0000-0000-000000000202',
       '00000000-0000-0000-0000-000000000203',
       'Invalid status test'
     ) $$,
  '22P02',
  NULL,
  'Test 28 — Invalid permit_status value rejected by ENUM'
);

ROLLBACK TO SAVEPOINT ptw_invalid_status;

-- 29: ACTIVE → APPROVED backward rejected
SAVEPOINT ptw_back_active;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description, gas_test_required)
VALUES (
  '00000000-0000-0000-0000-000000000107',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'PTW backward ACTIVE test',
  false
);

UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000107';
UPDATE work_permits SET permit_status = 'ACTIVE' WHERE id = '00000000-0000-0000-0000-000000000107';

SELECT throws_ok(
  $$ UPDATE work_permits SET permit_status = 'APPROVED' WHERE id = '00000000-0000-0000-0000-000000000107' $$,
  'P0001',
  NULL,
  'Test 29 — ACTIVE → APPROVED backward transition rejected'
);

ROLLBACK TO SAVEPOINT ptw_back_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.3 — LOTO FSM TESTS (tests 30-37)
-- ─────────────────────────────────────────────────────────────────────────────

-- 30-32: Full lifecycle PLANNED → LOCKED → VERIFIED → REMOVED
SAVEPOINT loto_full;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by, verified_by)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'LOTO full lifecycle test',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202'
);

-- PLANNED → LOCKED
UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000201';

-- LOCKED → VERIFIED (two-person: locked_by != verified_by ✓)
UPDATE lockout_tagout SET loto_status = 'VERIFIED' WHERE id = '00000000-0000-0000-0000-000000000201';

-- VERIFIED → REMOVED (need removed_by)
UPDATE lockout_tagout SET loto_status = 'REMOVED', removed_by = '00000000-0000-0000-0000-000000000203' WHERE id = '00000000-0000-0000-0000-000000000201';

SELECT is(
  (SELECT loto_status::text FROM lockout_tagout WHERE id = '00000000-0000-0000-0000-000000000201'),
  'REMOVED',
  'Test 30 — LOTO full lifecycle ends at REMOVED'
);

SELECT ok(
  (SELECT locked_at IS NOT NULL FROM lockout_tagout WHERE id = '00000000-0000-0000-0000-000000000201'),
  'Test 31 — locked_at set on PLANNED→LOCKED'
);

SELECT ok(
  (SELECT verified_at IS NOT NULL FROM lockout_tagout WHERE id = '00000000-0000-0000-0000-000000000201'),
  'Test 32 — verified_at set on LOCKED→VERIFIED'
);

ROLLBACK TO SAVEPOINT loto_full;

-- 33: Skip verification — LOCKED → REMOVED rejected
SAVEPOINT loto_skip;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by)
VALUES (
  '00000000-0000-0000-0000-000000000203',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'LOTO skip verification test',
  '00000000-0000-0000-0000-000000000201'
);

UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000203';

SELECT throws_ok(
  $$ UPDATE lockout_tagout SET loto_status = 'REMOVED', removed_by = '00000000-0000-0000-0000-000000000202' WHERE id = '00000000-0000-0000-0000-000000000203' $$,
  'P0001',
  NULL,
  'Test 33 — LOTO skip verification: LOCKED→REMOVED rejected'
);

ROLLBACK TO SAVEPOINT loto_skip;

-- 34: Two-person rule — verified_by == locked_by rejected
SAVEPOINT loto_two_person_fail;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by)
VALUES (
  '00000000-0000-0000-0000-000000000208',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'LOTO two-person rule fail test',
  '00000000-0000-0000-0000-000000000201'
);

UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000208';

SELECT throws_ok(
  $$ UPDATE lockout_tagout SET loto_status = 'VERIFIED', verified_by = '00000000-0000-0000-0000-000000000201' WHERE id = '00000000-0000-0000-0000-000000000208' $$,
  'P0001',
  NULL,
  'Test 34 — Two-person rule: verified_by = locked_by rejected'
);

ROLLBACK TO SAVEPOINT loto_two_person_fail;

-- 35: Two-person rule — verified_by != locked_by succeeds (already tested in lifecycle, but explicit)
SAVEPOINT loto_two_person_pass;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by, verified_by)
VALUES (
  '00000000-0000-0000-0000-000000000209',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'LOTO two-person rule pass test',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202'
);

UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000209';
UPDATE lockout_tagout SET loto_status = 'VERIFIED' WHERE id = '00000000-0000-0000-0000-000000000209';

SELECT is(
  (SELECT loto_status::text FROM lockout_tagout WHERE id = '00000000-0000-0000-0000-000000000209'),
  'VERIFIED',
  'Test 35 — Two-person rule: verified_by != locked_by → VERIFIED succeeds'
);

ROLLBACK TO SAVEPOINT loto_two_person_pass;

-- 36: Invalid loto_status value rejected
SAVEPOINT loto_invalid_status;

SELECT throws_ok(
  $$ INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by)
     VALUES (
       '00000000-0000-0000-0000-000000000207', NULL,
       'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
       'INVALID_LOTO',
       'Invalid LOTO status test',
       '00000000-0000-0000-0000-000000000201'
     ) $$,
  '22P02',
  NULL,
  'Test 36 — Invalid loto_status value rejected by ENUM'
);

ROLLBACK TO SAVEPOINT loto_invalid_status;

-- 37: Backward transition VERIFIED → LOCKED rejected
SAVEPOINT loto_backward;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by, verified_by)
VALUES (
  '00000000-0000-0000-0000-000000000206',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'LOTO backward test',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202'
);

UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000206';
UPDATE lockout_tagout SET loto_status = 'VERIFIED' WHERE id = '00000000-0000-0000-0000-000000000206';

SELECT throws_ok(
  $$ UPDATE lockout_tagout SET loto_status = 'LOCKED' WHERE id = '00000000-0000-0000-0000-000000000206' $$,
  'P0001',
  NULL,
  'Test 37 — VERIFIED → LOCKED backward transition rejected'
);

ROLLBACK TO SAVEPOINT loto_backward;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.4 — RLS TESTS (tests 38-45)
-- ─────────────────────────────────────────────────────────────────────────────
-- Todas las RLS usan get_user_role() que lee de user_profiles.
-- auth.uid() se setea via "request.jwt.claim.sub".
-- RLS solo aplica para rol "authenticated".
-- ─────────────────────────────────────────────────────────────────────────────

-- 38: TECHNICIAN can SELECT work_permits
SAVEPOINT rls_tech_select;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000301',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000203',
  'RLS TECH SELECT test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000201';

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000301'),
  1,
  'Test 38 — TECHNICIAN can SELECT work_permits'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select;

-- 39: TECHNICIAN cannot INSERT work_permits (WITH CHECK blocks it)
SAVEPOINT rls_tech_insert;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000201';

SELECT throws_ok(
  $$ INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
     VALUES (
       '00000000-0000-0000-0000-000000000302',
       (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
       'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
       'REQUESTED',
       '00000000-0000-0000-0000-000000000201',
       '00000000-0000-0000-0000-000000000203',
       'RLS TECH INSERT test'
     ) $$,
  '23514',
  NULL,
  'Test 39 — TECHNICIAN cannot INSERT work_permits (RLS)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_insert;

-- 40: TECHNICIAN cannot UPDATE work_permits (USING blocks visibility)
SAVEPOINT rls_tech_update;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000303',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000203',
  'RLS TECH UPDATE test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000201';

UPDATE work_permits SET description = 'RLS blocked update' WHERE id = '00000000-0000-0000-0000-000000000303';

SELECT is(
  (SELECT description FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000303'),
  'RLS TECH UPDATE test',
  'Test 40 — TECHNICIAN cannot UPDATE work_permits (description unchanged)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_update;

-- 41: TECHNICIAN cannot DELETE work_permits (USING blocks visibility)
SAVEPOINT rls_tech_delete;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000304',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000203',
  'RLS TECH DELETE test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000201';

DELETE FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000304';

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000304'),
  1,
  'Test 41 — TECHNICIAN cannot DELETE work_permits (row still exists)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_delete;

-- 42: PLANNER can INSERT work_permits
SAVEPOINT rls_planner_insert;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000202';

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000305',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'RLS PLANNER INSERT test'
);

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000305'),
  1,
  'Test 42 — PLANNER can INSERT work_permits'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_planner_insert;

-- 43: PLANNER cannot DELETE work_permits
SAVEPOINT rls_planner_delete;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000306',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'RLS PLANNER DELETE test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000202';

DELETE FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000306';

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000306'),
  1,
  'Test 43 — PLANNER cannot DELETE work_permits (row still exists)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_planner_delete;

-- 44: SAFETY_OFFICER can DELETE work_permits
SAVEPOINT rls_safety_delete;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000307',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'RLS SAFETY_OFFICER DELETE test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000203';

DELETE FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000307';

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000307'),
  0,
  'Test 44 — SAFETY_OFFICER can DELETE work_permits (row removed)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_safety_delete;

-- 45: ADMIN can DELETE work_permits
SAVEPOINT rls_admin_delete;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000308',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'RLS ADMIN DELETE test'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000204';

DELETE FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000308';

SELECT is(
  (SELECT COUNT(*)::int FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000308'),
  0,
  'Test 45 — ADMIN can DELETE work_permits (row removed)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_admin_delete;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.5 — CASCADE TESTS (tests 46-47)
-- ─────────────────────────────────────────────────────────────────────────────

-- 46: DELETE work_permit → permit_tasks ON DELETE CASCADE
SAVEPOINT cascade_permit_tasks;

INSERT INTO work_permits (id, permit_type_id, work_order_id, asset_id, permit_status, requested_by, approved_by, description)
VALUES (
  '00000000-0000-0000-0000-000000000401',
  (SELECT id FROM permit_types WHERE code = 'COLD_WORK'),
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'REQUESTED',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  'Cascade test permit'
);

INSERT INTO permit_tasks (work_permit_id, step_sequence, task_description, is_precaution)
VALUES
  ('00000000-0000-0000-0000-000000000401', 1, 'Task 1', false),
  ('00000000-0000-0000-0000-000000000401', 2, 'Task 2', false),
  ('00000000-0000-0000-0000-000000000401', 3, 'Precaution 1', true);

-- Verify 3 tasks exist
SELECT is(
  (SELECT COUNT(*)::int FROM permit_tasks WHERE work_permit_id = '00000000-0000-0000-0000-000000000401'),
  3,
  'Test 46a — 3 permit_tasks under permit before delete'
);

-- Delete the permit
DELETE FROM work_permits WHERE id = '00000000-0000-0000-0000-000000000401';

SELECT is(
  (SELECT COUNT(*)::int FROM permit_tasks WHERE work_permit_id = '00000000-0000-0000-0000-000000000401'),
  0,
  'Test 46b — permit_tasks cascade-deleted after permit DELETE'
);

ROLLBACK TO SAVEPOINT cascade_permit_tasks;

-- 47: DELETE lockout_tagout → tagout_devices ON DELETE CASCADE
SAVEPOINT cascade_loto_devices;

INSERT INTO lockout_tagout (id, work_permit_id, work_order_id, asset_id, loto_status, description, locked_by)
VALUES (
  '00000000-0000-0000-0000-000000000402',
  NULL,
  'PTW-TEST-WO', 'SAFETY-TEST-ASSET',
  'PLANNED',
  'Cascade test LOTO',
  '00000000-0000-0000-0000-000000000201'
);

INSERT INTO tagout_devices (lockout_tagout_id, device_type, device_id, device_label)
VALUES
  ('00000000-0000-0000-0000-000000000402', 'LOCK',  'LOCK-001', 'Candado #1'),
  ('00000000-0000-0000-0000-000000000402', 'TAG',   'TAG-001',  'Etiqueta #1'),
  ('00000000-0000-0000-0000-000000000402', 'HASPS', 'HASPS-001', 'Haspa #1');

-- Verify 3 devices exist
SELECT is(
  (SELECT COUNT(*)::int FROM tagout_devices WHERE lockout_tagout_id = '00000000-0000-0000-0000-000000000402'),
  3,
  'Test 47a — 3 tagout_devices under LOTO before delete'
);

-- Delete the LOTO
DELETE FROM lockout_tagout WHERE id = '00000000-0000-0000-0000-000000000402';

SELECT is(
  (SELECT COUNT(*)::int FROM tagout_devices WHERE lockout_tagout_id = '00000000-0000-0000-0000-000000000402'),
  0,
  'Test 47b — tagout_devices cascade-deleted after LOTO DELETE'
);

ROLLBACK TO SAVEPOINT cascade_loto_devices;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup: remove global seed data
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM tagout_devices WHERE lockout_tagout_id LIKE 'CASCADE-LOTO-%';
DELETE FROM lockout_tagout WHERE id LIKE 'CASCADE-LOTO-%';
DELETE FROM permit_tasks WHERE work_permit_id LIKE 'CASCADE-WP-%';
DELETE FROM work_permits WHERE id LIKE 'CASCADE-WP-%'
   OR id LIKE 'RLS-%' OR id LIKE 'PTW-%' OR id LIKE 'LOTO-%';
DELETE FROM work_orders WHERE id = 'PTW-TEST-WO';
DELETE FROM user_profiles WHERE id LIKE '00000000-0000-0000-0000-00000000020%';
DELETE FROM auth.users WHERE id LIKE '00000000-0000-0000-0000-00000000020%';
DELETE FROM assets WHERE id = 'SAFETY-TEST-ASSET';
DELETE FROM asset_types WHERE id = 'SAFETY_TEST';

-- ─────────────────────────────────────────────────────────────────────────────
-- Finalizar (pgTAP)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
