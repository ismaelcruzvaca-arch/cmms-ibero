-- ============================================================
-- MIGRATION 11: pm_due_calendar — Ventana de Proyección PM
-- Change: pm-engine-cron-calendar
-- ============================================================
-- Vista que proyecta las próximas órdenes de trabajo preventivas
-- para el planificador. Cruza pm_schedules, job_plans y assets.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Crear vista pm_due_calendar (idempotente)
-- -----------------------------------------------------------
CREATE OR REPLACE VIEW pm_due_calendar AS
SELECT
  ps.id AS schedule_id,
  ps.asset_id,
  a.equipment_id AS asset_name,
  jp.code AS job_plan_title,
  ps.next_target_date AS projected_date,
  'PM'::text AS wo_type,
  jp.intervention_type,
  ps.time_frequency_days,
  ps.parent_schedule_id,
  CASE
    WHEN ps.next_target_date <= CURRENT_DATE THEN 'OVERDUE'
    ELSE 'PENDING'
  END AS status
FROM pm_schedules ps
JOIN assets a ON a.id = ps.asset_id
JOIN job_plans jp ON jp.id = ps.job_plan_id
WHERE ps.next_target_date IS NOT NULL
ORDER BY ps.next_target_date ASC;

COMMENT ON VIEW pm_due_calendar IS
  'Ventana de proyección PM — Muestra las próximas OTs preventivas ordenadas por fecha de vencimiento.
   Usada por el planificador para visualizar la carga de trabajo PM.';
COMMENT ON COLUMN pm_due_calendar.schedule_id IS 'ID del pm_schedule que originó la proyección';
COMMENT ON COLUMN pm_due_calendar.asset_name IS 'Código del equipo (equipment_id)';
COMMENT ON COLUMN pm_due_calendar.job_plan_title IS 'Código del plan de trabajo (job_plan.code)';
COMMENT ON COLUMN pm_due_calendar.projected_date IS 'Próxima fecha objetivo de ejecución (next_target_date)';
COMMENT ON COLUMN pm_due_calendar.status IS 'OVERDUE si ya venció, PENDING si está vigente';
