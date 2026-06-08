-- =============================================================================
-- KPI Metrics Views — Test Suite (pgTAP)
-- SDD advanced-reports-slice1, Phase 5: DB Tests
--
-- Assertions: View existence (5), column shape (3), security_invoker (5),
--   mathematical correctness (3), empty-behavior (3) = ~19 assertions
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/kpi_metrics_test.sql
-- =============================================================================

BEGIN;

SELECT plan(19);

-- ===========================================================================
-- 0. Setup: seed data with known values for KPI verification
-- ===========================================================================

-- Asset types
INSERT INTO asset_types (id, name) VALUES (9999, 'KPI Test Asset Type')
ON CONFLICT (id) DO NOTHING;

-- Assets
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES
  ('KPI-ASSET-A', 'EQ-KPI-A', 'KPI Test Asset A', 9999),
  ('KPI-ASSET-B', 'EQ-KPI-B', 'KPI Test Asset B (no data)', 9999)
ON CONFLICT (id) DO NOTHING;

-- Auth users
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-00000000k001', 'kpi-tech@test.com', '$2a$10$placeholder', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- User profiles
INSERT INTO user_profiles (id, role)
VALUES ('00000000-0000-0000-0000-00000000k001', 'TECHNICIAN')
ON CONFLICT (id) DO NOTHING;

-- Work orders with known timestamps for KPI computation
-- Asset A: 3 completed WOs with controlled machine_down/up and actual_start/completed
-- WO-1: machine_down 2026-01-01 08:00, machine_up 2026-01-01 10:00 (2h downtime)
--        actual_start 2026-01-01 08:00, completed 2026-01-01 12:00 (4h repair time)
--        => MTBF contribution: 2h, MTTR contribution: 4h
-- WO-2: machine_down 2026-01-15 14:00, machine_up 2026-01-15 16:30 (2.5h downtime)
--        actual_start 2026-01-15 14:00, completed 2026-01-15 18:00 (4h repair time)
--        => MTBF contribution: 2.5h, MTTR contribution: 4h
-- WO-3: machine_down 2026-02-01 06:00, machine_up 2026-02-01 07:00 (1h downtime)
--        actual_start 2026-02-01 06:00, completed 2026-02-01 09:30 (3.5h repair time)
--        => MTBF contribution: 1h, MTTR contribution: 3.5h
--
-- Expected MTBF = (2 + 2.5 + 1) / 3 = 5.5 / 3 ≈ 1.8333 hours
-- Expected MTTR = (4 + 4 + 3.5) / 3 = 11.5 / 3 ≈ 3.8333 hours
-- Expected Availability = 1.8333 / (1.8333 + 3.8333) * 100 ≈ 32.35%

INSERT INTO work_orders (id, equipment_id, asset_id, wo_type, lifecycle_phase,
  machine_down_at, machine_up_at, actual_start_at, completed_at)
VALUES
  ('KPI-WO-01', 'EQ-KPI-A', 'KPI-ASSET-A', 'CM', 'COMP',
   '2026-01-01 08:00:00+00', '2026-01-01 10:00:00+00',
   '2026-01-01 08:00:00+00', '2026-01-01 12:00:00+00'),
  ('KPI-WO-02', 'EQ-KPI-A', 'KPI-ASSET-A', 'EM', 'CLOSED',
   '2026-01-15 14:00:00+00', '2026-01-15 16:30:00+00',
   '2026-01-15 14:00:00+00', '2026-01-15 18:00:00+00'),
  ('KPI-WO-03', 'EQ-KPI-A', 'KPI-ASSET-A', 'CM', 'COMP',
   '2026-02-01 06:00:00+00', '2026-02-01 07:00:00+00',
   '2026-02-01 06:00:00+00', '2026-02-01 09:30:00+00')
ON CONFLICT (id) DO NOTHING;

-- Labor records for report_labor_hours test
INSERT INTO labor_records (id, work_order_id, technician_id, start_time, end_time, activity_code, hours_worked)
VALUES
  (gen_random_uuid(), 'KPI-WO-01', '00000000-0000-0000-0000-00000000k001',
   '2026-01-01 08:00:00+00', '2026-01-01 10:00:00+00', 'DIRECT_WORK', 2.0),
  (gen_random_uuid(), 'KPI-WO-01', '00000000-0000-0000-0000-00000000k001',
   '2026-01-01 10:00:00+00', '2026-01-01 12:00:00+00', 'DIRECT_WORK', 2.0)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 1. VIEW EXISTENCE (5 assertions)
-- ===========================================================================

SELECT has_view('public', 'kpi_mtbf',              '1a: kpi_mtbf view existe');
SELECT has_view('public', 'kpi_mttr',              '1b: kpi_mttr view existe');
SELECT has_view('public', 'kpi_availability',      '1c: kpi_availability view existe');
SELECT has_view('public', 'report_maintenance_history', '1d: report_maintenance_history view existe');
SELECT has_view('public', 'report_labor_hours',    '1e: report_labor_hours view existe');

-- ===========================================================================
-- 2. COLUMN SHAPE (3 assertions)
-- ===========================================================================

SELECT columns_are('public', 'kpi_mtbf', ARRAY['asset_id', 'mtbf_hours'],
  '2a: kpi_mtbf columnas: asset_id, mtbf_hours');

SELECT columns_are('public', 'kpi_mttr', ARRAY['asset_id', 'mttr_hours'],
  '2b: kpi_mttr columnas: asset_id, mttr_hours');

SELECT columns_are('public', 'kpi_availability', ARRAY['asset_id', 'availability_pct'],
  '2c: kpi_availability columnas: asset_id, availability_pct');

-- ===========================================================================
-- 3. SECURITY INVOKER (5 assertions)
-- ===========================================================================

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'kpi_mtbf'::regclass),
  true,
  '3a: kpi_mtbf tiene RLS habilitado (security_invoker)'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'kpi_mttr'::regclass),
  true,
  '3b: kpi_mttr tiene RLS habilitado (security_invoker)'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'kpi_availability'::regclass),
  true,
  '3c: kpi_availability tiene RLS habilitado (security_invoker)'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'report_maintenance_history'::regclass),
  true,
  '3d: report_maintenance_history tiene RLS habilitado (security_invoker)'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'report_labor_hours'::regclass),
  true,
  '3e: report_labor_hours tiene RLS habilitado (security_invoker)'
);

-- ===========================================================================
-- 4. MATHEMATICAL CORRECTNESS (3 assertions)
--    Usando datos conocidos de las 3 WOs de KPI-ASSET-A
-- ===========================================================================

-- MTBF = (2 + 2.5 + 1) / 3 = 5.5 / 3 ≈ 1.8333
SELECT within(
  (SELECT mtbf_hours FROM kpi_mtbf WHERE asset_id = 'KPI-ASSET-A'),
  1.8333, 0.001,
  '4a: MTBF KPI-ASSET-A ≈ 1.8333 horas (2+2.5+1)/3'
);

-- MTTR = (4 + 4 + 3.5) / 3 = 11.5 / 3 ≈ 3.8333
SELECT within(
  (SELECT mttr_hours FROM kpi_mttr WHERE asset_id = 'KPI-ASSET-A'),
  3.8333, 0.001,
  '4b: MTTR KPI-ASSET-A ≈ 3.8333 horas (4+4+3.5)/3'
);

-- Availability = 1.8333 / (1.8333 + 3.8333) * 100 ≈ 32.35%
SELECT within(
  (SELECT availability_pct FROM kpi_availability WHERE asset_id = 'KPI-ASSET-A'),
  32.35, 0.1,
  '4c: Availability KPI-ASSET-A ≈ 32.35%'
);

-- ===========================================================================
-- 5. EMPTY-BEHAVIOR (3 assertions)
--    KPI-ASSET-B no tiene work_orders → vistas deben retornar 0 filas
-- ===========================================================================

SELECT is(
  (SELECT count(*)::int FROM kpi_mtbf WHERE asset_id = 'KPI-ASSET-B'),
  0,
  '5a: kpi_mtbf sin datos retorna 0 filas'
);

SELECT is(
  (SELECT count(*)::int FROM kpi_mttr WHERE asset_id = 'KPI-ASSET-B'),
  0,
  '5b: kpi_mttr sin datos retorna 0 filas'
);

-- Availability depende de mtbf + mttr, ambos vacíos → sin fila
SELECT is(
  (SELECT count(*)::int FROM kpi_availability WHERE asset_id = 'KPI-ASSET-B'),
  0,
  '5c: kpi_availability sin datos retorna 0 filas'
);

-- ===========================================================================
-- Cleanup
-- ===========================================================================
DELETE FROM labor_records WHERE work_order_id LIKE 'KPI-WO-%';
DELETE FROM work_orders WHERE id LIKE 'KPI-WO-%';
DELETE FROM user_profiles WHERE id = '00000000-0000-0000-0000-00000000k001';
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000k001';
DELETE FROM assets WHERE id IN ('KPI-ASSET-A', 'KPI-ASSET-B');
DELETE FROM asset_types WHERE id = 9999;

-- ===========================================================================
-- Finalizar (pgTAP)
-- ===========================================================================
SELECT * FROM finish();

ROLLBACK;
