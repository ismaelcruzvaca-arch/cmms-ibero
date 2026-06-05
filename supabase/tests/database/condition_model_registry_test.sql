-- =============================================================================
-- Model Registry + Change Control + DRL — Test Suite (pgTAP)
-- SDD 6, PR 1b: Functions + Views + Triggers + RLS
--
-- Assertions: schema (10), seeds (6), functions (6), triggers (6),
--   RLS (3) = 31
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_model_registry_test.sql
-- =============================================================================

BEGIN;

SELECT plan(31);

-- ===========================================================================
-- 1. SCHEMA (10 assertions)
--    3 tablas existen, UNIQUE constraints, CHECK constraints, índices
-- ===========================================================================

SELECT has_table('public', 'condition_degradation_models',
  '1a: condition_degradation_models existe');
SELECT has_table('public', 'condition_model_applicability',
  '1b: condition_model_applicability existe');
SELECT has_table('public', 'condition_change_proposals',
  '1c: condition_change_proposals existe');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_degradation_model_key'
    AND conrelid = 'public.condition_degradation_models'::regclass),
  '1d: UNIQUE (model_key) en condition_degradation_models'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_change_proposal_key'
    AND conrelid = 'public.condition_change_proposals'::regclass),
  '1e: UNIQUE (proposal_key) en condition_change_proposals'
);

SELECT col_has_check('public', 'condition_degradation_models', 'model_type',
  '1f: condition_degradation_models.model_type tiene CHECK');

SELECT col_has_check('public', 'condition_degradation_models', 'validation_status',
  '1g: condition_degradation_models.validation_status tiene CHECK');

SELECT col_has_check('public', 'condition_degradation_models', 'min_data_readiness_level',
  '1h: condition_degradation_models.min_data_readiness_level tiene CHECK');

SELECT has_index('public', 'condition_degradation_models', 'idx_cdm_status_drl',
  '1i: idx_cdm_status_drl existe');

SELECT has_index('public', 'condition_change_proposals', 'idx_ccp_entity',
  '1j: idx_ccp_entity (entity_type, entity_id) existe');

-- ===========================================================================
-- 2. SEEDS (6 assertions)
--    6 modelos con status y DRL correctos
-- ===========================================================================

SELECT is(
  (SELECT count(*)::int FROM public.condition_degradation_models),
  6,
  '2a: 6 modelos seed existen'
);

SELECT is(
  (SELECT validation_status FROM public.condition_degradation_models
   WHERE model_key = 'linear_extrapolation'),
  'active',
  '2b: linear_extrapolation status = active'
);

SELECT is(
  (SELECT min_data_readiness_level FROM public.condition_degradation_models
   WHERE model_key = 'linear_extrapolation'),
  2,
  '2c: linear_extrapolation DRL = 2'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_degradation_models
   WHERE validation_status = 'candidate' AND min_data_readiness_level = 4),
  2,
  '2d: 2 modelos candidate con DRL 4 (piecewise_linear + exponential)'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_degradation_models
   WHERE validation_status = 'draft' AND min_data_readiness_level = 6),
  3,
  '2e: 3 modelos draft con DRL 6 (weibull + gamma + wiener)'
);

SELECT is(
  (SELECT count(*)::int FROM public.condition_degradation_models
   WHERE model_key IN ('weibull_rul', 'gamma_process', 'wiener_process')),
  3,
  '2f: weibull, gamma y wiener existen con keys correctas'
);

-- ===========================================================================
-- 3. FUNCTIONS (6 assertions)
--    assess_data_readiness, compare_change_proposal, rollback_change
-- ===========================================================================

SELECT has_function('public', 'assess_data_readiness', ARRAY['text'],
  '3a: assess_data_readiness(TEXT) existe');

SELECT is(
  (SELECT drl_level FROM public.assess_data_readiness('__no_such_asset__') LIMIT 1),
  0,
  '3b: assess_data_readiness retorna DRL 0 para asset sin datos'
);

SELECT has_function('public', 'compare_change_proposal', ARRAY['uuid'],
  '3c: compare_change_proposal(UUID) existe');

SELECT is(
  public.compare_change_proposal('00000000-0000-0000-0000-000000000000'),
  NULL,
  '3d: compare_change_proposal retorna NULL para proposal inexistente'
);

SELECT has_function('public', 'rollback_change', ARRAY['uuid'],
  '3e: rollback_change(UUID) existe');

SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'condition_data_readiness'),
  '3f: condition_data_readiness view existe'
);

-- ===========================================================================
-- 4. TRIGGERS (6 assertions)
--    Transiciones válidas e inválidas, DRL hard gate, auditoría
-- ===========================================================================

SELECT has_trigger('public', 'condition_degradation_models', 'trg_model_status_audit',
  '4a: trg_model_status_audit existe en condition_degradation_models');

-- 4b: Transición válida: draft → candidate (weibull_rul empieza en draft)
SELECT lives_ok(
  $$UPDATE public.condition_degradation_models
    SET validation_status = 'candidate'
    WHERE model_key = 'weibull_rul' AND validation_status = 'draft'$$,
  '4b: draft → candidate aceptado (weibull_rul)'
);

-- 4c: Transición inválida: draft → active RECHAZADA (gamma_process está en draft)
SELECT throws_ok(
  $$UPDATE public.condition_degradation_models
    SET validation_status = 'active'
    WHERE model_key = 'gamma_process' AND validation_status = 'draft'$$,
  'P0001',
  NULL,
  '4c: draft → active RECHAZADO (salto prohibido)'
);

SELECT has_trigger('public', 'condition_change_proposals', 'trg_change_proposal_audit',
  '4d: trg_change_proposal_audit existe en condition_change_proposals');

-- 4e: Transición inválida: draft → active RECHAZADA en propuestas
INSERT INTO public.condition_change_proposals
  (proposal_key, title, entity_type, entity_id, change_type, status)
VALUES ('TST-TRG-INV', 'Trigger test invalid', 'threshold', 'tst-trg', 'update', 'draft')
ON CONFLICT (proposal_key) DO NOTHING;

SELECT throws_ok(
  $$UPDATE public.condition_change_proposals
    SET status = 'active'
    WHERE proposal_key = 'TST-TRG-INV' AND status = 'draft'$$,
  'P0001',
  NULL,
  '4e: draft → active RECHAZADO en propuestas (salto prohibido)'
);

-- 4f: Ciclo completo válido: draft → review → approved → active
UPDATE public.condition_change_proposals
  SET status = 'review'
  WHERE proposal_key = 'TST-TRG-INV' AND status = 'draft';

UPDATE public.condition_change_proposals
  SET status = 'approved'
  WHERE proposal_key = 'TST-TRG-INV' AND status = 'review';

SELECT lives_ok(
  $$UPDATE public.condition_change_proposals
    SET status = 'active'
    WHERE proposal_key = 'TST-TRG-INV' AND status = 'approved'$$,
  '4f: draft → review → approved → active aceptado (ciclo completo)'
);

-- ===========================================================================
-- 5. RLS (3 assertions)
--    anon bloqueado, authenticated SELECT permitido
-- ===========================================================================

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_degradation_models
    (model_key, model_name, model_type)
    VALUES ('rls_test', 'RLS Test', 'linear')$$,
  '42501',
  NULL,
  '5a: anon no puede INSERT en condition_degradation_models'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$INSERT INTO public.condition_change_proposals
    (proposal_key, title, entity_type, entity_id, change_type)
    VALUES ('rls_test', 'RLS Test', 'threshold', 'tst', 'update')$$,
  '42501',
  NULL,
  '5b: anon no puede INSERT en condition_change_proposals'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT count(*) FROM public.condition_degradation_models$$,
  '5c: authenticated puede SELECT condition_degradation_models'
);
RESET ROLE;

-- ===========================================================================
-- Finalizar suite pgTAP
-- ===========================================================================
SELECT * FROM finish();

ROLLBACK;
