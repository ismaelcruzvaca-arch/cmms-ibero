-- ============================================================
-- MIGRATION 5b: Fix RLS policies for Preventive & Condition-Based Maintenance
-- Change: preventive-condition-core-phase-1
-- ============================================================
-- Reemplaza las políticas abiertas (SELECT+INSERT para todos los
-- authenticated) con políticas basadas en roles RBAC, alineadas
-- con la arquitectura existente (get_user_role()).
--
-- Grupo 1 — Datos Maestros y Autómata (job_plans, job_plan_tasks,
--   job_plan_materials, pm_schedules, meters, measure_points):
--   SELECT: todos los authenticated
--   INSERT/UPDATE/DELETE: solo PLANNER y ADMIN
--
-- Grupo 2 — Datos Transaccionales (meter_readings):
--   SELECT: todos los authenticated
--   INSERT: TECHNICIAN, PLANNER, ADMIN
--   UPDATE/DELETE: solo ADMIN (lecturas inmutables operativamente)
-- ============================================================

-- ============================================================
-- GROUP 1: PM TEMPLATES
-- ============================================================

-- -----------------------------------------------------------
-- job_plans — Plantillas de trabajo preventivo
-- -----------------------------------------------------------
DROP POLICY IF EXISTS job_plans_select_auth ON public.job_plans;
DROP POLICY IF EXISTS job_plans_insert_auth ON public.job_plans;
DROP POLICY IF EXISTS job_plans_update_auth ON public.job_plans;
DROP POLICY IF EXISTS job_plans_delete_auth ON public.job_plans;
DROP POLICY IF EXISTS job_plans_select ON public.job_plans;
DROP POLICY IF EXISTS job_plans_insert ON public.job_plans;
DROP POLICY IF EXISTS job_plans_update ON public.job_plans;
DROP POLICY IF EXISTS job_plans_delete ON public.job_plans;

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
-- job_plan_tasks — Tareas secuenciadas de un plan
-- -----------------------------------------------------------
DROP POLICY IF EXISTS job_plan_tasks_select_auth ON public.job_plan_tasks;
DROP POLICY IF EXISTS job_plan_tasks_insert_auth ON public.job_plan_tasks;
DROP POLICY IF EXISTS job_plan_tasks_select ON public.job_plan_tasks;
DROP POLICY IF EXISTS job_plan_tasks_insert ON public.job_plan_tasks;
DROP POLICY IF EXISTS job_plan_tasks_update ON public.job_plan_tasks;
DROP POLICY IF EXISTS job_plan_tasks_delete ON public.job_plan_tasks;

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
-- job_plan_materials — Materiales/refacciones del plan
-- -----------------------------------------------------------
DROP POLICY IF EXISTS job_plan_materials_select_auth ON public.job_plan_materials;
DROP POLICY IF EXISTS job_plan_materials_insert_auth ON public.job_plan_materials;
DROP POLICY IF EXISTS job_plan_materials_select ON public.job_plan_materials;
DROP POLICY IF EXISTS job_plan_materials_insert ON public.job_plan_materials;
DROP POLICY IF EXISTS job_plan_materials_update ON public.job_plan_materials;
DROP POLICY IF EXISTS job_plan_materials_delete ON public.job_plan_materials;

CREATE POLICY job_plan_materials_select ON public.job_plan_materials
  FOR SELECT TO authenticated USING (true);

CREATE POLICY job_plan_materials_insert ON public.job_plan_materials
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_materials_update ON public.job_plan_materials
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY job_plan_materials_delete ON public.job_plan_materials
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- GROUP 2: PM SCHEDULES
-- ============================================================

-- -----------------------------------------------------------
-- pm_schedules — Programación de mantenimiento preventivo
-- -----------------------------------------------------------
DROP POLICY IF EXISTS pm_schedules_select_auth ON public.pm_schedules;
DROP POLICY IF EXISTS pm_schedules_insert_auth ON public.pm_schedules;
DROP POLICY IF EXISTS pm_schedules_select ON public.pm_schedules;
DROP POLICY IF EXISTS pm_schedules_insert ON public.pm_schedules;
DROP POLICY IF EXISTS pm_schedules_update ON public.pm_schedules;
DROP POLICY IF EXISTS pm_schedules_delete ON public.pm_schedules;

CREATE POLICY pm_schedules_select ON public.pm_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY pm_schedules_insert ON public.pm_schedules
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY pm_schedules_update ON public.pm_schedules
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY pm_schedules_delete ON public.pm_schedules
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- GROUP 3: CONDITION MONITORING (CBM) — Datos Maestros
-- ============================================================

-- -----------------------------------------------------------
-- meters — Medidores asociados a activos
-- -----------------------------------------------------------
DROP POLICY IF EXISTS meters_select_auth ON public.meters;
DROP POLICY IF EXISTS meters_insert_auth ON public.meters;
DROP POLICY IF EXISTS meters_select ON public.meters;
DROP POLICY IF EXISTS meters_insert ON public.meters;
DROP POLICY IF EXISTS meters_update ON public.meters;
DROP POLICY IF EXISTS meters_delete ON public.meters;

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
-- measure_points — Puntos de medición con límites
-- -----------------------------------------------------------
DROP POLICY IF EXISTS measure_points_select_auth ON public.measure_points;
DROP POLICY IF EXISTS measure_points_insert_auth ON public.measure_points;
DROP POLICY IF EXISTS measure_points_select ON public.measure_points;
DROP POLICY IF EXISTS measure_points_insert ON public.measure_points;
DROP POLICY IF EXISTS measure_points_update ON public.measure_points;
DROP POLICY IF EXISTS measure_points_delete ON public.measure_points;

CREATE POLICY measure_points_select ON public.measure_points
  FOR SELECT TO authenticated USING (true);

CREATE POLICY measure_points_insert ON public.measure_points
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY measure_points_update ON public.measure_points
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY measure_points_delete ON public.measure_points
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- GROUP 3b: CONDITION MONITORING — Datos Transaccionales
-- ============================================================

-- -----------------------------------------------------------
-- meter_readings — Histórico de lecturas de medidores
--   INSERT: TECHNICIAN, PLANNER, ADMIN
--   UPDATE/DELETE: solo ADMIN (inmutables operativamente)
-- -----------------------------------------------------------
DROP POLICY IF EXISTS meter_readings_select_auth ON public.meter_readings;
DROP POLICY IF EXISTS meter_readings_insert_auth ON public.meter_readings;
DROP POLICY IF EXISTS meter_readings_select ON public.meter_readings;
DROP POLICY IF EXISTS meter_readings_insert ON public.meter_readings;
DROP POLICY IF EXISTS meter_readings_update ON public.meter_readings;
DROP POLICY IF EXISTS meter_readings_delete ON public.meter_readings;

CREATE POLICY meter_readings_select ON public.meter_readings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY meter_readings_insert ON public.meter_readings
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN'));

CREATE POLICY meter_readings_update ON public.meter_readings
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

CREATE POLICY meter_readings_delete ON public.meter_readings
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
