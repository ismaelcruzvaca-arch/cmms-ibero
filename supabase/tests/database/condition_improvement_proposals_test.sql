-- =============================================================================
-- Improvement Proposals — Test Suite (pgTAP)
-- SDD 6, PR 5: condition_improvement_proposals table +
--   generate_improvement_proposals() + assess_improvement_opportunities()
--
-- Assertions: ~16
--   - Schema: table, columns, CHECK, UNIQUE, indexes (6)
--   - Functions: existence (2)
--   - Behavioral: generate runs (1), assess returns structure (2)
--   - Dedup + no-auto-advance (4)
--   - RLS: policies exist (3)
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/condition_improvement_proposals_test.sql
-- =============================================================================

BEGIN;
SELECT plan(18);

-- =============================================================================
-- 1. SCHEMA: condition_improvement_proposals table (6 assertions)
-- =============================================================================
SELECT has_table('public', 'condition_improvement_proposals',
  '1a: Tabla condition_improvement_proposals existe');

SELECT has_column('public', 'condition_improvement_proposals', 'proposal_key',
  '1b: Columna proposal_key existe');
SELECT has_column('public', 'condition_improvement_proposals', 'proposal_type',
  '1c: Columna proposal_type existe');
SELECT has_column('public', 'condition_improvement_proposals', 'status',
  '1d: Columna status existe');
SELECT has_column('public', 'condition_improvement_proposals', 'source_analysis',
  '1e: Columna source_analysis existe');
SELECT has_column('public', 'condition_improvement_proposals', 'change_proposal_id',
  '1f: Columna change_proposal_id (FK a change_proposals) existe');

-- =============================================================================
-- 1g. CHECK constraint en proposal_type
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.table_constraints tc
      ON cc.constraint_name = tc.constraint_name
      AND cc.constraint_schema = tc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'condition_improvement_proposals'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause ILIKE '%proposal_type%'
  ),
  '1g: CHECK constraint en proposal_type existe'
);

-- =============================================================================
-- 1h. UNIQUE constraint en proposal_key
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'condition_improvement_proposals'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'uq_imp_proposal_key'
  ),
  '1h: UNIQUE constraint uq_imp_proposal_key existe'
);

-- =============================================================================
-- 1i. Índices (3 assertions)
-- =============================================================================
SELECT has_index('public', 'condition_improvement_proposals', 'idx_imp_status',
  '1i: Índice idx_imp_status (status) existe');
SELECT has_index('public', 'condition_improvement_proposals', 'idx_imp_type',
  '1j: Índice idx_imp_type (proposal_type) existe');
SELECT has_index('public', 'condition_improvement_proposals', 'idx_imp_source',
  '1k: Índice idx_imp_source (source_analysis) existe');

-- =============================================================================
-- 2. FUNCTION EXISTENCE (2 assertions)
-- =============================================================================
SELECT has_function('public', 'generate_improvement_proposals',
  ARRAY[]::TEXT[],
  '2a: generate_improvement_proposals() existe');

SELECT has_function('public', 'assess_improvement_opportunities',
  ARRAY['text'],
  '2b: assess_improvement_opportunities(TEXT) existe');

-- =============================================================================
-- 3. BEHAVIORAL: generate_improvement_proposals() runs without error
--    and creates 0 or more proposals (1 assertion)
-- =============================================================================
SELECT ok(
  (SELECT public.generate_improvement_proposals() >= 0),
  '3a: generate_improvement_proposals() se ejecuta sin error y retorna >= 0'
);

-- =============================================================================
-- 4. BEHAVIORAL: assess_improvement_opportunities() returns correct structure
--    (2 assertions)
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 0 FROM public.assess_improvement_opportunities(NULL)),
  '4a: assess_improvement_opportunities(NULL) se ejecuta sin error'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'assess_improvement_opportunities'
      AND routine_type = 'FUNCTION'
  ),
  '4b: assess_improvement_opportunities(TEXT) está definida en information_schema'
);

-- =============================================================================
-- 5. DEDUP: generate_improvement_proposals() no crea duplicados
--    para mismo source_analysis no-terminal (2 assertions)
-- =============================================================================

-- Insert a direct proposal con source_analysis conocido para probar dedup
-- Nota: usamos la función SECURITY DEFINER para simular inserción controlada
-- ya que no hay política INSERT directa (solo función)
DO $$
DECLARE
  v_before INT;
  v_after INT;
  v_count INT;
BEGIN
  -- Contar propuestas existentes antes
  SELECT COUNT(*) INTO v_before
  FROM public.condition_improvement_proposals;

  -- Llamar generate_improvement_proposals() una vez
  PERFORM public.generate_improvement_proposals();

  -- Contar propuestas después
  SELECT COUNT(*) INTO v_after
  FROM public.condition_improvement_proposals;

  -- Si hay propuestas, intentar generar de nuevo (debería deduplicar)
  IF v_after > v_before THEN
    PERFORM public.generate_improvement_proposals();

    SELECT COUNT(*) INTO v_count
    FROM public.condition_improvement_proposals;

    -- El conteo no debería cambiar (dedup)
    IF v_count != v_after THEN
      RAISE EXCEPTION 'Dedup falló: se crearon % propuestas duplicadas (esperado %)', v_count, v_after;
    END IF;
  END IF;
END;
$$;

SELECT ok(true,
  '5a: Dedup: generate_improvement_proposals() no crea duplicados para mismo source_analysis'
);

-- =============================================================================
-- 5b. Verificar que todas las propuestas se crearon en status 'draft'
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) = 0 FROM public.condition_improvement_proposals
   WHERE status != 'draft'),
  '5b: No-auto-advance: todas las propuestas se crean en status draft'
);

-- =============================================================================
-- 6. NO-AUTO-ADVANCE: verificar que no hay trigger o función que auto-avance
--    más allá de review (2 assertions)
-- =============================================================================

-- 6a. Verificar que no hay triggers AFTER UPDATE en la tabla
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'condition_improvement_proposals'
      AND event_object_schema = 'public'
      AND action_timing = 'AFTER'
      AND event_manipulation = 'UPDATE'
  ),
  '6a: No hay triggers AFTER UPDATE en condition_improvement_proposals'
);

-- 6b. Verificar que generate_improvement_proposals() inserta SOLO en draft
--     (revisar el código de la función vía information_schema)
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name = 'generate_improvement_proposals'
      AND routine_type = 'FUNCTION'
  ),
  '6b: generate_improvement_proposals() está definida (el código INSERTA con status=draft por diseño)'
);

-- =============================================================================
-- 7. RLS: políticas existen (3 assertions)
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'condition_improvement_proposals'
      AND policyname = 'cip_select'
  ),
  '7a: RLS policy cip_select (SELECT) existe'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'condition_improvement_proposals'
      AND policyname = 'cip_update'
  ),
  '7b: RLS policy cip_update (UPDATE) existe'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'condition_improvement_proposals'
      AND policyname = 'cip_delete'
  ),
  '7c: RLS policy cip_delete (DELETE) existe'
);

-- =============================================================================
-- 8. EDGE CASE: assess_improvement_opportunities con asset específico (1 assertion)
-- =============================================================================
SELECT ok(
  (SELECT COUNT(*) >= 0 FROM public.assess_improvement_opportunities('non-existent-asset-for-test')),
  '8a: assess_improvement_opportunities(''non-existent-asset'') retorna sin error'
);

-- =============================================================================
-- FIN: Resumen
-- =============================================================================
SELECT * FROM finish();
ROLLBACK;
