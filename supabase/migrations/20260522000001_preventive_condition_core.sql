-- ============================================================
-- MIGRATION 5: Preventive & Condition-Based Maintenance — Core Schema
-- Change: preventive-condition-core-phase-1
-- ============================================================
-- Crea 7 tablas para mantenimiento preventivo (PM) y
-- mantenimiento basado en condición (CBM):
--   job_plans → job_plan_tasks, job_plan_materials
--   pm_schedules
--   meters → measure_points, meter_readings
-- Todas con RLS usando get_user_role() existente.
-- ============================================================

-- ============================================================
-- GROUP 1: PM TEMPLATES
-- ============================================================

-- -----------------------------------------------------------
-- 1. job_plans — Plantillas de trabajo preventivo
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  intervention_type TEXT NOT NULL CHECK (intervention_type IN ('INSPECTION', 'LUBRICATION', 'MINOR_SERVICE', 'OVERHAUL')),
  estimated_hours NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.job_plans IS 'Plantillas de trabajo para mantenimiento preventivo';
COMMENT ON COLUMN public.job_plans.code IS 'Código único del plan de trabajo';
COMMENT ON COLUMN public.job_plans.intervention_type IS 'Tipo de intervención: INSPECTION, LUBRICATION, MINOR_SERVICE, OVERHAUL';
COMMENT ON COLUMN public.job_plans.estimated_hours IS 'Horas estimadas de ejecución';

-- -----------------------------------------------------------
-- 2. job_plan_tasks — Tareas secuenciadas de un plan
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID NOT NULL REFERENCES public.job_plans(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL,
  task_description TEXT NOT NULL,
  UNIQUE(job_plan_id, step_sequence)
);

COMMENT ON TABLE public.job_plan_tasks IS 'Tareas individuales que componen un plan de trabajo';
COMMENT ON COLUMN public.job_plan_tasks.step_sequence IS 'Orden de ejecución dentro del plan (único por job_plan)';
COMMENT ON COLUMN public.job_plan_tasks.task_description IS 'Descripción detallada de la tarea';

CREATE INDEX IF NOT EXISTS idx_job_plan_tasks_plan ON public.job_plan_tasks(job_plan_id);

-- -----------------------------------------------------------
-- 3. job_plan_materials — Materiales/refacciones del plan
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_plan_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID NOT NULL REFERENCES public.job_plans(id) ON DELETE CASCADE,
  part_num TEXT,
  planned_qty NUMERIC NOT NULL CHECK (planned_qty > 0)
);

COMMENT ON TABLE public.job_plan_materials IS 'Materiales y refacciones planificados para un job_plan';
COMMENT ON COLUMN public.job_plan_materials.part_num IS 'Número de parte (TEXT sin FK a spare_parts para evitar acoplamiento con Epicor)';
COMMENT ON COLUMN public.job_plan_materials.planned_qty IS 'Cantidad planificada (debe ser > 0)';

CREATE INDEX IF NOT EXISTS idx_job_plan_materials_plan ON public.job_plan_materials(job_plan_id);

-- ============================================================
-- GROUP 2: PM SCHEDULES
-- ============================================================

-- -----------------------------------------------------------
-- 4. pm_schedules — Programación de mantenimiento preventivo
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL REFERENCES public.assets(id),
  job_plan_id UUID NOT NULL REFERENCES public.job_plans(id),
  time_frequency_days INT,
  meter_frequency_value NUMERIC,
  is_floating BOOLEAN DEFAULT false,
  parent_schedule_id UUID REFERENCES public.pm_schedules(id),
  suppression_multiplier INT,
  last_completion_date TIMESTAMPTZ,
  next_target_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.pm_schedules IS 'Programación de mantenimiento preventivo por activo y plan';
COMMENT ON COLUMN public.pm_schedules.time_frequency_days IS 'Frecuencia basada en días calendario (NULL si es por medidor)';
COMMENT ON COLUMN public.pm_schedules.meter_frequency_value IS 'Frecuencia basada en lectura de medidor (NULL si es por tiempo)';
COMMENT ON COLUMN public.pm_schedules.is_floating IS 'TRUE = schedule flotante (se recalcula desde última ejecución)';
COMMENT ON COLUMN public.pm_schedules.parent_schedule_id IS 'Auto-referencia para cadenas de supresión (supersedes)';
COMMENT ON COLUMN public.pm_schedules.suppression_multiplier IS 'Multiplicador para supresión (ej: cada 3 ciclos)';
COMMENT ON COLUMN public.pm_schedules.last_completion_date IS 'Fecha de última ejecución completada';
COMMENT ON COLUMN public.pm_schedules.next_target_date IS 'Próxima fecha objetivo calculada';

CREATE INDEX IF NOT EXISTS idx_pm_schedules_asset ON public.pm_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_job_plan ON public.pm_schedules(job_plan_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_parent ON public.pm_schedules(parent_schedule_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_next_target ON public.pm_schedules(next_target_date);

-- ============================================================
-- GROUP 3: CONDITION MONITORING (CBM)
-- ============================================================

-- -----------------------------------------------------------
-- 5. meters — Medidores asociados a activos
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL REFERENCES public.assets(id),
  code TEXT NOT NULL,
  meter_type TEXT NOT NULL CHECK (meter_type IN ('CONTINUOUS', 'GAUGE', 'CHARACTERISTIC')),
  uom TEXT NOT NULL
);

COMMENT ON TABLE public.meters IS 'Medidores instalados en activos para monitoreo de condición';
COMMENT ON COLUMN public.meters.code IS 'Código del medidor (ej: HOROMETRO, VIBRACION)';
COMMENT ON COLUMN public.meters.meter_type IS 'Tipo: CONTINUOUS (odómetro), GAUGE (lectura puntual), CHARACTERISTIC (cualitativo)';
COMMENT ON COLUMN public.meters.uom IS 'Unidad de medida (horas, km, psi, °C, etc.)';

CREATE INDEX IF NOT EXISTS idx_meters_asset ON public.meters(asset_id);

-- -----------------------------------------------------------
-- 6. measure_points — Puntos de medición con límites
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.measure_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  upper_limit_warning NUMERIC,
  upper_limit_critical NUMERIC,
  lower_limit_warning NUMERIC,
  lower_limit_critical NUMERIC
);

COMMENT ON TABLE public.measure_points IS 'Puntos de medición con límites de alerta y crítico para un medidor';
COMMENT ON COLUMN public.measure_points.upper_limit_warning IS 'Límite superior de advertencia';
COMMENT ON COLUMN public.measure_points.upper_limit_critical IS 'Límite superior crítico (alarma)';
COMMENT ON COLUMN public.measure_points.lower_limit_warning IS 'Límite inferior de advertencia';
COMMENT ON COLUMN public.measure_points.lower_limit_critical IS 'Límite inferior crítico (alarma)';

CREATE INDEX IF NOT EXISTS idx_measure_points_meter ON public.measure_points(meter_id);

-- -----------------------------------------------------------
-- 7. meter_readings — Histórico de lecturas de medidores
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE CASCADE,
  reading_value NUMERIC NOT NULL,
  reading_date TIMESTAMPTZ DEFAULT NOW(),
  is_alert_triggered BOOLEAN DEFAULT false
);

COMMENT ON TABLE public.meter_readings IS 'Histórico de lecturas tomadas de medidores';
COMMENT ON COLUMN public.meter_readings.reading_value IS 'Valor de la lectura';
COMMENT ON COLUMN public.meter_readings.reading_date IS 'Momento en que se tomó la lectura';
COMMENT ON COLUMN public.meter_readings.is_alert_triggered IS 'TRUE si la lectura disparó una alerta de límite';

CREATE INDEX IF NOT EXISTS idx_meter_readings_meter ON public.meter_readings(meter_id);
CREATE INDEX IF NOT EXISTS idx_meter_readings_date ON public.meter_readings(reading_date DESC);

-- ============================================================
-- ROW LEVEL SECURITY — Role-Based Access Control (RBAC)
-- ============================================================
-- Reutiliza get_user_role() definida en Migration 1 (RBAC).
--
-- Grupo 1 — Datos Maestros y Autómata
--   (job_plans, job_plan_tasks, job_plan_materials,
--    pm_schedules, meters, measure_points):
--   SELECT: authenticated (all)
--   INSERT/UPDATE/DELETE: PLANNER, ADMIN
--
-- Grupo 2 — Datos Transaccionales (meter_readings):
--   SELECT: authenticated (all)
--   INSERT: TECHNICIAN, PLANNER, ADMIN
--   UPDATE/DELETE: solo ADMIN (lecturas inmutables)
-- ============================================================

-- -----------------------------------------------------------
-- 1. job_plans
-- -----------------------------------------------------------
ALTER TABLE public.job_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_plans_select ON public.job_plans
  FOR SELECT TO authenticated USING (true);

CREATE POLICY job_plans_insert ON public.job_plans
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plans_update ON public.job_plans
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plans_delete ON public.job_plans
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 2. job_plan_tasks
-- -----------------------------------------------------------
ALTER TABLE public.job_plan_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_plan_tasks_select ON public.job_plan_tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY job_plan_tasks_insert ON public.job_plan_tasks
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_tasks_update ON public.job_plan_tasks
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_tasks_delete ON public.job_plan_tasks
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 3. job_plan_materials
-- -----------------------------------------------------------
ALTER TABLE public.job_plan_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_plan_materials_select ON public.job_plan_materials
  FOR SELECT TO authenticated USING (true);

CREATE POLICY job_plan_materials_insert ON public.job_plan_materials
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_materials_update ON public.job_plan_materials
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_materials_delete ON public.job_plan_materials
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 4. pm_schedules
-- -----------------------------------------------------------
ALTER TABLE public.pm_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY pm_schedules_select ON public.pm_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY pm_schedules_insert ON public.pm_schedules
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY pm_schedules_update ON public.pm_schedules
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY pm_schedules_delete ON public.pm_schedules
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 5. meters
-- -----------------------------------------------------------
ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;

CREATE POLICY meters_select ON public.meters
  FOR SELECT TO authenticated USING (true);

CREATE POLICY meters_insert ON public.meters
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY meters_update ON public.meters
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY meters_delete ON public.meters
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 6. measure_points
-- -----------------------------------------------------------
ALTER TABLE public.measure_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY measure_points_select ON public.measure_points
  FOR SELECT TO authenticated USING (true);

CREATE POLICY measure_points_insert ON public.measure_points
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY measure_points_update ON public.measure_points
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY measure_points_delete ON public.measure_points
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 7. meter_readings — Datos Transaccionales
-- -----------------------------------------------------------
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY meter_readings_select ON public.meter_readings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY meter_readings_insert ON public.meter_readings
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN'));

CREATE POLICY meter_readings_update ON public.meter_readings
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

CREATE POLICY meter_readings_delete ON public.meter_readings
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
