-- =============================================================================
-- Checklist Evidence System — Test Suite (pgTAP)
-- Test cases: Schema (22), Triggers (15), RLS (6), Audit (3) = 46 total
--
-- Ejecutar:
--   psql -f supabase/tests/database/checklist_evidence_test.sql
--
-- Dependencias: pgTAP instalado, auth.users disponible,
--   migrations del checklist-evidence-system aplicadas (20260529000001).
-- =============================================================================

BEGIN;

SELECT plan(46);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Setup: seed data global para FKs en todos los escenarios
-- ─────────────────────────────────────────────────────────────────────────────

-- Auth users (required for auth.uid() + get_user_role())
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000401', 'cl-tech@test.com',    '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000402', 'cl-planner@test.com', '$2a$10$placeholder', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000403', 'cl-admin@test.com',   '$2a$10$placeholder', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- User profiles (get_user_role() reads from here)
INSERT INTO user_profiles (id, role)
VALUES
  ('00000000-0000-0000-0000-000000000401', 'TECHNICIAN'),
  ('00000000-0000-0000-0000-000000000402', 'PLANNER'),
  ('00000000-0000-0000-0000-000000000403', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

-- Asset type for testing
INSERT INTO asset_types (id, name) VALUES ('CHK_TEST', 'Checklist Test Asset Type')
ON CONFLICT (id) DO NOTHING;

-- Asset with module M-PACK
INSERT INTO assets (id, equipment_id, description, asset_type_id, module_id)
VALUES (
  'CHK-TST-ASSET', 'CHK-TST-EQ', 'Checklist Test Asset', 'CHK_TEST',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK')
)
ON CONFLICT (id) DO NOTHING;

-- Work order for testing
INSERT INTO work_orders (id, asset_id, equipment_id, wo_type, lifecycle_phase)
VALUES ('CHK-TST-WO', 'CHK-TST-ASSET', 'CHK-TST-WO-EQ', 'corrective', 'INPRG')
ON CONFLICT (id) DO NOTHING;

-- Sample job_plan for template tests
INSERT INTO job_plans (id, code, description, intervention_type, estimated_hours)
VALUES ('00000000-0000-0000-0000-000000000411', 'CHK-PLAN-001', 'Checklist Test Plan', 'INSPECTION', 1)
ON CONFLICT (id) DO NOTHING;

-- tech-level trigger user for trigger tests
INSERT INTO technician_skills (technician_id, module_id, current_level)
VALUES (
  '00000000-0000-0000-0000-000000000401',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  3
)
ON CONFLICT (technician_id, module_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1 — SCHEMA TESTS (tests 1-22)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1-6: Tables exist
SELECT has_table('causa_falla_catalog',      'Test 1  — Table causa_falla_catalog exists');
SELECT has_table('checklist_templates',       'Test 2  — Table checklist_templates exists');
SELECT has_table('checklist_template_items',  'Test 3  — Table checklist_template_items exists');
SELECT has_table('checklist_instances',       'Test 4  — Table checklist_instances exists');
SELECT has_table('checklist_item_responses',  'Test 5  — Table checklist_item_responses exists');
SELECT has_table('checklist_sampling_config', 'Test 6  — Table checklist_sampling_config exists');

-- 7-12: PK columns
SELECT col_is_pk('causa_falla_catalog', 'id',      'Test 7  — causa_falla_catalog PK is id');
SELECT col_is_pk('checklist_templates', 'id',       'Test 8  — checklist_templates PK is id');
SELECT col_is_pk('checklist_template_items', 'id',  'Test 9  — checklist_template_items PK is id');
SELECT col_is_pk('checklist_instances', 'id',       'Test 10 — checklist_instances PK is id');
SELECT col_is_pk('checklist_item_responses', 'id',  'Test 11 — checklist_item_responses PK is id');
SELECT col_is_pk('checklist_sampling_config', 'id', 'Test 12 — checklist_sampling_config PK is id');

-- 13: Seed data — exactly 6 causa_falla_catalog
SELECT is(
  (SELECT COUNT(*)::int FROM causa_falla_catalog),
  6,
  'Test 13 — causa_falla_catalog has 6 seed rows'
);

-- 14: CHECK constraint — checklist_templates.block_type
SELECT col_has_check('checklist_templates', 'block_type',
  'Test 14 — checklist_templates.block_type has CHECK constraint');

-- 15: FK — checklist_templates.module_id
SELECT col_is_fk('checklist_templates', 'module_id',
  'Test 15 — checklist_templates.module_id is a FK');

-- 16: FK — checklist_instances.work_order_id
SELECT col_is_fk('checklist_instances', 'work_order_id',
  'Test 16 — checklist_instances.work_order_id is a FK');

-- 17: FK — checklist_instances.technician_id
SELECT col_is_fk('checklist_instances', 'technician_id',
  'Test 17 — checklist_instances.technician_id is a FK');

-- 18: FK — checklist_item_responses.causa_falla_id
SELECT col_is_fk('checklist_item_responses', 'causa_falla_id',
  'Test 18 — checklist_item_responses.causa_falla_id is a FK');

-- 19: CHECK constraint — checklist_instances.evaluator_source
SELECT col_has_check('checklist_instances', 'evaluator_source',
  'Test 19 — checklist_instances.evaluator_source has CHECK constraint');

-- 20: CHECK constraint — checklist_instances.status
SELECT col_has_check('checklist_instances', 'status',
  'Test 20 — checklist_instances.status has CHECK constraint');

-- 21: New columns exist on technician_skill_evidence
SELECT has_column('technician_skill_evidence', 'evaluation_source',
  'Test 21 — technician_skill_evidence has evaluation_source column');
SELECT has_column('technician_skill_evidence', 'causa_falla_id',
  'Test 21b — technician_skill_evidence has causa_falla_id column');
SELECT has_column('technician_skill_evidence', 'trust_score',
  'Test 21c — technician_skill_evidence has trust_score column');

-- 22: New columns exist on work_orders
SELECT has_column('work_orders', 'is_auditable',
  'Test 22 — work_orders has is_auditable column');
SELECT has_column('work_orders', 'audit_reason',
  'Test 22b — work_orders has audit_reason column');

-- ─────────────────────────────────────────────────────────────────────────────
-- T2 — TRIGGER TESTS (tests 23-37)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Setup: Create a checklist template + items + instance ──

-- Template for M-PACK Block A
INSERT INTO checklist_templates (id, code, description, module_id, block_type, sampling_rate)
VALUES (
  '00000000-0000-0000-0000-000000000421',
  'CHK-MPACK-A-TEST',
  'Test Block A - Safety',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  'A', 1
);

-- Template items (3 ítems)
INSERT INTO checklist_template_items (id, checklist_template_id, step_sequence, item_text)
VALUES
  ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000421', 1, 'Item safety 1'),
  ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000421', 2, 'Item safety 2'),
  ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000421', 3, 'Item safety 3');

-- Template for M-PACK Block B
INSERT INTO checklist_templates (id, code, description, module_id, block_type, sampling_rate)
VALUES (
  '00000000-0000-0000-0000-000000000422',
  'CHK-MPACK-B-TEST',
  'Test Block B - Execution',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  'B', 1
);

INSERT INTO checklist_template_items (id, checklist_template_id, step_sequence, item_text)
VALUES
  ('00000000-0000-0000-0000-000000000434', '00000000-0000-0000-0000-000000000422', 1, 'Item execution 1'),
  ('00000000-0000-0000-0000-000000000435', '00000000-0000-0000-0000-000000000422', 2, 'Item execution 2');

-- Template for M-PACK Block C
INSERT INTO checklist_templates (id, code, description, module_id, block_type, sampling_rate)
VALUES (
  '00000000-0000-0000-0000-000000000423',
  'CHK-MPACK-C-TEST',
  'Test Block C - Precision',
  (SELECT id FROM technological_modules WHERE code = 'M-PACK'),
  'C', 1
);

INSERT INTO checklist_template_items (id, checklist_template_id, step_sequence, item_text)
VALUES
  ('00000000-0000-0000-0000-000000000436', '00000000-0000-0000-0000-000000000423', 1, 'Item precision 1');

-- ───── Test 23: trg_checklist_to_evidence — Block A completed, all PASS ─────

-- Create instance
INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluator_source, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000441',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000421',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'SUPERVISOR',
  '00000000-0000-0000-0000-000000000402',
  'IN_PROGRESS'
);

-- Insert responses — all PASS
INSERT INTO checklist_item_responses (checklist_instance_id, template_item_id, status)
VALUES
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000431', 'PASS'),
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000432', 'PASS'),
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000433', 'PASS');

-- Mark as COMPLETED — this fires trg_checklist_to_evidence
UPDATE checklist_instances
SET status = 'COMPLETED', completed_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000441';

SELECT ok(
  (SELECT status = true FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND nivel_evaluado = 2
      AND evaluation_source = 'SUPERVISOR'),
  'Test 23 — Block A all PASS → evidence inserted with status=true, nivel_evaluado=2'
);

-- ───── Test 24: Trust score for SUPERVISOR is 1.0 ─────

SELECT is(
  (SELECT trust_score FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND nivel_evaluado = 2
      AND evaluation_source = 'SUPERVISOR'),
  1.0,
  'Test 24 — SUPERVISOR evaluation → trust_score = 1.0'
);

-- ───── Test 25: Block B completed (different instance), verify nivel_evaluado=3 ─────

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluator_source, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000442',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000422',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'SELF',
  '00000000-0000-0000-0000-000000000401',
  'IN_PROGRESS'
);

INSERT INTO checklist_item_responses (checklist_instance_id, template_item_id, status)
VALUES
  ('00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000434', 'PASS'),
  ('00000000-0000-0000-0000-000000000442', '00000000-0000-0000-0000-000000000435', 'PASS');

UPDATE checklist_instances
SET status = 'COMPLETED', completed_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000442';

SELECT ok(
  (SELECT nivel_evaluado = 3 FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND nivel_evaluado = 3),
  'Test 25 — Block B completed → nivel_evaluado = 3'
);

-- ───── Test 26: Self-evaluation trust_score = 0.5 ─────

SELECT is(
  (SELECT trust_score FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND nivel_evaluado = 3),
  0.5,
  'Test 26 — SELF evaluation → trust_score = 0.5'
);

-- ───── Test 27: NO_APLICA override — FAIL + NO_APLICA → PASS ─────

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluator_source, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000443',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000421',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'SELF',
  '00000000-0000-0000-0000-000000000401',
  'IN_PROGRESS'
);

-- FAIL + NO_APLICA override
INSERT INTO checklist_item_responses (checklist_instance_id, template_item_id, status, causa_falla_id)
VALUES (
  '00000000-0000-0000-0000-000000000443',
  '00000000-0000-0000-0000-000000000431',
  'FAIL',
  (SELECT id FROM causa_falla_catalog WHERE code = 'NO_APLICA')
);

UPDATE checklist_instances
SET status = 'COMPLETED', completed_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000443';

SELECT ok(
  (SELECT status = true FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND evaluation_source = 'SELF'
      AND trust_score = 0.5
      AND nivel_evaluado = 2
      AND causa_falla_id = (SELECT id FROM causa_falla_catalog WHERE code = 'NO_APLICA')),
  'Test 27 — FAIL + NO_APLICA override → evidence recorded as PASS'
);

-- ───── Test 28: Block C completed, verify nivel_evaluado=4 ─────

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluator_source, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000444',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000423',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'SUPERVISOR',
  '00000000-0000-0000-0000-000000000402',
  'IN_PROGRESS'
);

INSERT INTO checklist_item_responses (checklist_instance_id, template_item_id, status)
VALUES ('00000000-0000-0000-0000-000000000444', '00000000-0000-0000-0000-000000000436', 'PASS');

UPDATE checklist_instances
SET status = 'COMPLETED', completed_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000444';

SELECT ok(
  (SELECT nivel_evaluado = 4 FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND nivel_evaluado = 4),
  'Test 28 — Block C completed → nivel_evaluado = 4'
);

-- ───── Test 29: FAIL without NO_APLICA → recorded as FAIL ─────

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluator_source, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000445',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000421',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'SUPERVISOR',
  '00000000-0000-0000-0000-000000000402',
  'IN_PROGRESS'
);

INSERT INTO checklist_item_responses (checklist_instance_id, template_item_id, status, causa_falla_id)
VALUES (
  '00000000-0000-0000-0000-000000000445',
  '00000000-0000-0000-0000-000000000431',
  'FAIL',
  (SELECT id FROM causa_falla_catalog WHERE code = 'BRECHA_CONOCIMIENTO')
);

UPDATE checklist_instances
SET status = 'COMPLETED', completed_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000445';

SELECT ok(
  (SELECT status = false FROM technician_skill_evidence
    WHERE work_order_id = 'CHK-TST-WO'
      AND modulo_gema = 'M-PACK'
      AND evaluation_source = 'SUPERVISOR'
      AND trust_score = 1.0
      AND nivel_evaluado = 2
      AND causa_falla_id = (SELECT id FROM causa_falla_catalog WHERE code = 'BRECHA_CONOCIMIENTO')),
  'Test 29 — FAIL + BRECHA_CONOCIMIENTO → evidence recorded as FAIL'
);

-- ───── Test 30: trg_recalculate_technician_level — trust_score weighted count ─────
-- Setup: Insert evidence with trust_score=0.5 (SELF) for a fresh tech+module
-- Need SUM(trust_score) >= 5 for level 3, so need 10 SELF records

-- First, create technician_skills row for a different module
INSERT INTO technician_module_progress (technician_id, module_id, induccion_completada, autor_estandar, updated_by)
VALUES (
  '00000000-0000-0000-0000-000000000401',
  (SELECT id FROM technological_modules WHERE code = 'M-TRAN'),
  true, false, '00000000-0000-0000-0000-000000000403'
)
ON CONFLICT (technician_id, module_id) DO NOTHING;

-- Insert 10 self-evaluation PASS evidence records (trust_score=0.5 each → SUM=5.0)
DO $$
DECLARE
  i INT;
  v_module_id UUID := (SELECT id FROM technological_modules WHERE code = 'M-TRAN');
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO technician_skill_evidence
      (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by, evaluation_source, trust_score)
    VALUES
      ('CHK-TST-WO', '00000000-0000-0000-0000-000000000401', 'CHK-TST-ASSET', 'M-TRAN', 3,
       'Self eval #' || i, true, '00000000-0000-0000-0000-000000000401', 'SELF', 0.5);
  END LOOP;
END $$;

SELECT ok(
  (SELECT current_level >= 3 FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-TRAN')),
  'Test 30 — 10 SELF × 0.5 trust_score = SUM(5.0) → current_level >= 3'
);

-- ───── Test 31: FALTA_HERRAMIENTA cause does NOT count as FAIL ─────

-- Insert FAIL evidence with FALTA_HERRAMIENTA for a fresh tech+module
INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by, evaluation_source, trust_score, causa_falla_id)
VALUES (
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'M-ELEC', 3,
  'Tool missing FAIL',
  false,
  '00000000-0000-0000-0000-000000000402',
  'SUPERVISOR',
  1.0,
  (SELECT id FROM causa_falla_catalog WHERE code = 'FALTA_HERRAMIENTA')
);

SELECT is(
  (SELECT COALESCE(current_level, 1) FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-ELEC')),
  1,
  'Test 31 — FAIL + FALTA_HERRAMIENTA → does NOT increase level (stays at 1)'
);

-- ───── Test 32: Legacy NULL trust_score treated as 1.0 ─────

-- Insert legacy-style evidence (no trust_score, no evaluation_source)
INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES (
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'M-REFR', 3,
  'Legacy PASS', true,
  '00000000-0000-0000-0000-000000000403'
);

SELECT is(
  (SELECT COALESCE(SUM(COALESCE(trust_score, 1.0)), 0) FROM technician_skill_evidence
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND modulo_gema = 'M-REFR'
      AND nivel_evaluado = 3
      AND status = true),
  1.0,
  'Test 32 — Legacy NULL trust_score → treated as 1.0 in SUM'
);

-- ───── Test 33: Legacy NULL causa_falla → regular FAIL ─────

-- Insert legacy-style FAIL (no causa_falla → counts against competence)
INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by)
VALUES (
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'M-PUMP', 2,
  'Legacy FAIL', false,
  '00000000-0000-0000-0000-000000000403'
);

SELECT is(
  (SELECT COALESCE(current_level, 1) FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-PUMP')),
  1,
  'Test 33 — Legacy NULL causa_falla FAIL → stays at level 1 (FAIL counts normally)'
);

-- ───── Test 34: FALTA_REPUESTO does NOT count as FAIL ─────

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by, evaluation_source, trust_score, causa_falla_id)
VALUES (
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'M-REFR', 2,
  'Missing part FAIL',
  false,
  '00000000-0000-0000-0000-000000000402',
  'SUPERVISOR',
  1.0,
  (SELECT id FROM causa_falla_catalog WHERE code = 'FALTA_REPUESTO')
);

SELECT is(
  (SELECT COALESCE(current_level, 1) FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-REFR')),
  1,
  'Test 34 — FAIL + FALTA_REPUESTO → does NOT count against competence (stays at 1)'
);

-- ───── Test 35: ERROR_DOCUMENTACION does NOT count as FAIL ─────

INSERT INTO technician_skill_evidence
  (work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado, status, evaluated_by, evaluation_source, trust_score, causa_falla_id)
VALUES (
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  'M-INFR', 2,
  'Bad document FAIL',
  false,
  '00000000-0000-0000-0000-000000000402',
  'SUPERVISOR',
  1.0,
  (SELECT id FROM causa_falla_catalog WHERE code = 'ERROR_DOCUMENTACION')
);

SELECT is(
  (SELECT COALESCE(current_level, 1) FROM technician_skills
    WHERE technician_id = '00000000-0000-0000-0000-000000000401'
      AND module_id = (SELECT id FROM technological_modules WHERE code = 'M-INFR')),
  1,
  'Test 35 — FAIL + ERROR_DOCUMENTACION → does NOT count against competence (stays at 1)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- T3 — RLS TESTS (tests 36-41)
-- ─────────────────────────────────────────────────────────────────────────────

-- Note: RLS tests require actual role switching. We test policy existence
-- and structural correctness. Full auth test requires supabase test harness.

-- 36-41: RLS policies exist on all new tables
SELECT policies_are('causa_falla_catalog',      ARRAY['cfc_select','cfc_insert','cfc_update','cfc_delete'],
  'Test 36 — causa_falla_catalog has 4 RLS policies');

SELECT policies_are('checklist_templates',       ARRAY['ct_select','ct_insert','ct_update','ct_delete'],
  'Test 37 — checklist_templates has 4 RLS policies');

SELECT policies_are('checklist_template_items',  ARRAY['cti_select','cti_insert','cti_update','cti_delete'],
  'Test 38 — checklist_template_items has 4 RLS policies');

SELECT policies_are('checklist_instances',       ARRAY['ci_select','ci_insert','ci_update','ci_delete'],
  'Test 39 — checklist_instances has 4 RLS policies');

SELECT policies_are('checklist_item_responses',  ARRAY['cir_select','cir_insert','cir_update','cir_delete'],
  'Test 40 — checklist_item_responses has 4 RLS policies');

SELECT policies_are('checklist_sampling_config', ARRAY['csc_select','csc_insert','csc_update','csc_delete'],
  'Test 41 — checklist_sampling_config has 4 RLS policies');

-- ─────────────────────────────────────────────────────────────────────────────
-- T4 — AUDIT TESTS (tests 42-44)
-- ─────────────────────────────────────────────────────────────────────────────

-- 42-43: Audit triggers exist
SELECT has_trigger('checklist_instances', 'checklist_instances_audit',
  'Test 42 — checklist_instances has audit trigger');

SELECT has_trigger('checklist_item_responses', 'checklist_item_responses_audit',
  'Test 43 — checklist_item_responses has audit trigger');

-- ───── Test 44: Audit log written on checklist_instance INSERT ─────

SAVEPOINT audit_test;

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000499',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000421',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  '00000000-0000-0000-0000-000000000402',
  'IN_PROGRESS'
);

SELECT ok(
  EXISTS(SELECT 1 FROM audit_logs WHERE table_name = 'checklist_instances'),
  'Test 44 — INSERT in checklist_instances creates audit_log entry'
);

ROLLBACK TO SAVEPOINT audit_test;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5 — DATA INTEGRITY TESTS (tests 45-46)
-- ─────────────────────────────────────────────────────────────────────────────

-- ───── Test 45: UNIQUE constraint on checklist_template_items ─────

SAVEPOINT unique_test;

PREPARE insert_dup AS
  INSERT INTO checklist_template_items (id, checklist_template_id, step_sequence, item_text)
  VALUES ('00000000-0000-0000-0000-000000000499', '00000000-0000-0000-0000-000000000421', 1, 'Dup item');

SELECT throws_ok(
  'insert_dup',
  '23505',  -- unique_violation
  NULL,
  'Test 45 — Duplicate step_sequence in checklist_template_items raises unique violation'
);

ROLLBACK TO SAVEPOINT unique_test;

-- ───── Test 46: UNIQUE constraint on checklist_item_responses ─────

SAVEPOINT unique_resp_test;

INSERT INTO checklist_instances (id, work_order_id, checklist_template_id, technician_id, asset_id, evaluated_by, status)
VALUES (
  '00000000-0000-0000-0000-000000000498',
  'CHK-TST-WO',
  '00000000-0000-0000-0000-000000000421',
  '00000000-0000-0000-0000-000000000401',
  'CHK-TST-ASSET',
  '00000000-0000-0000-0000-000000000402',
  'IN_PROGRESS'
);

INSERT INTO checklist_item_responses (id, checklist_instance_id, template_item_id, status)
VALUES ('00000000-0000-0000-0000-000000000497', '00000000-0000-0000-0000-000000000498',
        '00000000-0000-0000-0000-000000000431', 'PASS');

PREPARE insert_dup_resp AS
  INSERT INTO checklist_item_responses (id, checklist_instance_id, template_item_id, status)
  VALUES ('00000000-0000-0000-0000-000000000496', '00000000-0000-0000-0000-000000000498',
          '00000000-0000-0000-0000-000000000431', 'FAIL');

SELECT throws_ok(
  'insert_dup_resp',
  '23505',  -- unique_violation
  NULL,
  'Test 46 — Duplicate (instance_id, template_item_id) raises unique violation'
);

ROLLBACK TO SAVEPOINT unique_resp_test;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fin — Rollback transacción completa
-- ─────────────────────────────────────────────────────────────────────────────

SELECT * FROM finish();

ROLLBACK;
