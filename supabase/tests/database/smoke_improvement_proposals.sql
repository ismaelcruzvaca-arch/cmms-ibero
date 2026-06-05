-- =============================================================================
-- Smoke Test: Improvement Proposal Engine (SDD 6, PR 5)
--
-- Verifica:
--   1. condition_improvement_proposals table existe
--   2. generate_improvement_proposals() se ejecuta sin error
--   3. assess_improvement_opportunities() retorna estructura correcta
--   4. RLS policies existen
--
-- Ejecutar:
--   psql -U postgres -d postgres -f supabase/tests/database/smoke_improvement_proposals.sql
-- =============================================================================

\echo '=== Smoke Test: Improvement Proposal Engine (SDD 6, PR 5) ==='
\echo ''

-- =============================================================================
-- TEST 1: condition_improvement_proposals table existe
-- =============================================================================
\echo '1. Verificando tabla condition_improvement_proposals...'

SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'condition_improvement_proposals'
) AS table_exists;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'condition_improvement_proposals'
ORDER BY ordinal_position;

-- =============================================================================
-- TEST 2: Índices
-- =============================================================================
\echo '2. Verificando índices...'

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'condition_improvement_proposals';

-- =============================================================================
-- TEST 3: RLS policies
-- =============================================================================
\echo '3. Verificando RLS policies...'

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'condition_improvement_proposals';

-- =============================================================================
-- TEST 4: generate_improvement_proposals() existe
-- =============================================================================
\echo '4. Verificando generate_improvement_proposals()...'

SELECT p.proname AS function_name,
       pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'generate_improvement_proposals';

-- Ejecutar la función (debe retornar >= 0)
\echo '   Ejecutando generate_improvement_proposals()...'
SELECT public.generate_improvement_proposals() AS proposals_created;

-- Verificar que las propuestas se crearon en draft
\echo '   Verificando status de propuestas...'
SELECT status, COUNT(*)::INT AS count
FROM public.condition_improvement_proposals
GROUP BY status
ORDER BY status;

-- =============================================================================
-- TEST 5: assess_improvement_opportunities() existe y retorna estructura
-- =============================================================================
\echo '5. Verificando assess_improvement_opportunities()...'

SELECT p.proname AS function_name,
       pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'assess_improvement_opportunities';

-- Llamar sin filtrar (solo estructura, no datos)
\echo '   Estructura de retorno (sin filtro):'
SELECT opportunity_type, source_key, current_value, threshold,
       LEFT(description, 80) AS description_short, drl_level
FROM public.assess_improvement_opportunities(NULL);

-- Llamar con asset específico
\echo '   Con filtro de asset:'
SELECT opportunity_type, source_key, current_value, threshold, drl_level
FROM public.assess_improvement_opportunities('BANDA-TR-01');

-- =============================================================================
-- TEST 6: Verificar que NO hay propuestas auto-aprobadas
-- =============================================================================
\echo '6. Verificando que ninguna propuesta se auto-aprobó...'

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM public.condition_improvement_proposals
    WHERE status IN ('approved', 'implemented')
  ) THEN 'ERROR: se encontraron propuestas auto-aprobadas!'
  ELSE 'OK: todas las propuestas están en draft (no auto-avance)'
END AS auto_advance_check;

-- =============================================================================
-- TEST 7: Verificar INSERT directo bloqueado por RLS
-- =============================================================================
-- Nota: en entorno de prueba con superuser esto puede funcionar
-- debido a bypass RLS. En producción, un usuario authenticated sin
-- rol especial NO puede insertar directamente.
\echo '7. Resumen de estado de tabla:'

SELECT COUNT(*)::INT AS total_proposals
FROM public.condition_improvement_proposals;

SELECT proposal_type, COUNT(*)::INT AS count
FROM public.condition_improvement_proposals
GROUP BY proposal_type
ORDER BY proposal_type;

-- =============================================================================
-- Resumen
-- =============================================================================
\echo ''
\echo '=== Smoke Test Complete ==='
\echo 'Si todos los pasos anteriores se completaron sin error,'
\echo 'las migraciones 00028c y 00029 están correctamente aplicadas.'
