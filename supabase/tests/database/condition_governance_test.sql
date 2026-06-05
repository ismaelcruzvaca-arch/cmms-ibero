-- =============================================================================
-- Condition Monitoring — Governance Test Suite (pgTAP)
-- SDD 5, PR 1c: Triggers + Seeds + Cron + pgTAP
--
-- Assertions: schema (12), functions (7), triggers (6), policies (8),
--   RLS (5), behavioral (13) = 51
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_governance_test.sql
-- =============================================================================

BEGIN;

SELECT plan(51);

-- ===========================================================================
-- 1. SCHEMA (12 assertions)
-- ===========================================================================

SELECT has_column('public', 'condition_automation_policies', 'policy_version',
  '1a: condition_automation_policies.policy_version existe');

SELECT has_column('public', 'condition_automation_policies', 'valid_from',
  '1b: condition_automation_policies.valid_from existe');
SELECT has_column('public', 'condition_automation_policies', 'valid_to',
  '1c: condition_automation_policies.valid_to existe');

SELECT has_column('public', 'condition_diagnosis_feedback', 'recommendation_usefulness',
  '1d: condition_diagnosis_feedback.recommendation_usefulness existe');

SELECT col_has_check('public', 'condition_diagnosis_feedback', 'feedback_status',
  '1e: condition_diagnosis_feedback.feedback_status tiene CHECK');

SELECT has_column('public', 'condition_audit_log', 'action',
  '1f: condition_audit_log.action existe');
SELECT has_column('public', 'condition_audit_log', 'entity_type',
  '1g: condition_audit_log.entity_type existe');

PREPARE dup_metric AS
  INSERT INTO public.condition_daily_metrics (metric_date, asset_id)
  VALUES ('2026-06-01', 'a'), ('2026-06-01', 'a');
SELECT throws_ok('dup_metric', '23505', NULL,
  '1h: UNIQUE(metric_date, asset_id) rechaza duplicado');

SELECT has_column('public', 'maintenance_recommendations', 'reviewed_by',
  '1i: maintenance_recommendations.reviewed_by existe');
SELECT has_column('public', 'maintenance_recommendations', 'work_order_id',
  '1j: maintenance_recommendations.work_order_id existe');

INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('TST-SC-FM', 'test', 'Schema FM test', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

INSERT INTO public.condition_diagnoses (asset_id, failure_mode_id, diagnosis_status)
SELECT 'tst-sc', id, 'candidate'
FROM public.condition_failure_mode_catalog
WHERE failure_mode_key = 'TST-SC-FM';

SELECT lives_ok(
  $$INSERT INTO public.maintenance_recommendations
    (status, diagnosis_id, recommended_action, priority)
  SELECT 'expired', id, 'T', 'low'
  FROM public.condition_diagnoses WHERE asset_id = 'tst-sc' LIMIT 1$$,
  '1k: status=expired valido'
);

PREPARE dup_policy_key AS
  INSERT INTO public.condition_automation_policies
    (policy_key, policy_version, policy_name, conditions)
  VALUES ('conservative', 1, 'd', '{}');
SELECT throws_ok('dup_policy_key', '23505', NULL,
  '1l: UNIQUE(policy_key, policy_version) rechaza duplicado');

-- ===========================================================================
-- 2. FUNCTIONS (7 assertions)
-- ===========================================================================

SELECT has_function('public', 'evaluate_automation_policy', ARRAY['uuid'],
  '2a: evaluate_automation_policy(UUID) existe');
SELECT has_function('public', 'generate_recommendation_v2', ARRAY['uuid'],
  '2b: generate_recommendation_v2(UUID) existe');
SELECT has_function('public', 'compute_source_quality_stats', '{}',
  '2c: compute_source_quality_stats() existe');
SELECT has_function('public', 'compute_daily_metrics', ARRAY['date'],
  '2d: compute_daily_metrics(DATE) existe');
SELECT has_function('public', 'convert_recommendation_to_wo', ARRAY['uuid'],
  '2e: convert_recommendation_to_wo(UUID) existe');
SELECT has_function('public', 'expire_stale_recommendations', '{}',
  '2f: expire_stale_recommendations() existe');
SELECT has_function('public', 'log_audit_entry',
  ARRAY['text', 'text', 'text', 'jsonb', 'jsonb', 'text'],
  '2g: log_audit_entry(...) existe');

-- ===========================================================================
-- 3. TRIGGERS (6 assertions)
-- ===========================================================================

SELECT has_trigger('public', 'maintenance_recommendations', 'trg_maint_rec_audit',
  '3a: trg_maint_rec_audit existe en maintenance_recommendations');
SELECT has_trigger('public', 'condition_automation_policies', 'trg_policy_audit',
  '3b: trg_policy_audit existe en condition_automation_policies');
SELECT has_trigger('public', 'condition_diagnosis_feedback', 'trg_feedback_audit',
  '3c: trg_feedback_audit existe en condition_diagnosis_feedback');
SELECT has_trigger('public', 'condition_diagnosis_feedback', 'trg_feedback_summary',
  '3d: trg_feedback_summary existe en condition_diagnosis_feedback');

-- 3e: Feedback summary trigger actualiza feedback_status en condition_diagnoses
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('TST-TRG-FM', 'test', 'Trigger FM test', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

CREATE TEMP TABLE _t3e ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-TRG-FM'
), diag AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-trg', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm
  RETURNING id
), fb AS (
  INSERT INTO public.condition_diagnosis_feedback
    (diagnosis_id, feedback_status, technician_observation, reviewed_by)
  SELECT id, 'confirmed', 'Funciona correctamente', 'tester@test.com'
  FROM diag
  RETURNING diagnosis_id
)
SELECT diagnosis_id FROM fb;

SELECT is(
  (SELECT feedback_status FROM public.condition_diagnoses
   WHERE id = (SELECT diagnosis_id FROM _t3e)),
  'confirmed',
  '3e: trg_feedback_summary actualiza feedback_status'
);

-- 3f: Feedback summary trigger actualiza feedback_notes
CREATE TEMP TABLE _t3f ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-TRG-FM'
), diag AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-trg2', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm
  RETURNING id
), fb AS (
  INSERT INTO public.condition_diagnosis_feedback
    (diagnosis_id, feedback_status, technician_observation, reviewed_by)
  SELECT id, 'partial', 'Observacion tecnica', 'tester@test.com'
  FROM diag
  RETURNING diagnosis_id
)
SELECT diagnosis_id FROM fb;

SELECT ok(
  (SELECT feedback_notes FROM public.condition_diagnoses
   WHERE id = (SELECT diagnosis_id FROM _t3f))
  LIKE '%Observacion tecnica%',
  '3f: trg_feedback_summary actualiza feedback_notes'
);

-- ===========================================================================
-- 4. POLICIES (8 assertions)
-- ===========================================================================

SELECT is(
  (SELECT policy_key FROM public.condition_automation_policies
   WHERE policy_key = 'conservative' AND policy_version = 1),
  'conservative',
  '4a: Politica conservadora existe'
);
SELECT is(
  (SELECT policy_key FROM public.condition_automation_policies
   WHERE policy_key = 'permissive' AND policy_version = 1),
  'permissive',
  '4b: Politica permisiva existe'
);
SELECT is(
  (SELECT evaluation_order FROM public.condition_automation_policies
   WHERE policy_key = 'conservative' AND policy_version = 1),
  10,
  '4c: Conservadora evaluation_order = 10'
);
SELECT is(
  (SELECT evaluation_order FROM public.condition_automation_policies
   WHERE policy_key = 'permissive' AND policy_version = 1),
  20,
  '4d: Permisiva evaluation_order = 20'
);
SELECT is(
  (SELECT conditions->>'requires_approval' FROM public.condition_automation_policies
   WHERE policy_key = 'conservative' AND policy_version = 1),
  'true',
  '4e: Conservadora requires_approval = true'
);
SELECT is(
  (SELECT conditions->>'requires_approval' FROM public.condition_automation_policies
   WHERE policy_key = 'permissive' AND policy_version = 1),
  'false',
  '4f: Permisiva requires_approval = false'
);
SELECT is(
  (SELECT count(*)::int FROM public.condition_automation_policies
   WHERE is_active = true AND policy_key IN ('conservative', 'permissive')),
  2,
  '4g: Ambas is_active = true'
);
SELECT is(
  (SELECT count(*)::int FROM public.condition_automation_policies
   WHERE policy_version = 1 AND policy_key IN ('conservative', 'permissive')),
  2,
  '4h: Ambas policy_version = 1'
);

-- ===========================================================================
-- 5. RLS (5 assertions)
-- ===========================================================================

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_automation_policies
    (policy_key, policy_version, policy_name, conditions)
    VALUES ('rls_test', 1, 'RLS Test', '{}')$$,
  '42501', NULL,
  '5a: anon no puede INSERT en condition_automation_policies'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_audit_log
    (action, entity_type, entity_id, changed_by)
    VALUES ('test', 'test', '1', 'anon')$$,
  '42501', NULL,
  '5b: anon no puede INSERT en condition_audit_log'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT count(*) FROM public.condition_automation_policies$$,
  '5c: authenticated puede SELECT condition_automation_policies'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT count(*) FROM public.condition_audit_log$$,
  '5d: authenticated puede SELECT condition_audit_log'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT lives_ok(
  $$SELECT count(*) FROM public.condition_daily_metrics$$,
  '5e: anon puede SELECT condition_daily_metrics'
);
RESET ROLE;

-- ===========================================================================
-- 6. BEHAVIORAL (13 assertions)
-- ===========================================================================

-- 6a: evaluate_automation_policy returns NULL for non-existent diagnosis
SELECT is(
  (SELECT policy_key FROM public.evaluate_automation_policy('00000000-0000-0000-0000-000000000000')),
  NULL,
  '6a: evaluate_automation_policy retorna NULL para diagnostico inexistente'
);

-- 6b: generate_recommendation_v2 returns NULL for non-existent diagnosis
SELECT is(
  public.generate_recommendation_v2('00000000-0000-0000-0000-000000000000'),
  NULL,
  '6b: generate_recommendation_v2 retorna NULL para diagnostico inexistente'
);

-- Setup for behavioral tests (6c-6l)
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('TST-BEH-FM', 'test', 'Behavioral FM test', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

INSERT INTO public.condition_sources
  (source_id, source_type, name, asset_id, status, created_by)
VALUES ('tst-beh', 'edge', 'Behavioral Source', 'tst-beh', 'active', 'test')
ON CONFLICT (source_id) DO NOTHING;

-- 6c: convert_recommendation_to_wo rejects non-approved status
CREATE TEMP TABLE _t6c ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-BEH-FM'
), diag AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-beh', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm RETURNING id
), rec AS (
  INSERT INTO public.maintenance_recommendations
    (diagnosis_id, recommended_action, priority, status)
  SELECT id, 'Test action', 'medium', 'suggested' FROM diag RETURNING id
)
SELECT id AS rec_id FROM rec;

PREPARE p6c AS
  SELECT public.convert_recommendation_to_wo((SELECT rec_id FROM _t6c));
SELECT throws_ok('p6c', NULL, NULL,
  '6c: convert_recommendation_to_wo rechaza status no aprobado');

-- 6d: convert_recommendation_to_wo rejects duplicate WO for same diagnosis
CREATE TEMP TABLE _t6d ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-BEH-FM'
), diag AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-beh-d', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm RETURNING id
), r1 AS (
  INSERT INTO public.maintenance_recommendations
    (diagnosis_id, recommended_action, priority, status)
  SELECT id, 'WO test 1', 'medium', 'approved' FROM diag RETURNING id
), r2 AS (
  INSERT INTO public.maintenance_recommendations
    (diagnosis_id, recommended_action, priority, status)
  SELECT id, 'WO test 2', 'medium', 'approved' FROM diag RETURNING id
)
SELECT r1.id AS r1, r2.id AS r2 FROM r1, r2;

PREPARE p6d1 AS
  SELECT public.convert_recommendation_to_wo((SELECT r1 FROM _t6d));
SELECT lives_ok('p6d1', '6d: Primera conversion WO exitosa');

PREPARE p6d2 AS
  SELECT public.convert_recommendation_to_wo((SELECT r2 FROM _t6d));
SELECT throws_ok('p6d2', NULL, NULL,
  '6d: Segunda conversion para mismo diagnostico rechazada');

-- 6e: expire_stale_recommendations returns 0 when none stale
SELECT is(public.expire_stale_recommendations(), 0,
  '6e: expire_stale_recommendations retorna 0 sin vencidas');

-- 6f: log_audit_entry inserts successfully
SELECT ok(
  public.log_audit_entry('test_action', 'test_entity', 'test-id',
    NULL, NULL, 'Test manual insert') IS NOT NULL,
  '6f: log_audit_entry inserta exitosamente y retorna UUID');

-- 6g: compute_daily_metrics returns 0 for empty date range
SELECT is(public.compute_daily_metrics('2020-01-01'::date), 0,
  '6g: compute_daily_metrics retorna 0 para fecha sin datos');

-- 6h: compute_source_quality_stats returns 9 OUT columns
SELECT is(
  (SELECT count(*)::int FROM information_schema.parameters p
   JOIN information_schema.routines r
     ON r.specific_name = p.specific_name
    AND r.specific_schema = p.specific_schema
   WHERE r.specific_schema = 'public'
     AND r.routine_name = 'compute_source_quality_stats'
     AND r.routine_type = 'FUNCTION'
     AND p.parameter_mode = 'OUT'),
  9,
  '6h: compute_source_quality_stats retorna 9 columnas OUT');

-- 6i: compute_daily_metrics is idempotent
WITH run1 AS (
  SELECT public.compute_daily_metrics('2019-01-01'::date) AS cnt
)
SELECT is(public.compute_daily_metrics('2019-01-01'::date),
  (SELECT cnt FROM run1),
  '6i: compute_daily_metrics es idempotente');

-- 6j: compute_daily_metrics accepts past date parameter (backfill)
SELECT is(public.compute_daily_metrics('2025-01-01'::date), 0,
  '6j: compute_daily_metrics acepta fecha pasada (backfill)');

-- 6k: Repeat-dismissal gate
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('TST-RPT-FM', 'test', 'Repeat FM test', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

INSERT INTO public.condition_sources
  (source_id, source_type, name, asset_id, status, created_by)
VALUES ('tst-rpt', 'edge', 'Repeat Source', 'tst-rpt', 'active', 'test')
ON CONFLICT (source_id) DO NOTHING;

CREATE TEMP TABLE _t6k ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-RPT-FM'
), d1 AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-rpt', fm.id, 'rejected', 0.5,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm RETURNING id
), d2 AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-rpt', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 0, "quality_modifier": 0.7}'::jsonb
  FROM fm RETURNING id
)
SELECT d2.id AS did FROM d2;

SELECT is(
  (SELECT policy_key FROM public.evaluate_automation_policy((SELECT did FROM _t6k))),
  'repeat_dismissal_gate',
  '6k: Repeat-dismissal gate fuerza review_required para FM rechazado'
);

-- 6l: evaluate_automation_policy checks contradictory_count from evidence_summary
INSERT INTO public.condition_failure_mode_catalog
  (failure_mode_key, asset_class, name, severity_default, category)
VALUES ('TST-CTR-FM', 'test', 'Contradictory FM test', 'medium', 'asset')
ON CONFLICT (failure_mode_key) DO NOTHING;

INSERT INTO public.condition_sources
  (source_id, source_type, name, asset_id, status, created_by)
VALUES ('tst-ctr', 'edge', 'Contra Source', 'tst-ctr', 'active', 'test')
ON CONFLICT (source_id) DO NOTHING;

CREATE TEMP TABLE _t6l ON COMMIT DROP AS
WITH fm AS (
  SELECT id FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = 'TST-CTR-FM'
), diag AS (
  INSERT INTO public.condition_diagnoses
    (asset_id, failure_mode_id, diagnosis_status, confidence, evidence_summary)
  SELECT 'tst-ctr', fm.id, 'active', 0.9,
    '{"completeness": 0.8, "contradictory_count": 1, "quality_modifier": 0.7}'::jsonb
  FROM fm RETURNING id
)
SELECT id AS did FROM diag;

SELECT is(
  (SELECT policy_key FROM public.evaluate_automation_policy((SELECT did FROM _t6l))),
  'fallback',
  '6l: contradictory_count=1 salta politicas, retorna fallback'
);

-- ===========================================================================
-- Finalizar suite pgTAP
-- ===========================================================================
SELECT * FROM finish();
ROLLBACK;
