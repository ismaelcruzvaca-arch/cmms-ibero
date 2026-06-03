-- ============================================================
-- MIGRATION 13: Labor Records — Time Tracking for Mechanics
-- Change: labor-reporting
-- ============================================================
-- Tabla de registros de labor para control de horas de
-- mecánicos por orden de trabajo. Cada sesión activa tiene
-- end_time=NULL. El cliente (RxDB) crea los registros; el
-- servidor solo valida (NO auto-crea).
-- ============================================================

-- -----------------------------------------------------------
-- 1. Agregar columna actual_hours a work_orders
-- -----------------------------------------------------------
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS actual_hours NUMERIC DEFAULT 0;

COMMENT ON COLUMN work_orders.actual_hours IS
  'Suma total de horas trabajadas (calculada al cerrar la OT vía trg_labor_sum_hours)';

-- -----------------------------------------------------------
-- 2. Tabla labor_records
-- -----------------------------------------------------------
CREATE TABLE labor_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  hours_worked NUMERIC GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
  ) STORED,
  activity_code TEXT NOT NULL CHECK (activity_code IN (
    'DIRECT_WORK', 'WAIT_MATERIAL', 'WAIT_PERMIT', 'TRAVEL', 'BREAK'
  )),
  notes TEXT,
  device_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE labor_records IS
  'Registro de horas laborales del técnico por orden de trabajo';
COMMENT ON COLUMN labor_records.id IS
  'Identificador único del registro de labor';
COMMENT ON COLUMN labor_records.work_order_id IS
  'Orden de trabajo asociada';
COMMENT ON COLUMN labor_records.technician_id IS
  'Técnico que realizó la labor';
COMMENT ON COLUMN labor_records.start_time IS
  'Inicio de la sesión de labor';
COMMENT ON COLUMN labor_records.end_time IS
  'Fin de la sesión (NULL = sesión activa)';
COMMENT ON COLUMN labor_records.hours_worked IS
  'Horas trabajadas (cálculo automático: end_time - start_time en horas)';
COMMENT ON COLUMN labor_records.activity_code IS
  'Código de actividad: DIRECT_WORK, WAIT_MATERIAL, WAIT_PERMIT, TRAVEL, BREAK';
COMMENT ON COLUMN labor_records.notes IS
  'Notas adicionales del técnico';
COMMENT ON COLUMN labor_records.device_timestamp IS
  'Timestamp del dispositivo para reconciliación offline';
COMMENT ON COLUMN labor_records.created_at IS
  'Fecha y hora de creación del registro';
COMMENT ON COLUMN labor_records.updated_at IS
  'Última modificación del registro';

-- -----------------------------------------------------------
-- 3. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_labor_records_wo_tech
  ON labor_records (work_order_id, technician_id);

CREATE INDEX IF NOT EXISTS idx_labor_records_tech_start
  ON labor_records (technician_id, start_time DESC);

-- -----------------------------------------------------------
-- 4. Trigger: updated_at automático
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION set_labor_records_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_labor_records_updated_at ON labor_records;

CREATE TRIGGER trg_labor_records_updated_at
  BEFORE UPDATE ON labor_records
  FOR EACH ROW
  EXECUTE FUNCTION set_labor_records_updated_at();

COMMENT ON TRIGGER trg_labor_records_updated_at ON labor_records IS
  'Actualiza updated_at automáticamente al modificar el registro';

-- -----------------------------------------------------------
-- 5. Trigger: trg_validate_labor_fsm()
--    BEFORE INSERT OR UPDATE ON labor_records
--    Defensivo — valida, NO crea registros
--    Flujo:
--      - INSERT con end_time=NULL: verifica WO en INPRG
--      - UPDATE: verifica pertenencia al técnico (no-admin)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_labor_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_phase lifecycle_phase;
BEGIN
  -- INSERT con end_time=NULL (nueva sesión activa):
  -- verificar que la WO esté en INPRG
  IF TG_OP = 'INSERT' AND NEW.end_time IS NULL THEN
    SELECT lifecycle_phase INTO v_phase
    FROM work_orders
    WHERE id = NEW.work_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La orden de trabajo % no existe', NEW.work_order_id;
    END IF;

    IF v_phase != 'INPRG' THEN
      RAISE EXCEPTION
        'No se puede iniciar sesión: la orden % está en % (debe estar INPRG)',
        NEW.work_order_id, v_phase;
    END IF;
  END IF;

  -- UPDATE: verificar que la sesión pertenece al técnico actual
  -- (solo para no-admins — ADMIN puede modificar cualquier registro)
  IF TG_OP = 'UPDATE' AND get_user_role() != 'ADMIN' THEN
    IF OLD.technician_id != auth.uid() THEN
      RAISE EXCEPTION 'No puede modificar una sesión que no le pertenece';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_labor_fsm ON labor_records;

CREATE TRIGGER trg_validate_labor_fsm
  BEFORE INSERT OR UPDATE ON labor_records
  FOR EACH ROW
  EXECUTE FUNCTION trg_validate_labor_fsm();

COMMENT ON FUNCTION trg_validate_labor_fsm IS
  'Valida que solo se creen sesiones activas para WO en INPRG y que cada técnico solo modifique sus propias sesiones';

-- -----------------------------------------------------------
-- 6. Trigger: trg_labor_sum_hours()
--    BEFORE UPDATE ON work_orders
--    COMP→CLOSED: suma horas trabajadas → work_orders.actual_hours
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_labor_sum_hours()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Solo en transición COMP → CLOSED
  IF OLD.lifecycle_phase = 'COMP' AND NEW.lifecycle_phase = 'CLOSED' THEN
    SELECT COALESCE(SUM(hours_worked), 0)
    INTO NEW.actual_hours
    FROM labor_records
    WHERE work_order_id = OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_labor_sum_hours ON work_orders;

CREATE TRIGGER trg_labor_sum_hours
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.lifecycle_phase IS DISTINCT FROM NEW.lifecycle_phase)
  EXECUTE FUNCTION trg_labor_sum_hours();

COMMENT ON FUNCTION trg_labor_sum_hours IS
  'Acumula horas trabajadas al cerrar OT (COMP→CLOSED)';

-- -----------------------------------------------------------
-- 7. RLS en labor_records
-- -----------------------------------------------------------
ALTER TABLE labor_records ENABLE ROW LEVEL SECURITY;

-- TECHNICIAN: solo sus propios registros
CREATE POLICY labor_records_select_technician ON labor_records
  FOR SELECT
  USING (get_user_role() = 'TECHNICIAN' AND technician_id = auth.uid());

CREATE POLICY labor_records_insert_technician ON labor_records
  FOR INSERT
  WITH CHECK (get_user_role() = 'TECHNICIAN' AND technician_id = auth.uid());

CREATE POLICY labor_records_update_technician ON labor_records
  FOR UPDATE
  USING (get_user_role() = 'TECHNICIAN' AND technician_id = auth.uid())
  WITH CHECK (get_user_role() = 'TECHNICIAN' AND technician_id = auth.uid());

-- PLANNER: SELECT todas
CREATE POLICY labor_records_select_planner ON labor_records
  FOR SELECT
  USING (get_user_role() = 'PLANNER');

-- ADMIN: ALL
CREATE POLICY labor_records_all_admin ON labor_records
  FOR ALL
  USING (get_user_role() = 'ADMIN');
