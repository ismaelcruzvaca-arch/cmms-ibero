-- =============================================================================
-- Job Plan Structured — Test Suite (pgTAP)
-- Test cases: Schema (14), RLS (4), PM→WO Extension (6) = 24 total
-- =============================================================================

BEGIN;

SELECT plan(24);

-- System user for auto-generated checklist_instances
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@gema.local', '$2a$10$x', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_profiles (id, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000501', 'jp-tech@test.com',    '$2a$10$x', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000502', 'jp-planner@test.com', '$2a$10$x', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000503', 'jp-admin@test.com',   '$2a$10$x', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, role)
VALUES
  ('00000000-0000-0000-0000-000000000501', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000502', 'PLANNER'),
  ('00000000-0000-0000-0000-000000000503', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

INSERT INTO asset_types (id, name) VALUES ('JPTEST', 'Job Plan Test Type')
ON CONFLICT (id) DO NOTHING;

INSERT INTO assets (id, equipment_id, description, asset_type_id, module_id)
VALUES (
  'JP-TST-ASSET', 'JP-TST-EQ', 'Job Plan Test Asset', 'JPTEST',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK')
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_plans (id, code, description, intervention_type, estimated_hours, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000511',
  'JP-TEST-PLAN', 'Test Job Plan', 'INSPECTION', 4, true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO job_plan_tasks (id, job_plan_id, step_sequence, task_description)
VALUES
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000511', 10, 'Inspect bearing'),
  ('00000000-0000-0000-0000-000000000522', '00000000-0000-0000-0000-000000000511', 20, 'Check alignment')
ON CONFLICT (job_plan_id, step_sequence) DO NOTHING;

INSERT INTO job_plan_materials (id, job_plan_id, part_num, planned_qty)
VALUES
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000511', 'BRG-6205', 2),
  ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000511', 'SEAL-001', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO spare_parts (part_num, description, uom, unit_cost)
VALUES ('BRG-6205', 'Bearing 6205', 'EA', 15.50)
ON CONFLICT (part_num) DO NOTHING;

INSERT INTO spare_parts (part_num, description, uom, unit_cost)
VALUES ('SEAL-001', 'Mechanical Seal', 'EA', 45.00)
ON CONFLICT (part_num) DO NOTHING;

INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date)
VALUES (
  '00000000-0000-0000-0000-000000000541',
  'JP-TST-ASSET',
  '00000000-0000-0000-0000-000000000511',
  30, NOW() - INTERVAL '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO checklist_templates (id, code, description, module_id, block_type, sampling_rate)
VALUES (
  '00000000-0000-0000-0000-000000000551',
  'CHK-JP-TEST',
  'JP Test Checklist',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  'A', 1
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1 — SCHEMA TESTS (tests 1-14)
-- ─────────────────────────────────────────────────────────────────────────────

-- Tables exist
SELECT has_table('job_plan_labor',                'Test 1  — job_plan_labor exists');
SELECT has_table('job_plan_safety',               'Test 2  — job_plan_safety exists');
SELECT has_table('work_order_labor_estimates',    'Test 3  — work_order_labor_estimates exists');
SELECT has_table('work_order_safety_requirements','Test 4  — work_order_safety_requirements exists');

-- ENUMs exist
SELECT has_type('trade_enum',       'Test 5  — trade_enum exists');
SELECT has_type('safety_type_enum', 'Test 6  — safety_type_enum exists');

-- PKs
SELECT col_is_pk('job_plan_labor', 'id',                'Test 7  — job_plan_labor PK is id');
SELECT col_is_pk('job_plan_safety', 'id',               'Test 8  — job_plan_safety PK is id');

-- UNIQUE constraints
SELECT col_is_unique('job_plan_labor', ARRAY['job_plan_id', 'trade'],       'Test 9  — job_plan_labor UNIQUE(job_plan_id, trade)');
SELECT col_is_unique('job_plan_safety', ARRAY['job_plan_id', 'safety_type'],'Test 10 — job_plan_safety UNIQUE(job_plan_id, safety_type)');

-- New columns on existing tables
SELECT has_column('job_plans', 'asset_type_id',   'Test 11 — job_plans has asset_type_id');
SELECT has_column('job_plans', 'is_active',        'Test 12 — job_plans has is_active');
SELECT has_column('checklist_templates', 'job_plan_task_id', 'Test 13 — checklist_templates has job_plan_task_id');
SELECT has_column('spare_parts', 'unit_cost',      'Test 14 — spare_parts has unit_cost');

-- ─────────────────────────────────────────────────────────────────────────────
-- T2 — RLS TESTS (tests 15-18)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT policies_are('job_plan_labor',                ARRAY['jpl_select','jpl_insert','jpl_update','jpl_delete'],
  'Test 15 — job_plan_labor has 4 RLS policies');
SELECT policies_are('job_plan_safety',               ARRAY['jps_select','jps_insert','jps_update','jps_delete'],
  'Test 16 — job_plan_safety has 4 RLS policies');
SELECT policies_are('work_order_labor_estimates',    ARRAY['wole_select','wole_insert','wole_update','wole_delete'],
  'Test 17 — work_order_labor_estimates has 4 RLS policies');
SELECT policies_are('work_order_safety_requirements',ARRAY['wosr_select','wosr_insert','wosr_update','wosr_delete'],
  'Test 18 — work_order_safety_requirements has 4 RLS policies');

-- ─────────────────────────────────────────────────────────────────────────────
-- T3 — PM→WO EXTENSION TESTS (tests 19-24)
-- ─────────────────────────────────────────────────────────────────────────────

-- Setup: add labor + safety to the job_plan
INSERT INTO job_plan_labor (id, job_plan_id, trade, estimated_hours, head_count, hourly_rate)
VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000511', 'MECHANIC', 2, 1, 25.00),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000511', 'ELECTRICIAN', 1, 1, 30.00);

INSERT INTO job_plan_safety (id, job_plan_id, safety_type, description, is_mandatory)
VALUES
  ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000511', 'LOTO', 'LOTO on pump isolation', true),
  ('00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000511', 'PTW', 'Hot work permit required', true);

-- Test 19: Function exists
SELECT has_function('generate_due_preventive_work_orders',
  'Test 19 — generate_due_preventive_work_orders() exists');

-- Test 20: PM→WO generates a WO
SAVEPOINT pm_test_1;

SELECT ok(
  generate_due_preventive_work_orders() >= 1,
  'Test 20 — generate_due_preventive_work_orders creates at least 1 WO'
);

ROLLBACK TO SAVEPOINT pm_test_1;

-- Test 21: Labor estimates cloned
SAVEPOINT pm_test_2;

SELECT generate_due_preventive_work_orders();

SELECT is(
  (SELECT COUNT(*)::int FROM work_order_labor_estimates
    WHERE job_plan_id = '00000000-0000-0000-0000-000000000511'),
  2,
  'Test 21 — 2 labor rows cloned to work_order_labor_estimates'
);

ROLLBACK TO SAVEPOINT pm_test_2;

-- Test 22: Safety requirements cloned
SAVEPOINT pm_test_3;

SELECT generate_due_preventive_work_orders();

SELECT is(
  (SELECT COUNT(*)::int FROM work_order_safety_requirements
    WHERE job_plan_id = '00000000-0000-0000-0000-000000000511'),
  2,
  'Test 22 — 2 safety rows cloned to work_order_safety_requirements'
);

ROLLBACK TO SAVEPOINT pm_test_3;

-- Test 23: Checklist instances created
SAVEPOINT pm_test_4;

SELECT generate_due_preventive_work_orders();

SELECT ok(
  EXISTS(SELECT 1 FROM checklist_instances
    WHERE status = 'PENDING'
      AND notes LIKE '%JP-TEST-PLAN%'),
  'Test 23 — checklist_instances created with PENDING status'
);

ROLLBACK TO SAVEPOINT pm_test_4;

-- Test 24: Cost calculation
SAVEPOINT pm_test_5;

SELECT generate_due_preventive_work_orders();

SELECT is(
  (SELECT estimated_parts_cost::numeric FROM work_orders
    WHERE job_plan_id = '00000000-0000-0000-0000-000000000511'
    ORDER BY created_at DESC LIMIT 1),
  76.00,
  'Test 24 — estimated_parts_cost = 76 (2×15.50 + 1×45)'
);

ROLLBACK TO SAVEPOINT pm_test_5;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fin
-- ─────────────────────────────────────────────────────────────────────────────

SELECT * FROM finish();

ROLLBACK;
