-- =============================================================================
-- report_materials_consumed — Test Suite (pgTAP)
-- SDD advanced-reports-slice2, PR 1 of 3
--
-- Assertions: View existence (1), column shape (1), security_invoker (1),
--   filtering (3), ABS aggregation (2), JOIN correctness (2), empty (1) = 11
--
-- Ejecutar (con pgTAP instalado):
--   supabase db test --file supabase/tests/database/report_materials_consumed_test.sql
-- =============================================================================

BEGIN;

SELECT plan(11);

-- ===========================================================================
-- 0. Setup: seed data with known values for verification
-- ===========================================================================

-- Spare parts
INSERT INTO spare_parts (part_num, description, uom)
VALUES
  ('MAT-P1', 'Bearing SKF 6205', 'EA'),
  ('MAT-P2', 'Oil Filter HF-100', 'EA')
ON CONFLICT (part_num) DO NOTHING;

-- Work order (asset_id is nullable, equipment_id is NOT NULL)
INSERT INTO work_orders (id, equipment_id, description)
VALUES ('WO-MAT-TEST-1', 'EQ-MAT-TEST', 'WO for materials test')
ON CONFLICT (id) DO NOTHING;

-- Inventory transactions with known qty values:
--   MAT-P1: ISSUE(-5) + DIRECT_ISSUE(-3) = 8 consumption
--   MAT-P2: ISSUE(-2) = 2 consumption
--   RETURN(+5) and RECEIPT(+10) must be excluded
INSERT INTO inventory_transactions (id, transaction_type, part_num, qty, work_order_id, created_at)
VALUES
  (gen_random_uuid(), 'ISSUE'::transaction_type_enum,        'MAT-P1', -5, 'WO-MAT-TEST-1', '2026-06-01 08:00:00+00'),
  (gen_random_uuid(), 'DIRECT_ISSUE'::transaction_type_enum,  'MAT-P1', -3, 'WO-MAT-TEST-1', '2026-06-01 09:00:00+00'),
  (gen_random_uuid(), 'ISSUE'::transaction_type_enum,        'MAT-P2', -2, 'WO-MAT-TEST-1', '2026-06-01 10:00:00+00'),
  (gen_random_uuid(), 'RETURN'::transaction_type_enum,        'MAT-P1',  5, 'WO-MAT-TEST-1', '2026-06-01 11:00:00+00'),
  (gen_random_uuid(), 'RECEIPT'::transaction_type_enum,       'MAT-P1', 10, 'WO-MAT-TEST-1', '2026-06-01 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 1. VIEW EXISTENCE
-- ===========================================================================

SELECT has_view('public', 'report_materials_consumed',
  '1: report_materials_consumed view existe');

-- ===========================================================================
-- 2. COLUMN SHAPE
-- ===========================================================================

SELECT columns_are('public', 'report_materials_consumed',
  ARRAY['part_num', 'description', 'uom', 'total_qty', 'work_order_id', 'wo_description', 'last_transaction_at'],
  '2: columnas: part_num, description, uom, total_qty, work_order_id, wo_description, last_transaction_at'
);

-- ===========================================================================
-- 3. SECURITY INVOKER
--    En PG 17, security_invoker se almacena en reloptions (no relrowsecurity)
-- ===========================================================================

SELECT is(
  (SELECT 'security_invoker=true' = ANY(COALESCE(reloptions, '{}'))
   FROM pg_class WHERE oid = 'report_materials_consumed'::regclass),
  true,
  '3: security_invoker habilitado (reloptions)'
);

-- ===========================================================================
-- 4. FILTERING — solo ISSUE y DIRECT_ISSUE
-- ===========================================================================

-- 4a. ISSUE/DIRECT_ISSUE transactions appear in the view
SELECT isnt_empty(
  'SELECT 1 FROM report_materials_consumed WHERE part_num = ''MAT-P1''',
  '4a: ISSUE/DIRECT_ISSUE aparecen en la vista'
);

-- 4b. RETURN+RECEIPT excluded: total_qty = 8 (|-5| + |-3|), not 23
SELECT is(
  (SELECT total_qty::numeric FROM report_materials_consumed
   WHERE part_num = 'MAT-P1' AND work_order_id = 'WO-MAT-TEST-1'),
  8,
  '4b: RETURN/RECEIPT excluidos — total_qty = 8 no 23'
);

-- 4c: Only 2 grouped rows (MAT-P1, MAT-P2), RETURN/RECEIPT create no phantom rows
SELECT is(
  (SELECT count(*)::int FROM report_materials_consumed),
  2,
  '4c: solo 2 filas (MAT-P1 + MAT-P2), RETURN/RECEIPT no generan filas'
);

-- ===========================================================================
-- 5. ABS AGGREGATION — SUM(ABS(qty)) correcto
-- ===========================================================================

-- 5a. MAT-P1: ABS(-5) + ABS(-3) = 8
SELECT is(
  (SELECT total_qty::numeric FROM report_materials_consumed
   WHERE part_num = 'MAT-P1' AND work_order_id = 'WO-MAT-TEST-1'),
  8,
  '5a: MAT-P1 total_qty = ABS(-5) + ABS(-3) = 8'
);

-- 5b. MAT-P2: ABS(-2) = 2
SELECT is(
  (SELECT total_qty::numeric FROM report_materials_consumed
   WHERE part_num = 'MAT-P2' AND work_order_id = 'WO-MAT-TEST-1'),
  2,
  '5b: MAT-P2 total_qty = ABS(-2) = 2'
);

-- ===========================================================================
-- 6. JOIN CORRECTNESS — spare_parts y work_orders
-- ===========================================================================

-- 6a. description se trae de spare_parts
SELECT is(
  (SELECT description FROM report_materials_consumed
   WHERE part_num = 'MAT-P1' AND work_order_id = 'WO-MAT-TEST-1'),
  'Bearing SKF 6205',
  '6a: description (spare_parts) correcta — Bearing SKF 6205'
);

-- 6b. wo_description se trae de work_orders
SELECT is(
  (SELECT wo_description FROM report_materials_consumed
   WHERE part_num = 'MAT-P1' AND work_order_id = 'WO-MAT-TEST-1'),
  'WO for materials test',
  '6b: wo_description (work_orders) correcta — WO for materials test'
);

-- ===========================================================================
-- 7. EMPTY TABLE — parte inexistente retorna 0 filas
-- ===========================================================================

SELECT is(
  (SELECT count(*)::int FROM report_materials_consumed WHERE part_num = 'NONEXISTENT-PART'),
  0,
  '7: parte inexistente retorna 0 filas'
);

-- ===========================================================================
-- Cleanup
-- ===========================================================================

DELETE FROM inventory_transactions WHERE work_order_id = 'WO-MAT-TEST-1';
DELETE FROM work_orders WHERE id = 'WO-MAT-TEST-1';
DELETE FROM spare_parts WHERE part_num IN ('MAT-P1', 'MAT-P2');

SELECT * FROM finish();

ROLLBACK;
