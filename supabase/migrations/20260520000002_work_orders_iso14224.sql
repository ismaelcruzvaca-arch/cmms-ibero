-- ============================================================
-- MIGRATION 2: work_orders ISO 14224
-- Change: core-iso14224
-- ============================================================
-- DROP + CREATE work_orders con schema ISO 14224.
-- FSM trigger, re-attach audit trigger, RLS policies.
-- ============================================================

-- -----------------------------------------------------------
-- 1. DROP old work_orders CASCADE
--    Elimina triggers, policies y la tabla anterior
-- -----------------------------------------------------------
DROP TABLE IF EXISTS work_orders CASCADE;

-- -----------------------------------------------------------
-- 2. CREATE new work_orders (ISO 14224 schema)
-- -----------------------------------------------------------
CREATE TABLE work_orders (
  -- IdentificaciÃ³n
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES assets(id),
  equipment_id VARCHAR NOT NULL,
  wo_type TEXT NOT NULL DEFAULT 'corrective',

  -- Lifecycle ISO 14224
  lifecycle_phase lifecycle_phase NOT NULL DEFAULT 'WAPPR',
  block_reason block_reason NOT NULL DEFAULT 'NONE',

  -- Timestamps operativos (todos TIMESTAMPTZ, nullable)
  reported_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  planned_start_at TIMESTAMPTZ,
  actual_start_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  machine_down_at TIMESTAMPTZ,
  machine_up_at TIMESTAMPTZ,

  -- TaxonomÃ­a de fallas ISO 14224
  failure_class VARCHAR,
  problem_code VARCHAR,
  cause_code VARCHAR,
  remedy_code VARCHAR,

  -- Contexto operacional
  criticality VARCHAR,
  asset_class VARCHAR,
  part_in_process VARCHAR,

  -- Notas estructuradas
  symptom_note TEXT,
  cause_note TEXT,
  action_note TEXT,

  -- PlanificaciÃ³n
  planned_hours NUMERIC DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------
-- 3. FSM trigger: validate_lifecycle_fsm()
--    BEFORE UPDATE FOR EACH ROW
--    Transiciones lineales forward-only:
--      WAPPR â†’ APPROVED â†’ INPRG â†’ COMP â†’ CLOSED
--    block_reason NO es parte del FSM (puede cambiarse libremente)
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_lifecycle_fsm()
RETURNS TRIGGER
AS $$
BEGIN
  -- Permitir si lifecycle_phase no cambiÃ³
  IF OLD.lifecycle_phase IS NOT DISTINCT FROM NEW.lifecycle_phase THEN
    RETURN NEW;
  END IF;

  -- Validar transiciones forward-only
  IF OLD.lifecycle_phase = 'WAPPR' AND NEW.lifecycle_phase = 'APPROVED' THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle_phase = 'APPROVED' AND NEW.lifecycle_phase = 'INPRG' THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle_phase = 'INPRG' AND NEW.lifecycle_phase = 'COMP' THEN
    RETURN NEW;
  END IF;

  IF OLD.lifecycle_phase = 'COMP' AND NEW.lifecycle_phase = 'CLOSED' THEN
    RETURN NEW;
  END IF;

  -- Cualquier otra transiciÃ³n es invÃ¡lida
  RAISE EXCEPTION 'Invalid lifecycle transition: % â†’ %', OLD.lifecycle_phase, NEW.lifecycle_phase;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_orders_fsm
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.lifecycle_phase IS DISTINCT FROM NEW.lifecycle_phase)
  EXECUTE FUNCTION validate_lifecycle_fsm();

-- -----------------------------------------------------------
-- 4. Re-attach audit trigger (fue dropped por CASCADE)
-- -----------------------------------------------------------
CREATE TRIGGER work_orders_audit
  AFTER INSERT OR UPDATE OR DELETE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 5. RLS en work_orders
-- -----------------------------------------------------------
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

-- ADMIN: ALL
CREATE POLICY work_orders_all_admin ON work_orders
  FOR ALL
  USING (get_user_role() = 'ADMIN');

-- PLANNER: ALL
CREATE POLICY work_orders_all_planner ON work_orders
  FOR ALL
  USING (get_user_role() = 'PLANNER');

-- TECHNICIAN: SELECT sus propias Ã³rdenes
CREATE POLICY work_orders_select_technician ON work_orders
  FOR SELECT
  USING (get_user_role() = 'TECHNICIAN' AND auth.uid() = created_by);

-- TECHNICIAN: UPDATE campos limitados en sus propias Ã³rdenes
CREATE POLICY work_orders_update_technician ON work_orders
  FOR UPDATE
  USING (get_user_role() = 'TECHNICIAN' AND auth.uid() = created_by)
  WITH CHECK (get_user_role() = 'TECHNICIAN' AND auth.uid() = created_by);

-- STOREKEEPER: SELECT
CREATE POLICY work_orders_select_storekeeper ON work_orders
  FOR SELECT
  USING (get_user_role() = 'STOREKEEPER');

-- -----------------------------------------------------------
-- 6. Column-level permissions for TECHNICIAN
--    Combinado con RLS: solo actualizan estos campos
--    en sus propias Ã³rdenes de trabajo
-- -----------------------------------------------------------
GRANT UPDATE (
  lifecycle_phase,
  action_note,
  cause_note,
  actual_start_at,
  completed_at,
  machine_down_at,
  machine_up_at
) ON work_orders TO authenticated;

-- -----------------------------------------------------------
-- 7. RLS en assets
--    ADMIN: ALL, otros roles: SELECT
-- -----------------------------------------------------------
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_all_admin ON assets
  FOR ALL
  USING (get_user_role() = 'ADMIN');

CREATE POLICY assets_select_others ON assets
  FOR SELECT
  USING (get_user_role() IN ('PLANNER', 'TECHNICIAN', 'STOREKEEPER'));
