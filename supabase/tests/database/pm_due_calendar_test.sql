-- =============================================================================
-- pm_due_calendar — Test Suite (pgTAP)
-- 3 test cases: exists, columns, order
-- =============================================================================

BEGIN;

SELECT plan(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 1: La vista existe y devuelve filas con seed data
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT COUNT(*) > 0 FROM pm_due_calendar),
  'Test 1 — pm_due_calendar devuelve filas con seed data'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 2: Columnas esperadas existen
-- ─────────────────────────────────────────────────────────────────────────────
SELECT columns_are(
  'public',
  'pm_due_calendar',
  ARRAY[
    'schedule_id',
    'asset_id',
    'asset_name',
    'job_plan_title',
    'projected_date',
    'wo_type',
    'intervention_type',
    'time_frequency_days',
    'parent_schedule_id',
    'status'
  ],
  'Test 2 — pm_due_calendar tiene las 10 columnas esperadas'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 3: Resultados ordenados por projected_date ASC
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(projected_date <= next_projected_date)
   FROM (
     SELECT projected_date,
            LEAD(projected_date) OVER (ORDER BY projected_date) AS next_projected_date
     FROM pm_due_calendar
   ) sub
   WHERE next_projected_date IS NOT NULL),
  'Test 3 — pm_due_calendar ordenada por projected_date ASC'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Finalizar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT * FROM finish();

ROLLBACK;
