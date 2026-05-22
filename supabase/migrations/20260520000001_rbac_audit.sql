-- ============================================================
-- MIGRATION 1: RBAC & Audit Trail
-- Change: core-iso14224
-- ============================================================
-- Crea ENUMs, user_profiles, sync trigger, audit_logs,
-- funciÃ³n de auditorÃ­a genÃ©rica, helper get_user_role(),
-- y RLS en audit_logs.
-- ============================================================

-- -----------------------------------------------------------
-- 1. ENUMs para ISO 14224 lifecycle y block reason
--    (Se crean en Migration 1 porque son necesarios antes
--     de que exista work_orders en Migration 2)
-- -----------------------------------------------------------
CREATE TYPE lifecycle_phase AS ENUM ('WAPPR','APPROVED','INPRG','COMP','CLOSED');
CREATE TYPE block_reason AS ENUM ('NONE','MATERIAL','PLANT_CONDITION','SCHEDULE');

-- -----------------------------------------------------------
-- 2. user_profiles â€” sincronizada desde auth.users
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'TECHNICIAN',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------
-- 3. Trigger function: sync_user_profile()
--    SECURITY DEFINER porque auth.users estÃ¡ en schema auth
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_user_profile()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, role)
  VALUES (NEW.id, 'TECHNICIAN')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 4. Attach trigger a auth.users INSERT
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_profile();

-- -----------------------------------------------------------
-- 5. audit_logs â€” registro inmutable de cambios
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------
-- 6. FunciÃ³n genÃ©rica de auditorÃ­a
--    Reutilizable: usa TG_TABLE_NAME, TG_OP, OLD, NEW
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
BEGIN
  -- Determinar record_id segÃºn la operaciÃ³n
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_record_id := NEW.id;
  ELSE
    v_record_id := OLD.id;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid()
  );

  -- Para AFTER triggers, RETURN no afecta la fila original
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------
-- 7. Attach audit trigger a work_orders (si ya existe)
--    En un bootstrap limpio, work_orders aÃºn no existe
--    (se crea en Migration 2). Si no existe, lo salteamos.
--    Migration 2 re-crea este trigger.
-- -----------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_tables
    WHERE tablename = 'work_orders' AND schemaname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS work_orders_audit ON work_orders;
    CREATE TRIGGER work_orders_audit
      AFTER INSERT OR UPDATE OR DELETE ON work_orders
      FOR EACH ROW
      EXECUTE FUNCTION audit_trigger_func();
  END IF;
END;
$$;

-- -----------------------------------------------------------
-- 8. Helper function: get_user_role()
--    Reutilizada en todas las RLS policies
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

-- -----------------------------------------------------------
-- 9. RLS en audit_logs
--    INSERT permitido via trigger (SECURITY DEFINER)
--    SELECT solo ADMIN
--    Sin UPDATE ni DELETE (inmutables)
-- -----------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_insert_trigger ON audit_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY audit_logs_select_admin ON audit_logs
  FOR SELECT
  USING (get_user_role() = 'ADMIN');
