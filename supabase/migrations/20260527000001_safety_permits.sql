-- ============================================================
-- MIGRATION 14: Safety & Permits — PTW + LOTO
-- Change: safety-permits
-- ============================================================
-- Sistema de Permisos de Trabajo (PTW) y Bloqueo/Etiquetado
-- (LOTO). Sigue la filosofía Client-Driven: el servidor
-- valida, NUNCA crea registros automáticamente.
-- ============================================================

-- ============================================================
-- SECTION 1: ENUMs
-- ============================================================

CREATE TYPE permit_status AS ENUM (
  'REQUESTED', 'APPROVED', 'ACTIVE', 'COMPLETED',
  'REJECTED', 'CANCELLED', 'EXPIRED'
);

COMMENT ON TYPE permit_status IS
  'Estados del permiso de trabajo: REQUESTED (solicitado), APPROVED (aprobado), ACTIVE (activo), COMPLETED (completado), REJECTED (rechazado), CANCELLED (cancelado), EXPIRED (vencido)';

CREATE TYPE loto_status AS ENUM (
  'PLANNED', 'LOCKED', 'VERIFIED', 'REMOVED'
);

COMMENT ON TYPE loto_status IS
  'Estados del procedimiento LOTO: PLANNED (planificado), LOCKED (bloqueado), VERIFIED (verificado), REMOVED (retirado)';

CREATE TYPE device_type AS ENUM (
  'LOCK', 'TAG', 'HASPS', 'CHAIN'
);

COMMENT ON TYPE device_type IS
  'Tipo de dispositivo LOTO: LOCK (candado), TAG (etiqueta), HASPS (haspa), CHAIN (cadena)';

-- ============================================================
-- SECTION 2: Agregar rol SAFETY_OFFICER a user_profiles
-- ============================================================

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('TECHNICIAN','PLANNER','ADMIN','STOREKEEPER','SAFETY_OFFICER'));

COMMENT ON CONSTRAINT user_profiles_role_check ON user_profiles IS
  'Roles del sistema: TECHNICIAN (técnico), PLANNER (planificador), ADMIN (administrador), STOREKEEPER (almacenista), SAFETY_OFFICER (oficial de seguridad)';

-- ============================================================
-- SECTION 3: Tablas
-- ============================================================

-- -----------------------------------------------------------
-- 3.1 permit_types — Catálogo de tipos de permiso
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permit_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  requires_isolation BOOLEAN NOT NULL DEFAULT false,
  requires_gas_test BOOLEAN NOT NULL DEFAULT false,
  validity_hours INT NOT NULL DEFAULT 8 CHECK (validity_hours > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.permit_types IS
  'Catálogo de tipos de permiso de trabajo (ex: HOT_WORK, CONFINED_SPACE)';
COMMENT ON COLUMN public.permit_types.id IS
  'Identificador único del tipo de permiso';
COMMENT ON COLUMN public.permit_types.code IS
  'Código único del tipo de permiso (ej: HOT_WORK)';
COMMENT ON COLUMN public.permit_types.name IS
  'Nombre descriptivo del tipo de permiso';
COMMENT ON COLUMN public.permit_types.description IS
  'Descripción detallada del tipo de permiso';
COMMENT ON COLUMN public.permit_types.requires_isolation IS
  'Indica si el permiso requiere aislamiento de energía (LOTO)';
COMMENT ON COLUMN public.permit_types.requires_gas_test IS
  'Indica si el permiso requiere prueba de gas antes de activarse';
COMMENT ON COLUMN public.permit_types.validity_hours IS
  'Horas de validez del permiso desde su activación (debe ser > 0)';
COMMENT ON COLUMN public.permit_types.created_at IS
  'Fecha y hora de creación del registro';

CREATE INDEX IF NOT EXISTS idx_permit_types_code ON public.permit_types(code);

-- -----------------------------------------------------------
-- 3.2 work_permits — Permisos de trabajo
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_type_id UUID NOT NULL REFERENCES public.permit_types(id),
  work_order_id TEXT REFERENCES public.work_orders(id),
  asset_id TEXT REFERENCES public.assets(id),
  permit_status permit_status NOT NULL DEFAULT 'REQUESTED',
  requested_by UUID NOT NULL REFERENCES public.user_profiles(id),
  approved_by UUID REFERENCES public.user_profiles(id),
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  isolation_required BOOLEAN NOT NULL DEFAULT false,
  gas_test_required BOOLEAN NOT NULL DEFAULT false,
  gas_test_result TEXT CHECK (gas_test_result IN ('PASS','FAIL') OR gas_test_result IS NULL),
  description TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_expires_after_issued CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at > issued_at)
);

COMMENT ON TABLE public.work_permits IS
  'Permisos de trabajo para tareas de alto riesgo. Cada permiso sigue un ciclo REQUESTED → APPROVED → ACTIVE → COMPLETED, con transiciones alternativas a REJECTED, CANCELLED o EXPIRED';
COMMENT ON COLUMN public.work_permits.id IS
  'Identificador único del permiso de trabajo';
COMMENT ON COLUMN public.work_permits.permit_type_id IS
  'Tipo de permiso (FK a permit_types)';
COMMENT ON COLUMN public.work_permits.work_order_id IS
  'Orden de trabajo asociada (FK referencial, NO restrictiva)';
COMMENT ON COLUMN public.work_permits.asset_id IS
  'Activo asociado al permiso';
COMMENT ON COLUMN public.work_permits.permit_status IS
  'Estado actual del permiso dentro del ciclo de vida (FSM)';
COMMENT ON COLUMN public.work_permits.requested_by IS
  'Usuario que solicita el permiso (FK a user_profiles)';
COMMENT ON COLUMN public.work_permits.approved_by IS
  'Usuario que aprueba/rechaza el permiso (FK a user_profiles, NULL hasta aprobación)';
COMMENT ON COLUMN public.work_permits.issued_at IS
  'Momento en que el permiso se activó (set por trigger en APPROVED→ACTIVE)';
COMMENT ON COLUMN public.work_permits.expires_at IS
  'Momento de vencimiento del permiso (calculado por trigger desde validity_hours)';
COMMENT ON COLUMN public.work_permits.completed_at IS
  'Momento en que el permiso se completó (set por trigger en ACTIVE→COMPLETED)';
COMMENT ON COLUMN public.work_permits.isolation_required IS
  'Indica si el permiso requiere procedimiento LOTO';
COMMENT ON COLUMN public.work_permits.gas_test_required IS
  'Indica si el permiso requiere prueba de gas antes de activarse';
COMMENT ON COLUMN public.work_permits.gas_test_result IS
  'Resultado de la prueba de gas: PASS (aprobado), FAIL (falló) o NULL (pendiente)';
COMMENT ON COLUMN public.work_permits.description IS
  'Descripción detallada del trabajo a realizar';
COMMENT ON COLUMN public.work_permits.location IS
  'Ubicación física donde se realizará el trabajo';
COMMENT ON COLUMN public.work_permits.created_at IS
  'Fecha y hora de creación del permiso';
COMMENT ON COLUMN public.work_permits.updated_at IS
  'Última modificación del permiso';

CREATE INDEX IF NOT EXISTS idx_work_permits_permit_type ON public.work_permits(permit_type_id);
CREATE INDEX IF NOT EXISTS idx_work_permits_work_order ON public.work_permits(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_permits_asset ON public.work_permits(asset_id);
CREATE INDEX IF NOT EXISTS idx_work_permits_requested_by ON public.work_permits(requested_by);
CREATE INDEX IF NOT EXISTS idx_work_permits_approved_by ON public.work_permits(approved_by);
CREATE INDEX IF NOT EXISTS idx_work_permits_status ON public.work_permits(permit_status);

-- -----------------------------------------------------------
-- 3.3 permit_tasks — Tareas y precauciones del permiso
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permit_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID NOT NULL REFERENCES public.work_permits(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL CHECK (step_sequence > 0),
  task_description TEXT NOT NULL,
  is_precaution BOOLEAN NOT NULL DEFAULT false,
  completed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(work_permit_id, step_sequence)
);

COMMENT ON TABLE public.permit_tasks IS
  'Tareas y precauciones asociadas a un permiso de trabajo. Se eliminan en cascada si se borra el permiso';
COMMENT ON COLUMN public.permit_tasks.id IS
  'Identificador único de la tarea';
COMMENT ON COLUMN public.permit_tasks.work_permit_id IS
  'Permiso de trabajo al que pertenece la tarea (FK con DELETE CASCADE)';
COMMENT ON COLUMN public.permit_tasks.step_sequence IS
  'Orden de la tarea dentro del permiso (único por permiso, debe ser > 0)';
COMMENT ON COLUMN public.permit_tasks.task_description IS
  'Descripción detallada de la tarea o precaución';
COMMENT ON COLUMN public.permit_tasks.is_precaution IS
  'TRUE si es una precaución de seguridad, FALSE si es una tarea operativa';
COMMENT ON COLUMN public.permit_tasks.completed IS
  'TRUE si la tarea ha sido completada';

CREATE INDEX IF NOT EXISTS idx_permit_tasks_work_permit ON public.permit_tasks(work_permit_id);

-- -----------------------------------------------------------
-- 3.4 lockout_tagout — Procedimientos de bloqueo/etiquetado
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lockout_tagout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID REFERENCES public.work_permits(id),
  work_order_id TEXT REFERENCES public.work_orders(id),
  asset_id TEXT NOT NULL REFERENCES public.assets(id),
  loto_status loto_status NOT NULL DEFAULT 'PLANNED',
  description TEXT NOT NULL,
  locked_by UUID NOT NULL REFERENCES public.user_profiles(id),
  locked_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.user_profiles(id),
  verified_at TIMESTAMPTZ,
  removed_by UUID REFERENCES public.user_profiles(id),
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_verified_after_locked CHECK (verified_at IS NULL OR locked_at IS NULL OR verified_at >= locked_at),
  CONSTRAINT chk_removed_after_verified CHECK (removed_at IS NULL OR verified_at IS NULL OR removed_at >= verified_at)
);

COMMENT ON TABLE public.lockout_tagout IS
  'Procedimientos de bloqueo y etiquetado (LOTO) para aislamiento de energía. Sigue el ciclo PLANNED → LOCKED → VERIFIED → REMOVED';
COMMENT ON COLUMN public.lockout_tagout.id IS
  'Identificador único del procedimiento LOTO';
COMMENT ON COLUMN public.lockout_tagout.work_permit_id IS
  'Permiso de trabajo asociado (opcional)';
COMMENT ON COLUMN public.lockout_tagout.work_order_id IS
  'Orden de trabajo asociada (opcional, FK referencial)';
COMMENT ON COLUMN public.lockout_tagout.asset_id IS
  'Activo sobre el que se aplica el aislamiento';
COMMENT ON COLUMN public.lockout_tagout.loto_status IS
  'Estado del procedimiento LOTO dentro del ciclo de vida (FSM)';
COMMENT ON COLUMN public.lockout_tagout.description IS
  'Descripción del procedimiento de aislamiento';
COMMENT ON COLUMN public.lockout_tagout.locked_by IS
  'Usuario que aplicó el bloqueo (FK a user_profiles)';
COMMENT ON COLUMN public.lockout_tagout.locked_at IS
  'Momento en que se aplicó el bloqueo (set por trigger en PLANNED→LOCKED)';
COMMENT ON COLUMN public.lockout_tagout.verified_by IS
  'Usuario que verificó el bloqueo (FK, debe ser distinto de locked_by — regla de dos personas)';
COMMENT ON COLUMN public.lockout_tagout.verified_at IS
  'Momento de la verificación (set por trigger en LOCKED→VERIFIED)';
COMMENT ON COLUMN public.lockout_tagout.removed_by IS
  'Usuario que retiró el bloqueo (FK a user_profiles)';
COMMENT ON COLUMN public.lockout_tagout.removed_at IS
  'Momento en que se retiró el bloqueo (set por trigger en VERIFIED→REMOVED)';
COMMENT ON COLUMN public.lockout_tagout.created_at IS
  'Fecha y hora de creación del procedimiento';
COMMENT ON COLUMN public.lockout_tagout.updated_at IS
  'Última modificación del procedimiento';

CREATE INDEX IF NOT EXISTS idx_lockout_tagout_work_permit ON public.lockout_tagout(work_permit_id);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_work_order ON public.lockout_tagout(work_order_id);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_asset ON public.lockout_tagout(asset_id);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_locked_by ON public.lockout_tagout(locked_by);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_verified_by ON public.lockout_tagout(verified_by);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_removed_by ON public.lockout_tagout(removed_by);
CREATE INDEX IF NOT EXISTS idx_lockout_tagout_status ON public.lockout_tagout(loto_status);

-- -----------------------------------------------------------
-- 3.5 tagout_devices — Dispositivos físicos del LOTO
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tagout_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lockout_tagout_id UUID NOT NULL REFERENCES public.lockout_tagout(id) ON DELETE CASCADE,
  device_type device_type NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.tagout_devices IS
  'Dispositivos físicos (candados, etiquetas, haspas, cadenas) utilizados en un procedimiento LOTO. Se eliminan en cascada si se borra el procedimiento';
COMMENT ON COLUMN public.tagout_devices.id IS
  'Identificador único del dispositivo';
COMMENT ON COLUMN public.tagout_devices.lockout_tagout_id IS
  'Procedimiento LOTO al que pertenece el dispositivo (FK con DELETE CASCADE)';
COMMENT ON COLUMN public.tagout_devices.device_type IS
  'Tipo de dispositivo: LOCK (candado), TAG (etiqueta), HASPS (haspa), CHAIN (cadena)';
COMMENT ON COLUMN public.tagout_devices.device_id IS
  'Identificador físico del dispositivo (ej: número de serie)';
COMMENT ON COLUMN public.tagout_devices.device_label IS
  'Etiqueta descriptiva del dispositivo';
COMMENT ON COLUMN public.tagout_devices.created_at IS
  'Fecha y hora de registro del dispositivo';

CREATE INDEX IF NOT EXISTS idx_tagout_devices_loto ON public.tagout_devices(lockout_tagout_id);

-- ============================================================
-- SECTION 4: Triggers de updated_at
-- ============================================================

-- -----------------------------------------------------------
-- 4.1 Función genérica de updated_at para safety
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_safety_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------
-- 4.2 Trigger updated_at en work_permits
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_work_permits_updated_at ON public.work_permits;

CREATE TRIGGER trg_work_permits_updated_at
  BEFORE UPDATE ON public.work_permits
  FOR EACH ROW
  EXECUTE FUNCTION public.set_safety_updated_at();

COMMENT ON TRIGGER trg_work_permits_updated_at ON public.work_permits IS
  'Actualiza updated_at automáticamente al modificar el permiso';

-- -----------------------------------------------------------
-- 4.3 Trigger updated_at en lockout_tagout
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_lockout_tagout_updated_at ON public.lockout_tagout;

CREATE TRIGGER trg_lockout_tagout_updated_at
  BEFORE UPDATE ON public.lockout_tagout
  FOR EACH ROW
  EXECUTE FUNCTION public.set_safety_updated_at();

COMMENT ON TRIGGER trg_lockout_tagout_updated_at ON public.lockout_tagout IS
  'Actualiza updated_at automáticamente al modificar el procedimiento LOTO';

-- ============================================================
-- SECTION 5: FSM Triggers
-- ============================================================

-- -----------------------------------------------------------
-- 5.1 Auto-expiry: trg_permit_auto_expiry
--   Se ejecuta ANTES del FSM. Solo actúa cuando el usuario NO
--   está cambiando el estado explícitamente. Si el permiso está
--   ACTIVE y vencido, lo pasa a EXPIRED.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_permit_auto_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Solo auto-expirar si el estado no está siendo cambiado explícitamente
  IF OLD.permit_status = 'ACTIVE'
     AND NEW.permit_status = OLD.permit_status
     AND NOW() > OLD.expires_at
  THEN
    NEW.permit_status := 'EXPIRED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_permit_auto_expiry ON public.work_permits;

CREATE TRIGGER trg_permit_auto_expiry
  BEFORE UPDATE ON public.work_permits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_permit_auto_expiry();

COMMENT ON FUNCTION public.fn_permit_auto_expiry IS
  'Auto-expira permisos ACTIVE cuya fecha de vencimiento ya pasó. Solo actúa si el usuario no está cambiando el status explícitamente';
COMMENT ON TRIGGER trg_permit_auto_expiry ON public.work_permits IS
  'Dispara auto-expiry de permisos ACTIVE vencidos antes de cualquier otra validación FSM';

-- -----------------------------------------------------------
-- 5.2 PTW FSM: trg_validate_permit_fsm
--   Ciclo: REQUESTED → APPROVED → ACTIVE → COMPLETED
--   Alternativas: REQUESTED → REJECTED|CANCELLED
--                 APPROVED → CANCELLED|EXPIRED
--                 ACTIVE → EXPIRED
--   Gas test gate: APPROVED→ACTIVE requiere gas_test_result='PASS'
--   Set automático: issued_at, expires_at, completed_at
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_permit_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_validity INT;
BEGIN
  -- Si el estado no cambió, no hay nada que validar
  IF OLD.permit_status = NEW.permit_status THEN
    RETURN NEW;
  END IF;

  -- Validar transiciones permitidas
  CASE
    -- REQUESTED → APPROVED: requiere approved_by
    WHEN OLD.permit_status = 'REQUESTED' AND NEW.permit_status = 'APPROVED' THEN
      IF NEW.approved_by IS NULL THEN
        RAISE EXCEPTION 'No se puede aprobar el permiso: se requiere un aprobador (approved_by)';
      END IF;

    -- REQUESTED → REJECTED
    WHEN OLD.permit_status = 'REQUESTED' AND NEW.permit_status = 'REJECTED' THEN
      IF NEW.approved_by IS NULL THEN
        RAISE EXCEPTION 'No se puede rechazar el permiso: se requiere un aprobador (approved_by)';
      END IF;

    -- REQUESTED → CANCELLED
    WHEN OLD.permit_status = 'REQUESTED' AND NEW.permit_status = 'CANCELLED' THEN
      -- Sin validaciones adicionales

    -- APPROVED → ACTIVE: emite el permiso, calcula vencimiento, verifica gas test
    WHEN OLD.permit_status = 'APPROVED' AND NEW.permit_status = 'ACTIVE' THEN
      IF NEW.gas_test_required AND (NEW.gas_test_result IS NULL OR NEW.gas_test_result != 'PASS') THEN
        RAISE EXCEPTION 'No se puede activar el permiso: requiere prueba de gas con resultado PASS';
      END IF;
      NEW.issued_at := NOW();
      SELECT validity_hours INTO v_validity
      FROM public.permit_types
      WHERE id = NEW.permit_type_id;
      NEW.expires_at := NOW() + (v_validity * INTERVAL '1 hour');

    -- APPROVED → CANCELLED
    WHEN OLD.permit_status = 'APPROVED' AND NEW.permit_status = 'CANCELLED' THEN
      -- Sin validaciones adicionales

    -- APPROVED → EXPIRED
    WHEN OLD.permit_status = 'APPROVED' AND NEW.permit_status = 'EXPIRED' THEN
      -- Sin validaciones adicionales

    -- ACTIVE → COMPLETED
    WHEN OLD.permit_status = 'ACTIVE' AND NEW.permit_status = 'COMPLETED' THEN
      NEW.completed_at := NOW();

    -- ACTIVE → EXPIRED
    WHEN OLD.permit_status = 'ACTIVE' AND NEW.permit_status = 'EXPIRED' THEN
      -- Sin validaciones adicionales

    -- Cualquier otra transición: inválida
    ELSE
      RAISE EXCEPTION 'Transición inválida de permiso: de % a %', OLD.permit_status, NEW.permit_status;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_permit_fsm ON public.work_permits;

CREATE TRIGGER trg_validate_permit_fsm
  BEFORE UPDATE ON public.work_permits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_permit_fsm();

COMMENT ON FUNCTION public.fn_validate_permit_fsm IS
  'Valida las transiciones FSM del permiso de trabajo. Aplica reglas de gas test, asigna fechas de emisión/vencimiento/finalización automáticamente';
COMMENT ON TRIGGER trg_validate_permit_fsm ON public.work_permits IS
  'Trigger FSM que valida y gestiona el ciclo de vida del permiso de trabajo';

-- -----------------------------------------------------------
-- 5.3 LOTO FSM: trg_validate_loto_fsm
--   Ciclo: PLANNED → LOCKED → VERIFIED → REMOVED
--   Forward-only. Regla de dos personas: verified_by != locked_by
--   Set automático: locked_at, verified_at, removed_at
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_loto_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Si el estado no cambió, no hay nada que validar
  IF OLD.loto_status = NEW.loto_status THEN
    RETURN NEW;
  END IF;

  -- Validar transiciones permitidas
  CASE
    -- PLANNED → LOCKED
    WHEN OLD.loto_status = 'PLANNED' AND NEW.loto_status = 'LOCKED' THEN
      NEW.locked_at := NOW();

    -- LOCKED → VERIFIED: regla de dos personas
    WHEN OLD.loto_status = 'LOCKED' AND NEW.loto_status = 'VERIFIED' THEN
      IF NEW.verified_by IS NULL THEN
        RAISE EXCEPTION 'No se puede verificar el bloqueo: se requiere un verificador (verified_by)';
      END IF;
      IF NEW.verified_by = NEW.locked_by THEN
        RAISE EXCEPTION 'Regla de dos personas: el verificador debe ser distinto de quien aplicó el bloqueo';
      END IF;
      NEW.verified_at := NOW();

    -- VERIFIED → REMOVED
    WHEN OLD.loto_status = 'VERIFIED' AND NEW.loto_status = 'REMOVED' THEN
      IF NEW.removed_by IS NULL THEN
        RAISE EXCEPTION 'No se puede retirar el bloqueo: se requiere quien lo retira (removed_by)';
      END IF;
      NEW.removed_at := NOW();

    -- Cualquier otra transición: inválida
    ELSE
      RAISE EXCEPTION 'Transición inválida de LOTO: de % a %', OLD.loto_status, NEW.loto_status;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_loto_fsm ON public.lockout_tagout;

CREATE TRIGGER trg_validate_loto_fsm
  BEFORE UPDATE ON public.lockout_tagout
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_loto_fsm();

COMMENT ON FUNCTION public.fn_validate_loto_fsm IS
  'Valida las transiciones FSM del procedimiento LOTO. Aplica la regla de dos personas en LOCKED→VERIFIED y asigna timestamps automáticamente';
COMMENT ON TRIGGER trg_validate_loto_fsm ON public.lockout_tagout IS
  'Trigger FSM que valida y gestiona el ciclo de vida del procedimiento LOTO';

-- ============================================================
-- SECTION 6: Audit Triggers
-- ============================================================
-- Reutiliza audit_trigger_func() definida en Migration 1.
-- Se adjunta a las 5 tablas para trazabilidad completa.
-- ============================================================

-- -----------------------------------------------------------
-- 6.1 permit_types (solo INSERT/UPDATE, sin DELETE por ser catálogo)
--   Nota: catálogos semilla no deberían eliminarse, pero auditamos
--   por si ocurre.
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS permit_types_audit ON public.permit_types;
CREATE TRIGGER permit_types_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.permit_types
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 6.2 work_permits
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS work_permits_audit ON public.work_permits;
CREATE TRIGGER work_permits_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.work_permits
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 6.3 permit_tasks
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS permit_tasks_audit ON public.permit_tasks;
CREATE TRIGGER permit_tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.permit_tasks
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 6.4 lockout_tagout
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS lockout_tagout_audit ON public.lockout_tagout;
CREATE TRIGGER lockout_tagout_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.lockout_tagout
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- -----------------------------------------------------------
-- 6.5 tagout_devices
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS tagout_devices_audit ON public.tagout_devices;
CREATE TRIGGER tagout_devices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tagout_devices
  FOR EACH ROW
  EXECUTE FUNCTION audit_trigger_func();

-- ============================================================
-- SECTION 7: Row Level Security (RLS)
-- ============================================================
-- Matriz de acceso (vía get_user_role()):
--   ADMIN / SAFETY_OFFICER → ALL
--   PLANNER                → SELECT, INSERT, UPDATE (no DELETE)
--   TECHNICIAN             → SELECT
-- ============================================================

-- -----------------------------------------------------------
-- 7.1 permit_types
-- -----------------------------------------------------------
ALTER TABLE public.permit_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY permit_types_select ON public.permit_types
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_types_insert ON public.permit_types
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_types_update ON public.permit_types
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_types_delete ON public.permit_types
  FOR DELETE TO authenticated USING (
    get_user_role() IN ('ADMIN', 'SAFETY_OFFICER')
  );

-- -----------------------------------------------------------
-- 7.2 work_permits
-- -----------------------------------------------------------
ALTER TABLE public.work_permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_permits_select ON public.work_permits
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY work_permits_insert ON public.work_permits
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY work_permits_update ON public.work_permits
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY work_permits_delete ON public.work_permits
  FOR DELETE TO authenticated USING (
    get_user_role() IN ('ADMIN', 'SAFETY_OFFICER')
  );

-- -----------------------------------------------------------
-- 7.3 permit_tasks
-- -----------------------------------------------------------
ALTER TABLE public.permit_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY permit_tasks_select ON public.permit_tasks
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_tasks_insert ON public.permit_tasks
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_tasks_update ON public.permit_tasks
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY permit_tasks_delete ON public.permit_tasks
  FOR DELETE TO authenticated USING (
    get_user_role() IN ('ADMIN', 'SAFETY_OFFICER')
  );

-- -----------------------------------------------------------
-- 7.4 lockout_tagout
-- -----------------------------------------------------------
ALTER TABLE public.lockout_tagout ENABLE ROW LEVEL SECURITY;

CREATE POLICY lockout_tagout_select ON public.lockout_tagout
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY lockout_tagout_insert ON public.lockout_tagout
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY lockout_tagout_update ON public.lockout_tagout
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY lockout_tagout_delete ON public.lockout_tagout
  FOR DELETE TO authenticated USING (
    get_user_role() IN ('ADMIN', 'SAFETY_OFFICER')
  );

-- -----------------------------------------------------------
-- 7.5 tagout_devices
-- -----------------------------------------------------------
ALTER TABLE public.tagout_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tagout_devices_select ON public.tagout_devices
  FOR SELECT TO authenticated USING (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY tagout_devices_insert ON public.tagout_devices
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY tagout_devices_update ON public.tagout_devices
  FOR UPDATE TO authenticated USING (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  ) WITH CHECK (
    get_user_role() IN ('PLANNER', 'ADMIN', 'SAFETY_OFFICER')
  );

CREATE POLICY tagout_devices_delete ON public.tagout_devices
  FOR DELETE TO authenticated USING (
    get_user_role() IN ('ADMIN', 'SAFETY_OFFICER')
  );

-- ============================================================
-- SECTION 8: Seed Data — Tipos de Permiso
-- ============================================================
-- Si ya existen (migración re-ejecutada), se salta con ON CONFLICT.
-- ============================================================

INSERT INTO public.permit_types (code, name, description, requires_isolation, requires_gas_test, validity_hours)
VALUES
  ('HOT_WORK',        'Trabajo en Caliente',         'Trabajos que generan chispas o llamas abiertas (soldadura, esmerilado, etc.)', true, true, 8),
  ('COLD_WORK',       'Trabajo en Frío',             'Trabajos que no generan chispas ni calor significativo', false, false, 12),
  ('CONFINED_SPACE',  'Espacio Confinado',            'Ingreso a espacios cerrados con atmósfera potencialmente peligrosa', true, true, 4),
  ('HEIGHT_WORK',     'Trabajo en Altura',            'Trabajos realizados a más de 1.8 metros de altura', false, false, 8),
  ('EXCAVATION',      'Excavación',                   'Trabajos de excavación y zanjas', true, false, 24),
  ('ELECTRICAL',      'Trabajo Eléctrico',            'Trabajos en sistemas eléctricos energizados o con riesgo de arco eléctrico', true, false, 8),
  ('RADIATION',       'Exposición a Radiación',       'Trabajos con exposición a radiación ionizante', true, true, 4)
ON CONFLICT (code) DO NOTHING;
