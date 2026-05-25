-- ============================================================
-- MIGRACIÓN 19: Job Plan Structured — Schema
-- Change: job-plan-structured / Phase 1
-- ============================================================
-- Expande job_plans a nivel Maximo/SAP: labor requirements,
-- safety requirements (PTW/LOTO), asset type filter, task-level
-- checklist linking, y tablas snapshot para WO generadas.
-- ============================================================

-- ============================================================
-- SECCIÓN 1: job_plan_labor
-- ============================================================

DO $$ BEGIN
  CREATE TYPE trade_enum AS ENUM (
    'ELECTRICIAN', 'MECHANIC', 'INSTRUMENTIST',
    'LUBRICATOR', 'HELPER', 'WELDER', 'OPERATOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_plan_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID NOT NULL REFERENCES job_plans(id) ON DELETE CASCADE,
  trade trade_enum NOT NULL,
  estimated_hours NUMERIC NOT NULL CHECK (estimated_hours > 0),
  head_count INT NOT NULL DEFAULT 1 CHECK (head_count > 0),
  hourly_rate NUMERIC DEFAULT 0,
  UNIQUE(job_plan_id, trade)
);

COMMENT ON TABLE job_plan_labor IS
  'Requisitos de mano de obra por plan de trabajo. Define qué oficios, cuántas horas y cuántas personas se necesitan.';

COMMENT ON COLUMN job_plan_labor.trade IS
  'Oficio requerido: ELECTRICIAN, MECHANIC, INSTRUMENTIST, LUBRICATOR, HELPER, WELDER, OPERATOR';

COMMENT ON COLUMN job_plan_labor.estimated_hours IS
  'Horas estimadas por persona por turno';

COMMENT ON COLUMN job_plan_labor.head_count IS
  'Cantidad de personas de este oficio requeridas';

COMMENT ON COLUMN job_plan_labor.hourly_rate IS
  'Tarifa por hora (para cálculo de costo estimado). Default 0 hasta que exista tabla de tarifas.';

CREATE INDEX IF NOT EXISTS idx_jpl_plan ON job_plan_labor(job_plan_id);

-- ============================================================
-- SECCIÓN 2: job_plan_safety
-- ============================================================

DO $$ BEGIN
  CREATE TYPE safety_type_enum AS ENUM (
    'PTW', 'LOTO', 'HOT_WORK', 'CONFINED_SPACE',
    'HEIGHTS', 'EPP_ESPECIALIZADO', 'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS job_plan_safety (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_plan_id UUID NOT NULL REFERENCES job_plans(id) ON DELETE CASCADE,
  safety_type safety_type_enum NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN DEFAULT true,
  UNIQUE(job_plan_id, safety_type)
);

COMMENT ON TABLE job_plan_safety IS
  'Requisitos de seguridad por plan de trabajo: permisos, LOTO, EPP especializado. Se clona a work_order_safety_requirements al generar WO.';

COMMENT ON COLUMN job_plan_safety.safety_type IS
  'Tipo de seguridad: PTW (Permiso de Trabajo), LOTO (Bloqueo/Etiquetado), HOT_WORK, CONFINED_SPACE, HEIGHTS, EPP_ESPECIALIZADO, OTRO';

COMMENT ON COLUMN job_plan_safety.description IS
  'Descripción del requisito de seguridad (ej: "LOTO en bomba centrífuga M-PACK-017")';

COMMENT ON COLUMN job_plan_safety.is_mandatory IS
  'TRUE = bloquea la WO si no está cumplido. FALSE = recomendado.';

CREATE INDEX IF NOT EXISTS idx_jps_plan ON job_plan_safety(job_plan_id);

-- ============================================================
-- SECCIÓN 3: ALTER job_plans
-- ============================================================

ALTER TABLE job_plans
  ADD COLUMN IF NOT EXISTS asset_type_id TEXT REFERENCES asset_types(id);

ALTER TABLE job_plans
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE job_plans
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

COMMENT ON COLUMN job_plans.asset_type_id IS
  'Tipo de activo al que aplica este plan (NULL = aplica a cualquier tipo).';

COMMENT ON COLUMN job_plans.is_active IS
  'FALSE = plan desactivado (no se usa en nuevos schedules, los existentes siguen).';

COMMENT ON COLUMN job_plans.updated_at IS
  'Última modificación del plan. Actualizado automáticamente por trigger.';

-- ============================================================
-- SECCIÓN 4: ALTER checklist_templates
-- ============================================================

ALTER TABLE checklist_templates
  ADD COLUMN IF NOT EXISTS job_plan_task_id UUID REFERENCES job_plan_tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN checklist_templates.job_plan_task_id IS
  'Tarea específica del job_plan a la que aplica este checklist (NULL = aplica a todo el plan).';

-- ============================================================
-- SECCIÓN 5: ALTER work_orders (cost columns)
-- ============================================================

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS estimated_parts_cost NUMERIC DEFAULT 0;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS estimated_labor_cost NUMERIC DEFAULT 0;

COMMENT ON COLUMN work_orders.estimated_hours IS
  'Horas totales estimadas (suma de job_plan_labor.estimated_hours × head_count al generar WO).';

COMMENT ON COLUMN work_orders.estimated_parts_cost IS
  'Costo estimado de refacciones (suma de job_plan_materials.planned_qty × unit_cost al generar WO).';

COMMENT ON COLUMN work_orders.estimated_labor_cost IS
  'Costo estimado de mano de obra (suma de horas × tarifa al generar WO).';

-- ============================================================
-- SECCIÓN 6: ALTER checklist_instances status — agregar PENDING
-- ============================================================

ALTER TABLE checklist_instances
  DROP CONSTRAINT IF EXISTS checklist_instances_status_check;

ALTER TABLE checklist_instances
  ADD CONSTRAINT checklist_instances_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'VOID'));

COMMENT ON COLUMN checklist_instances.status IS
  'Estado: PENDING (generado por PM, sin técnico asignado), IN_PROGRESS, COMPLETED, VOID.';

-- ============================================================
-- SECCIÓN 7: ALTER spare_parts — unit_cost
-- ============================================================

ALTER TABLE spare_parts
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC DEFAULT 0;

COMMENT ON COLUMN spare_parts.unit_cost IS
  'Último costo unitario conocido (para estimación de costos en WO). Default 0 hasta integración con Epicor.';

-- ============================================================
-- SECCIÓN 8: work_order_labor_estimates (snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_order_labor_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  job_plan_id UUID REFERENCES job_plans(id),
  trade trade_enum NOT NULL,
  estimated_hours NUMERIC NOT NULL,
  head_count INT DEFAULT 1,
  hourly_rate NUMERIC DEFAULT 0,
  UNIQUE(work_order_id, trade)
);

COMMENT ON TABLE work_order_labor_estimates IS
  'Snapshot de requisitos de mano de obra al generar una WO desde un job_plan. Congelado en el tiempo para auditoría de costos.';

COMMENT ON COLUMN work_order_labor_estimates.work_order_id IS
  'WO para la que se generó este estimado';

COMMENT ON COLUMN work_order_labor_estimates.job_plan_id IS
  'Job plan de origen (referencial — el plan puede cambiar después)';

COMMENT ON COLUMN work_order_labor_estimates.trade IS
  'Oficio requerido (snapshot del valor al generar la WO)';

CREATE INDEX IF NOT EXISTS idx_wole_wo ON work_order_labor_estimates(work_order_id);

-- ============================================================
-- SECCIÓN 9: work_order_safety_requirements (snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS work_order_safety_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  job_plan_id UUID REFERENCES job_plans(id),
  safety_type safety_type_enum NOT NULL,
  description TEXT,
  is_mandatory BOOLEAN DEFAULT true,
  is_fulfilled BOOLEAN DEFAULT false,
  UNIQUE(work_order_id, safety_type)
);

COMMENT ON TABLE work_order_safety_requirements IS
  'Snapshot de requisitos de seguridad al generar WO. is_fulfilled se actualiza cuando se completa el permiso/LOTO correspondiente.';

COMMENT ON COLUMN work_order_safety_requirements.work_order_id IS
  'WO para la que se generó este requisito';

COMMENT ON COLUMN work_order_safety_requirements.safety_type IS
  'Tipo de seguridad requerido (snapshot)';

COMMENT ON COLUMN work_order_safety_requirements.is_fulfilled IS
  'TRUE cuando el permiso/LOTO asociado ha sido completado';

CREATE INDEX IF NOT EXISTS idx_wosr_wo ON work_order_safety_requirements(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wosr_unfulfilled ON work_order_safety_requirements(is_fulfilled)
  WHERE is_fulfilled = false;

-- ============================================================
-- SECCIÓN 10: RLS
-- ============================================================

-- 10.1 job_plan_labor
ALTER TABLE job_plan_labor ENABLE ROW LEVEL SECURITY;

CREATE POLICY jpl_select ON job_plan_labor FOR SELECT TO authenticated USING (
  get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
);
CREATE POLICY jpl_insert ON job_plan_labor FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY jpl_update ON job_plan_labor FOR UPDATE TO authenticated USING (
  get_user_role() IN ('PLANNER', 'ADMIN')
) WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY jpl_delete ON job_plan_labor FOR DELETE TO authenticated USING (
  get_user_role() = 'ADMIN'
);

-- 10.2 job_plan_safety
ALTER TABLE job_plan_safety ENABLE ROW LEVEL SECURITY;

CREATE POLICY jps_select ON job_plan_safety FOR SELECT TO authenticated USING (
  get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
);
CREATE POLICY jps_insert ON job_plan_safety FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY jps_update ON job_plan_safety FOR UPDATE TO authenticated USING (
  get_user_role() IN ('PLANNER', 'ADMIN')
) WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY jps_delete ON job_plan_safety FOR DELETE TO authenticated USING (
  get_user_role() = 'ADMIN'
);

-- 10.3 work_order_labor_estimates
ALTER TABLE work_order_labor_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY wole_select ON work_order_labor_estimates FOR SELECT TO authenticated USING (
  get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
);
CREATE POLICY wole_insert ON work_order_labor_estimates FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY wole_update ON work_order_labor_estimates FOR UPDATE TO authenticated USING (
  get_user_role() IN ('PLANNER', 'ADMIN')
) WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY wole_delete ON work_order_labor_estimates FOR DELETE TO authenticated USING (
  get_user_role() = 'ADMIN'
);

-- 10.4 work_order_safety_requirements
ALTER TABLE work_order_safety_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY wosr_select ON work_order_safety_requirements FOR SELECT TO authenticated USING (
  get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
);
CREATE POLICY wosr_insert ON work_order_safety_requirements FOR INSERT TO authenticated WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY wosr_update ON work_order_safety_requirements FOR UPDATE TO authenticated USING (
  get_user_role() IN ('PLANNER', 'ADMIN')
) WITH CHECK (
  get_user_role() IN ('PLANNER', 'ADMIN')
);
CREATE POLICY wosr_delete ON work_order_safety_requirements FOR DELETE TO authenticated USING (
  get_user_role() = 'ADMIN'
);

-- ============================================================
-- SECCIÓN 11: Audit triggers
-- ============================================================

DROP TRIGGER IF EXISTS work_order_labor_estimates_audit ON work_order_labor_estimates;
CREATE TRIGGER work_order_labor_estimates_audit
  AFTER INSERT OR UPDATE OR DELETE ON work_order_labor_estimates
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS work_order_safety_requirements_audit ON work_order_safety_requirements;
CREATE TRIGGER work_order_safety_requirements_audit
  AFTER INSERT OR UPDATE OR DELETE ON work_order_safety_requirements
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- ============================================================
-- SECCIÓN 12: updated_at trigger en job_plans
-- ============================================================

CREATE OR REPLACE FUNCTION set_job_plan_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_plans_updated_at ON job_plans;
CREATE TRIGGER trg_job_plans_updated_at
  BEFORE UPDATE ON job_plans
  FOR EACH ROW
  EXECUTE FUNCTION set_job_plan_updated_at();

COMMENT ON TRIGGER trg_job_plans_updated_at ON job_plans IS
  'Actualiza updated_at automáticamente al modificar un plan de trabajo';
