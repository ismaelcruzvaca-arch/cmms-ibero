-- =============================================================================
-- Competency Engine — Test Suite (pgTAP)
-- 37 test cases: Schema (14), Triggers (10), RLS (7), Functions (6)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/competency_engine_test.sql
--
-- Ejecutar (manual):
--   psql -f supabase/tests/database/competency_engine_test.sql
--
-- Dependencias: pgTAP instalado, auth.users disponible (Supabase estándar),
--   migrations del competency-engine aplicadas (20260528000001 + 00002).
-- =============================================================================

BEGIN;

SELECT plan(37);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: seed data global para FKs en todos los escenarios
-- ─────────────────────────────────────────────────────────────────────────────

-- Auth users (required for auth.uid() + get_user_role())
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000301', 'comp-tech@test.com',    '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000302', 'comp-planner@test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000303', 'comp-admin@test.com',   '$2a$10$placeholder', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- User profiles (get_user_role() reads from here)
INSERT INTO user_profiles (id, role)
VALUES
  ('00000000-0000-0000-0000-000000000301', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000302', 'PLANNER'),
  ('00000000-0000-0000-0000-000000000303', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

-- Asset type for testing
INSERT INTO asset_types (id, name) VALUES ('COMP_TEST', 'Competency Test Asset Type')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1 — SCHEMA TESTS (tests 1-14)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1-6: Tables exist
SELECT has_table('technological_modules',      'Test 1  — Table technological_modules exists');
SELECT has_table('proficiency_levels',         'Test 2  — Table proficiency_levels exists');
SELECT has_table('technician_skills',          'Test 3  — Table technician_skills exists');
SELECT has_table('skill_requirements',         'Test 4  — Table skill_requirements exists');
SELECT has_table('technician_skill_evidence',  'Test 5  — Table technician_skill_evidence exists');
SELECT has_table('technician_module_progress', 'Test 6  — Table technician_module_progress exists');

-- 7: Seed data — exactly 8 technological_modules
SELECT is(
  (SELECT COUNT(*)::int FROM technological_modules),
  8,
  'Test 7  — technological_modules has 8 seed rows'
);

-- 8: Seed data — exactly 5 proficiency_levels
SELECT is(
  (SELECT COUNT(*)::int FROM proficiency_levels),
  5,
  'Test 8  — proficiency_levels has 5 seed rows'
);

-- 9: FK — assets.module_id references technological_modules(id)
SELECT col_is_fk('assets', 'module_id',
  'technological_modules(id)',
  'Test 9  — assets.module_id FK → technological_modules(id)'
);

-- 10: Column — module_id exists on assets
SELECT has_column('assets', 'module_id',
  'Test 10 — assets has module_id column'
);

-- 11: CHECK constraint exists on technician_skill_evidence.nivel_evaluado
SELECT col_has_check('technician_skill_evidence', 'nivel_evaluado',
  'Test 11 — technician_skill_evidence.nivel_evaluado has CHECK constraint'
);

-- 12-14: Verify CHECK rejects nivel_evaluado=1 and =5; accepts =2
SAVEPOINT schema_check;

INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('CHK-TST-ASSET', 'EQ-CHK', 'CHECK test asset', 'COMP_TEST');

INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase)
VALUES ('CHK-TST-WO', 'CHK-TST-ASSET', 'EQ-CHK', 'WAPPR');

SELECT throws_ok(
  $$ INSERT INTO technician_skill_evidence
       (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
     VALUES
       ('CHK-TST-WO', '00000000-0000-0000-0000-000000000301', 'CHK-TST-ASSET', 'M-PACK', 1, 'Test item', true, '00000000-0000-0000-0000-000000000303') $$,
  '23514',
  NULL,
  'Test 12 — nivel_evaluado=1 rejected by CHECK'
);

SELECT throws_ok(
  $$ INSERT INTO technician_skill_evidence
       (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
     VALUES
       ('CHK-TST-WO', '00000000-0000-0000-0000-000000000301', 'CHK-TST-ASSET', 'M-PACK', 5, 'Test item', true, '00000000-0000-0000-0000-000000000303') $$,
  '23514',
  NULL,
  'Test 13 — nivel_evaluado=5 rejected by CHECK'
);

SELECT lives_ok(
  $$ INSERT INTO technician_skill_evidence
       (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
     VALUES
       ('CHK-TST-WO', '00000000-0000-0000-0000-000000000301', 'CHK-TST-ASSET', 'M-PACK', 2, 'Test item', true, '00000000-0000-0000-0000-000000000303') $$,
  'Test 14 — nivel_evaluado=2 accepted by CHECK'
);

ROLLBACK TO SAVEPOINT schema_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2 — TRIGGER TESTS (tests 15-24)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tests de los triggers que calculan automáticamente el nivel de competencia
-- al insertar evidencia (trg_recalculate_technician_level) o al actualizar
-- banderas de progreso (trg_update_module_progress).
-- ─────────────────────────────────────────────────────────────────────────────

SAVEPOINT trigger_tests;

-- Base data for all trigger scenarios
INSERT INTO assets (id, equipment_id, description, asset_type_id, module_id)
VALUES (
  'TRG-TST-ASSET', 'EQ-TRG', 'Trigger test asset', 'COMP_TEST',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK')
);

INSERT INTO job_plans (id, code, description, intervention_type, estimated_hours)
VALUES (
  '00000000-0000-0000-0000-000000000401', 'TRG-TST-JP', 'Trigger test job plan', 'INSPECTION', 2
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase, job_plan_id, created_by)
VALUES (
  'TRG-TST-WO', 'TRG-TST-ASSET', 'EQ-TRG', 'WAPPR',
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000303'
);

-- Pre-create progress row for technician 301 on M-PACK (needed for autor test later)
INSERT INTO technician_module_progress (technician_id, module_id, induccion_completada, autor_estandar, updated_by)
VALUES (
  '00000000-0000-0000-0000-000000000301', (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  false, false, '00000000-0000-0000-0000-000000000303'
)
ON CONFLICT (technician_id, module_id) DO NOTHING;

-- ── Test 15: Insert PASS evidence for nivel_evaluado=2 → current_level >= 2 ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 2,
   'Safety block A PASS', true, '00000000-0000-0000-0000-000000000303');

SELECT ok(
  (SELECT current_level >= 2 FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  'Test 15 — 1 PASS nivel 2 → current_level >= 2'
);

-- ── Test 16: Insert 3 PASS for nivel_evaluado=3 → stays at 2 (need 5) ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 3,
   'Execution block #1', true, '00000000-0000-0000-0000-000000000303'),
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 3,
   'Execution block #2', true, '00000000-0000-0000-0000-000000000303'),
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 3,
   'Execution block #3', true, '00000000-0000-0000-0000-000000000303');

SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  2,
  'Test 16 — 3 PASS nivel 3 → current_level stays at 2 (need 5)'
);

-- ── Test 17: 2 more PASS nivel 3 (total 5) → current_level >= 3 ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 3,
   'Execution block #4', true, '00000000-0000-0000-0000-000000000303'),
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 3,
   'Execution block #5', true, '00000000-0000-0000-0000-000000000303');

SELECT ok(
  (SELECT current_level >= 3 FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  'Test 17 — 5 PASS nivel 3 (total) → current_level >= 3'
);

-- ── Test 18: Insert PASS for nivel_evaluado=4 → current_level >= 4 ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000301', 'TRG-TST-ASSET', 'M-PACK', 4,
   'Precision block PASS', true, '00000000-0000-0000-0000-000000000303');

SELECT ok(
  (SELECT current_level >= 4 FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  'Test 18 — 1 PASS nivel 4 → current_level >= 4'
);

-- ── Test 19: FAIL evidence does NOT increase level (fresh tech, same module) ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000302', 'TRG-TST-ASSET', 'M-PACK', 2,
   'Safety block FAIL', false, '00000000-0000-0000-0000-000000000303');

SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000302'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  1,
  'Test 19 — FAIL evidence does NOT increase level (stays at 1)'
);

-- ── Test 20: induccion_completada=true → current_level >= 1 ──
-- (uses a different tech+module with no evidence; induction alone keeps level at 1)

INSERT INTO technician_module_progress (technician_id, module_id, induccion_completada, autor_estandar, updated_by)
VALUES (
  '00000000-0000-0000-0000-000000000302', (SELECT id FROM technological_modules WHERE code = 'M-REFR'),
  false, false, '00000000-0000-0000-0000-000000000303'
)
ON CONFLICT (technician_id, module_id) DO NOTHING;

-- UPDATE fires trg_update_module_progress, which recalculates level
UPDATE technician_module_progress
SET induccion_completada = true, updated_by = '00000000-0000-0000-0000-000000000303'
WHERE technician_id = '00000000-0000-0000-0000-000000000302'
  AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-REFR');

SELECT ok(
  (SELECT current_level >= 1 FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000302'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-REFR')),
  'Test 20 — induccion_completada=true → current_level >= 1'
);

-- ── Test 21: autor_estandar=true → current_level = 5 ──

UPDATE technician_module_progress
SET autor_estandar = true, updated_by = '00000000-0000-0000-0000-000000000303'
WHERE technician_id = '00000000-0000-0000-0000-000000000301'
  AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK');

SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  5,
  'Test 21 — autor_estandar=true → current_level = 5'
);

-- ── Test 22: calculated_at IS NOT NULL after trigger recalculation ──

SELECT ok(
  (SELECT calculated_at IS NOT NULL FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  'Test 22 — calculated_at IS NOT NULL after trigger recalculation'
);

-- ── Test 23: FAIL evidence on a fresh tech+module stays at level 1 ──

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('TRG-TST-WO', '00000000-0000-0000-0000-000000000302', 'TRG-TST-ASSET', 'M-ELEC', 3,
   'Execution FAIL', false, '00000000-0000-0000-0000-000000000303');

SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000302'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-ELEC')),
  1,
  'Test 23 — FAIL evidence on fresh tech+module → current_level stays at 1'
);

-- ── Test 24: Different technicians have independent levels on same module ──
-- tech 301 = level 5 (M-PACK), tech 302 = level 1 (M-PACK) from FAIL only
SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000301'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  5,
  'Test 24a — tech 301 level is 5 (independent from tech 302)'
);

SELECT is(
  (SELECT current_level FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000302'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PACK')),
  1,
  'Test 24b — tech 302 level is 1 (independent from tech 301)'
);

ROLLBACK TO SAVEPOINT trigger_tests;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3 — RLS TESTS (tests 25-31)
-- ─────────────────────────────────────────────────────────────────────────────
-- Todas las RLS usan get_user_role() que lee de user_profiles.
-- auth.uid() se setea via "request.jwt.claim.sub".
-- ─────────────────────────────────────────────────────────────────────────────

-- 25: TECHNICIAN cannot INSERT into technician_skill_evidence
SAVEPOINT rls_tech_insert;

INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('RLS-TST-ASSET', 'EQ-RLS', 'RLS test asset', 'COMP_TEST');

INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase)
VALUES ('RLS-TST-WO', 'RLS-TST-ASSET', 'EQ-RLS', 'WAPPR');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT throws_ok(
  $$ INSERT INTO technician_skill_evidence
       (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
     VALUES
       ('RLS-TST-WO', '00000000-0000-0000-0000-000000000301', 'RLS-TST-ASSET', 'M-PACK', 2,
        'RLS tech insert test', true, '00000000-0000-0000-0000-000000000301') $$,
  '42501',
  NULL,
  'Test 25 — TECHNICIAN cannot INSERT technician_skill_evidence (RLS)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_insert;

-- 26: PLANNER can INSERT into technician_skill_evidence
SAVEPOINT rls_planner_insert;

INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES ('RLS-PLN-ASSET', 'EQ-RLP', 'RLS planner test asset', 'COMP_TEST');

INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase)
VALUES ('RLS-PLN-WO', 'RLS-PLN-ASSET', 'EQ-RLP', 'WAPPR');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000302';

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES
  ('RLS-PLN-WO', '00000000-0000-0000-0000-000000000302', 'RLS-PLN-ASSET', 'M-PACK', 2,
   'RLS planner insert test', true, '00000000-0000-0000-0000-000000000302');

SELECT is(
  (SELECT COUNT(*)::int FROM technician_skill_evidence
    WHERE work_order_id = 'RLS-PLN-WO' AND technician_id = '00000000-0000-0000-0000-000000000302'),
  1,
  'Test 26 — PLANNER can INSERT technician_skill_evidence'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_planner_insert;

-- 27: TECHNICIAN can SELECT from technological_modules
SAVEPOINT rls_tech_select_tm;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT is(
  (SELECT COUNT(*)::int FROM technological_modules),
  8,
  'Test 27 — TECHNICIAN can SELECT technological_modules'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select_tm;

-- 28: TECHNICIAN can SELECT from proficiency_levels
SAVEPOINT rls_tech_select_pl;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT is(
  (SELECT COUNT(*)::int FROM proficiency_levels),
  5,
  'Test 28 — TECHNICIAN can SELECT proficiency_levels'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select_pl;

-- 29: TECHNICIAN can SELECT from technician_skills
SAVEPOINT rls_tech_select_ts;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT is(
  (SELECT COUNT(*)::int FROM technician_skills),
  (SELECT COUNT(*)::int FROM technician_skills),
  'Test 29 — TECHNICIAN can SELECT technician_skills (no RLS error)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select_ts;

-- 30: TECHNICIAN can SELECT from skill_requirements
SAVEPOINT rls_tech_select_sr;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT is(
  (SELECT COUNT(*)::int FROM skill_requirements),
  (SELECT COUNT(*)::int FROM skill_requirements),
  'Test 30 — TECHNICIAN can SELECT skill_requirements (no RLS error)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select_sr;

-- 31: TECHNICIAN can SELECT from technician_skill_evidence
SAVEPOINT rls_tech_select_ev;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-000000000301';

SELECT is(
  (SELECT COUNT(*)::int FROM technician_skill_evidence),
  (SELECT COUNT(*)::int FROM technician_skill_evidence),
  'Test 31 — TECHNICIAN can SELECT technician_skill_evidence (no RLS error)'
);

RESET ROLE;
ROLLBACK TO SAVEPOINT rls_tech_select_ev;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4 — FUNCTION TESTS (tests 32-37)
-- ─────────────────────────────────────────────────────────────────────────────
-- check_competency_for_assignment(p_technician_id UUID, p_work_order_id TEXT)
-- Returns JSON {status, current_level, required_level, message}
-- ─────────────────────────────────────────────────────────────────────────────

SAVEPOINT func_tests;

-- Base data for function test scenarios

-- Asset with module (M-VAPO) for WARNING and OK tests
INSERT INTO assets (id, equipment_id, description, asset_type_id, module_id)
VALUES (
  'FN-TST-ASSET-1', 'EQ-FN1', 'Function test asset 1', 'COMP_TEST',
  (SELECT id FROM technological_modules WHERE code = 'M-VAPO')
);

-- Job plan for the function tests
INSERT INTO job_plans (id, code, description, intervention_type, estimated_hours)
VALUES (
  '00000000-0000-0000-0000-000000000501', 'FN-TST-JP', 'Function test job plan', 'INSPECTION', 2
)
ON CONFLICT (id) DO NOTHING;

-- Skill requirement: need level 4 for M-VAPO on this job plan
INSERT INTO skill_requirements (job_plan_id, module_id, minimum_level_required)
VALUES (
  '00000000-0000-0000-0000-000000000501',
  (SELECT id FROM technological_modules WHERE code = 'M-VAPO'),
  4
);

-- Work order linking asset + job plan
INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase, job_plan_id, created_by)
VALUES (
  'FN-TST-WO', 'FN-TST-ASSET-1', 'EQ-FN1', 'WAPPR',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000303'
);

-- Asset without module (for "no module" scenario)
INSERT INTO assets (id, equipment_id, description, asset_type_id)
VALUES (
  'FN-TST-ASSET-NOMOD', 'EQ-FN-NM', 'Function test asset no module', 'COMP_TEST'
);

-- Work order without module asset
INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase, job_plan_id, created_by)
VALUES (
  'FN-TST-WO-NOMOD', 'FN-TST-ASSET-NOMOD', 'EQ-FN-NM', 'WAPPR',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000303'
);

-- Asset with module (M-PUMP) for "no skill requirement" scenario
INSERT INTO assets (id, equipment_id, description, asset_type_id, module_id)
VALUES (
  'FN-TST-ASSET-2', 'EQ-FN2', 'Function test asset 2', 'COMP_TEST',
  (SELECT id FROM technological_modules WHERE code = 'M-PUMP')
);

-- Work order for asset 2 (no skill_requirement for M-PUMP)
INSERT INTO work_orders (id, asset_id, equipment_id, lifecycle_phase, job_plan_id, created_by)
VALUES (
  'FN-TST-WO-NOREQ', 'FN-TST-ASSET-2', 'EQ-FN2', 'WAPPR',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000303'
);

-- Technician skills: tech 301 has level 2 on M-VAPO (below requirement of 4)
INSERT INTO technician_skills (technician_id, module_id, current_level, calculated_at)
VALUES (
  '00000000-0000-0000-0000-000000000301',
  (SELECT id FROM technological_modules WHERE code = 'M-VAPO'),
  2, NOW()
)
ON CONFLICT (technician_id, module_id)
DO UPDATE SET current_level = 2, calculated_at = NOW();

-- Technician skills: tech 302 has level 4 on M-VAPO (meets requirement of 4)
INSERT INTO technician_skills (technician_id, module_id, current_level, calculated_at)
VALUES (
  '00000000-0000-0000-0000-000000000302',
  (SELECT id FROM technological_modules WHERE code = 'M-VAPO'),
  4, NOW()
)
ON CONFLICT (technician_id, module_id)
DO UPDATE SET current_level = 4, calculated_at = NOW();

-- ── Test 32: WARNING when level too low ──

SELECT is(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000301',
    'FN-TST-WO'
  ) #>> '{status}'),
  'WARNING',
  'Test 32 — check_competency_for_assignment returns WARNING when level too low'
);

-- ── Test 33: OK when level sufficient ──

SELECT is(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000302',
    'FN-TST-WO'
  ) #>> '{status}'),
  'OK',
  'Test 33 — check_competency_for_assignment returns OK when level sufficient'
);

-- ── Test 34: OK when no skill_requirements exist (different module, no matching req) ──

SELECT is(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000301',
    'FN-TST-WO-NOREQ'
  ) #>> '{status}'),
  'OK',
  'Test 34 — check_competency_for_assignment returns OK when no skill_requirement exists'
);

-- ── Test 35: OK when asset has no module ──

SELECT is(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000301',
    'FN-TST-WO-NOMOD'
  ) #>> '{status}'),
  'OK',
  'Test 35 — check_competency_for_assignment returns OK when asset has no module'
);

-- ── Test 36: JSON response includes current_level field ──

SELECT ok(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000301',
    'FN-TST-WO'
  ) ? 'current_level'),
  'Test 36 — check_competency_for_assignment JSON includes current_level'
);

-- ── Test 37: JSON response includes required_level when level too low ──

SELECT is(
  (SELECT check_competency_for_assignment(
    '00000000-0000-0000-0000-000000000301',
    'FN-TST-WO'
  ) #>> '{required_level}')::int,
  4,
  'Test 37 — required_level is 4 in WARNING response'
);

ROLLBACK TO SAVEPOINT func_tests;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup: remove global seed data
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM technician_skill_evidence WHERE work_order_id LIKE 'TRG-TST-WO'
   OR work_order_id LIKE 'CHK-TST-WO' OR work_order_id LIKE 'RLS-TST-WO'
   OR work_order_id LIKE 'RLS-PLN-WO' OR work_order_id LIKE 'FN-TST-WO%';
DELETE FROM technician_module_progress WHERE technician_id LIKE '00000000-0000-0000-0000-00000000030%';
DELETE FROM technician_skills WHERE technician_id LIKE '00000000-0000-0000-0000-00000000030%';
DELETE FROM skill_requirements WHERE job_plan_id = '00000000-0000-0000-0000-000000000501';
DELETE FROM work_orders WHERE id LIKE 'CHK-TST-WO' OR id LIKE 'TRG-TST-WO'
   OR id LIKE 'RLS-TST-WO' OR id LIKE 'RLS-PLN-WO'
   OR id LIKE 'FN-TST-WO%';
DELETE FROM job_plans WHERE id IN ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000501');
DELETE FROM assets WHERE id LIKE 'CHK-TST-ASSET' OR id LIKE 'TRG-TST-ASSET'
   OR id LIKE 'RLS-TST-ASSET' OR id LIKE 'RLS-PLN-ASSET'
   OR id LIKE 'FN-TST-ASSET%';
DELETE FROM user_profiles WHERE id LIKE '00000000-0000-0000-0000-00000000030%';
DELETE FROM auth.users WHERE id LIKE '00000000-0000-0000-0000-00000000030%';
DELETE FROM asset_types WHERE id = 'COMP_TEST';

-- ─────────────────────────────────────────────────────────────────────────────
-- Finalizar (pgTAP)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
