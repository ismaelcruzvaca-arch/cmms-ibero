-- ============================================================
-- MIGRATION: Report View — Materials Consumed
-- Change: advanced-reports-slice2 (PR 1 of 3)
-- ============================================================
-- Vista para el reporte de materiales consumidos:
--   report_materials_consumed — consumo agregado por parte + WO
--
-- Idempotente: CREATE OR REPLACE VIEW
-- SECURITY INVOKER: RLS de tablas subyacentes se aplica automáticamente
-- ============================================================

-- -----------------------------------------------------------
-- 1. report_materials_consumed
--    Agrupa transacciones ISSUE/DIRECT_ISSUE por part_num y WO
--    qty es negativo para ISSUE/DIRECT_ISSUE; ABS() normaliza
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW report_materials_consumed WITH (security_invoker = true) AS
SELECT
  it.part_num,
  sp.description,
  sp.uom,
  SUM(ABS(it.qty)) AS total_qty,
  it.work_order_id,
  wo.description AS wo_description,
  MAX(it.created_at) AS last_transaction_at
FROM inventory_transactions it
LEFT JOIN spare_parts sp ON it.part_num = sp.part_num
LEFT JOIN work_orders wo ON it.work_order_id = wo.id
WHERE it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
GROUP BY it.part_num, sp.description, sp.uom, it.work_order_id, wo.description;

COMMENT ON VIEW report_materials_consumed IS
  'Materiales consumidos (ISSUE/DIRECT_ISSUE) agregados por parte y orden de trabajo';

COMMENT ON COLUMN report_materials_consumed.part_num IS
  'Número de parte (PartNum de Epicor)';
COMMENT ON COLUMN report_materials_consumed.description IS
  'Descripción de la parte desde spare_parts (NULL si se eliminó el catálogo)';
COMMENT ON COLUMN report_materials_consumed.uom IS
  'Unidad de medida (EA, KG, LT, etc.)';
COMMENT ON COLUMN report_materials_consumed.total_qty IS
  'Cantidad total consumida = SUM(ABS(qty)). qty es negativo en ISSUE/DIRECT_ISSUE';
COMMENT ON COLUMN report_materials_consumed.work_order_id IS
  'ID de la orden de trabajo asociada';
COMMENT ON COLUMN report_materials_consumed.wo_description IS
  'Descripción de la WO desde work_orders (NULL si se eliminó la WO)';
COMMENT ON COLUMN report_materials_consumed.last_transaction_at IS
  'Timestamp de la transacción más reciente en el grupo';

-- ============================================================
-- FIN MIGRATION: report_materials_consumed
-- ============================================================
