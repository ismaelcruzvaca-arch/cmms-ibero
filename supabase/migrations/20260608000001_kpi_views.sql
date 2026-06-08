-- ============================================================
-- MIGRATION: KPI Views for Advanced Reports
-- Change: advanced-reports-slice1
-- ============================================================
-- Vistas para reportes avanzados y cálculos de KPI:
--   kpi_mtbf              — Mean Time Between Failures por asset
--   kpi_mttr              — Mean Time To Repair por asset
--   kpi_availability       — Availability % derivada de MTBF + MTTR
--   report_maintenance_history — Consolidado work_orders + assets
--   report_labor_hours     — Consolidado labor_records + user_profiles
--
-- Idempotente: CREATE OR REPLACE VIEW
-- SECURITY INVOKER: RLS de tablas subyacentes se aplica automáticamente
-- ============================================================

-- -----------------------------------------------------------
-- 1. kpi_mtbf: Mean Time Between Failures por asset + mes (horas)
--    Fórmula: SUM(machine_up_at - machine_down_at) / COUNT(*)
--    Filtrado: wo_type IN ('CM','EM'), ambos timestamps NOT NULL
--    Agrupación mensual por asset para trend lines
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW kpi_mtbf WITH (security_invoker = true) AS
SELECT
  asset_id,
  DATE_TRUNC('month', machine_down_at)::date AS period_month,
  EXTRACT(EPOCH FROM SUM(machine_up_at - machine_down_at)) / 3600 / NULLIF(COUNT(*), 0) AS mtbf_hours,
  COUNT(*) AS wo_count
FROM work_orders
WHERE wo_type IN ('CM', 'EM')
  AND machine_down_at IS NOT NULL
  AND machine_up_at IS NOT NULL
GROUP BY asset_id, DATE_TRUNC('month', machine_down_at);

COMMENT ON VIEW kpi_mtbf IS
  'MTBF por asset y mes en horas — Mean Time Between Failures (CM/EM)';

COMMENT ON COLUMN kpi_mtbf.asset_id IS
  'ID del activo (text)';
COMMENT ON COLUMN kpi_mtbf.period_month IS
  'Período mensual (primer día del mes)';
COMMENT ON COLUMN kpi_mtbf.mtbf_hours IS
  'MTBF en horas = SUM(uptime_interval) / COUNT(failure_events)';
COMMENT ON COLUMN kpi_mtbf.wo_count IS
  'Cantidad de WOs en el período';

-- -----------------------------------------------------------
-- 2. kpi_mttr: Mean Time To Repair por asset + mes (horas)
--    Fórmula: AVG(machine_up_at - machine_down_at) en horas
--    Filtrado: lifecycle_phase IN ('COMP','CLOSED'),
--              machine_down_at y machine_up_at NOT NULL
--    MTTR mide el tiempo desde que se detecta la falla
--    hasta que el equipo vuelve a operar
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW kpi_mttr WITH (security_invoker = true) AS
SELECT
  asset_id,
  DATE_TRUNC('month', machine_up_at)::date AS period_month,
  AVG(EXTRACT(EPOCH FROM (machine_up_at - machine_down_at)) / 3600) AS mttr_hours,
  COUNT(*) AS wo_count
FROM work_orders
WHERE lifecycle_phase IN ('COMP', 'CLOSED')
  AND machine_down_at IS NOT NULL
  AND machine_up_at IS NOT NULL
GROUP BY asset_id, DATE_TRUNC('month', machine_up_at);

COMMENT ON VIEW kpi_mttr IS
  'MTTR por asset y mes en horas — Mean Time To Repair';

COMMENT ON COLUMN kpi_mttr.asset_id IS
  'ID del activo (text)';
COMMENT ON COLUMN kpi_mttr.period_month IS
  'Período mensual (primer día del mes)';
COMMENT ON COLUMN kpi_mttr.mttr_hours IS
  'MTTR en horas = AVG(machine_up_at - machine_down_at)';
COMMENT ON COLUMN kpi_mttr.wo_count IS
  'Cantidad de WOs en el período';

-- -----------------------------------------------------------
-- 3. kpi_availability: Availability % por asset + mes
--    Fórmula: MTBF / (MTBF + MTTR) × 100
--    Joins kpi_mtbf + kpi_mttr por asset + period_month
--    Retorna NULL cuando faltan datos de MTBF o MTTR
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW kpi_availability WITH (security_invoker = true) AS
SELECT
  COALESCE(mt.asset_id, mtr.asset_id) AS asset_id,
  COALESCE(mt.period_month, mtr.period_month) AS period_month,
  CASE
    WHEN mt.mtbf_hours IS NULL OR mtr.mttr_hours IS NULL THEN NULL
    WHEN mt.mtbf_hours + mtr.mttr_hours = 0 THEN NULL
    ELSE ROUND((mt.mtbf_hours / (mt.mtbf_hours + mtr.mttr_hours)) * 100, 2)
  END AS availability_pct
FROM kpi_mtbf mt
FULL JOIN kpi_mttr mtr ON mt.asset_id = mtr.asset_id AND mt.period_month = mtr.period_month;

COMMENT ON VIEW kpi_availability IS
  'Availability % = MTBF / (MTBF + MTTR) × 100 — por asset y mes';

COMMENT ON COLUMN kpi_availability.asset_id IS
  'ID del activo (text)';
COMMENT ON COLUMN kpi_availability.period_month IS
  'Período mensual (primer día del mes)';
COMMENT ON COLUMN kpi_availability.availability_pct IS
  'Disponibilidad porcentual, redondeada a 2 decimales';

-- -----------------------------------------------------------
-- 4. report_maintenance_history: work_orders + assets
--    Columnas relevantes para el reporte de historial
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW report_maintenance_history WITH (security_invoker = true) AS
SELECT
  wo.id,
  wo.asset_id,
  a.equipment_id,
  a.description AS asset_description,
  wo.wo_type,
  wo.lifecycle_phase,
  wo.description,
  wo.reported_at,
  wo.approved_at,
  wo.planned_start_at,
  wo.actual_start_at,
  wo.completed_at,
  wo.closed_at,
  wo.problem_code,
  wo.cause_code,
  wo.remedy_code,
  wo.failure_class,
  wo.criticality,
  wo.actual_hours,
  wo.assigned_to,
  wo.downtime_hours,
  wo.machine_down_at,
  wo.machine_up_at
FROM work_orders wo
LEFT JOIN assets a ON wo.asset_id = a.id;

COMMENT ON VIEW report_maintenance_history IS
  'Vista consolidada de work_orders + assets para reportes de historial';

-- -----------------------------------------------------------
-- 5. report_labor_hours: labor_records + user_profiles
--    Agrupado por technician, mes y código de actividad
--    Solo registros con end_time no NULL (sesiones completadas)
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW report_labor_hours WITH (security_invoker = true) AS
SELECT
  lr.technician_id,
  up.full_name AS technician_name,
  DATE_TRUNC('month', lr.start_time)::date AS period_month,
  lr.activity_code,
  SUM(lr.hours_worked) AS total_hours,
  COUNT(*) AS record_count
FROM labor_records lr
LEFT JOIN user_profiles up ON lr.technician_id = up.id
WHERE lr.end_time IS NOT NULL
GROUP BY lr.technician_id, up.full_name, DATE_TRUNC('month', lr.start_time), lr.activity_code;

COMMENT ON VIEW report_labor_hours IS
  'Horas de labor agrupadas por técnico, mes y actividad';

-- ============================================================
-- FIN MIGRATION: kpi_views
-- ============================================================
