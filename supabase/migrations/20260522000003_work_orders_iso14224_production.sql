-- ============================================================
-- MIGRATION 8: Schema Evolution — work_orders ISO 14224 (Aditivo)
-- Change: schema-evolution-production
-- ============================================================
-- Migration aditiva (NO DROP) que agrega columnas ISO 14224
-- a la tabla work_orders de producción, preservando:
--   - RxDB columns (_deleted, _conflict, updated_at BIGINT)
--   - status VARCHAR (con trigger de sincronía bidireccional)
--   - Todos los datos existentes
--   - Soporte Offline-First
-- ============================================================

-- -----------------------------------------------------------
-- 1. Crear ENUMs ISO 14224 (idempotente)
-- -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE lifecycle_phase AS ENUM (
    'WAPPR', 'APPROVED', 'INPRG', 'COMP', 'CLOSED',
    'CANCELLED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN
  -- Agregar valores faltantes si el tipo ya existe
  BEGIN
    ALTER TYPE lifecycle_phase ADD VALUE IF NOT EXISTS 'CANCELLED';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TYPE lifecycle_phase ADD VALUE IF NOT EXISTS 'REJECTED';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

DO $$ BEGIN
  CREATE TYPE block_reason AS ENUM (
    'NONE', 'PARTS', 'TOOLS', 'CREW', 'PERMIT',
    'SHUTDOWN', 'WEATHER', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------
-- 2. Agregar 'PM' al wo_type_enum existente (idempotente)
--    Necesario para que la migración del PM Engine no falle
-- -----------------------------------------------------------
DO $$ BEGIN
  ALTER TYPE wo_type_enum ADD VALUE IF NOT EXISTS 'PM';
EXCEPTION WHEN undefined_object THEN
  -- wo_type_enum no existe en este entorno (ej: local dev con TEXT)
  NULL;
END $$;

-- -----------------------------------------------------------
-- 3. Agregar columnas ISO 14224 faltantes (TODAS NULLable)
--    Nota: las columnas que ya existen NO se duplican
-- -----------------------------------------------------------

-- Lifecycle ISO 14224
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS lifecycle_phase lifecycle_phase;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS block_reason block_reason DEFAULT 'NONE';

-- Timestamps operativos ISO 14224 (los que no existen en prod)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS planned_start_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS actual_start_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS machine_down_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS machine_up_at TIMESTAMPTZ;

-- Taxonomía de fallas ISO 14224
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS failure_class VARCHAR;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS problem_code VARCHAR;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cause_code VARCHAR;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS remedy_code VARCHAR;

-- Contexto operacional ISO 14224
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS asset_class VARCHAR;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS part_in_process VARCHAR;

-- Notas estructuradas ISO 14224
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS symptom_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cause_note TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS action_note TEXT;

-- Metadata ISO 14224
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS reported_by TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS maintenance_reference TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS revision INTEGER;

-- Columna de preservación (id legacy en TEXT no UUID)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS legacy_id TEXT;

-- job_plan_id (idempotente — la migración del PM Engine ya lo agrega)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS job_plan_id UUID REFERENCES job_plans(id);

-- Columna status para retrocompatibilidad con RxDB (sync bidireccional)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
COMMENT ON COLUMN work_orders.status IS 'Retrocompatibilidad RxDB — sincronizado desde lifecycle_phase via trigger';

COMMENT ON COLUMN work_orders.lifecycle_phase IS 'ISO 14224 — Fase del ciclo de vida de la OT';
COMMENT ON COLUMN work_orders.block_reason IS 'ISO 14224 — Motivo de bloqueo (si lifecycle_phase lo requiere)';
COMMENT ON COLUMN work_orders.symptom_note IS 'ISO 14224 — Descripción del síntoma reportado';
COMMENT ON COLUMN work_orders.legacy_id IS 'ID original en TEXT (preservado durante migración UUID)';

-- -----------------------------------------------------------
-- 4. Reemplazar FSM trigger: status → lifecycle_phase
--    El trigger legacy valida status; necesitamos que valide
--    lifecycle_phase. Lo dropeamos y creamos el nuevo.
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS work_orders_fsm_validation ON work_orders;
DROP FUNCTION IF EXISTS validate_work_order_status_transition();

CREATE OR REPLACE FUNCTION validate_lifecycle_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Permitir si lifecycle_phase no cambió
  IF OLD.lifecycle_phase IS NOT DISTINCT FROM NEW.lifecycle_phase THEN
    RETURN NEW;
  END IF;

  -- Transiciones forward-only ISO 14224
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

  -- Cancelación / Rechazo permitido desde cualquier fase activa
  IF NEW.lifecycle_phase IN ('CANCELLED', 'REJECTED') THEN
    RETURN NEW;
  END IF;

  -- Cualquier otra transición es inválida
  RAISE EXCEPTION 'Transición de lifecycle_phase inválida: % → %',
    OLD.lifecycle_phase, NEW.lifecycle_phase;
END;
$$;

DROP TRIGGER IF EXISTS work_orders_fsm ON work_orders;

CREATE TRIGGER work_orders_fsm
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.lifecycle_phase IS DISTINCT FROM NEW.lifecycle_phase)
  EXECUTE FUNCTION validate_lifecycle_fsm();

COMMENT ON TRIGGER work_orders_fsm ON work_orders IS
  'ISO 14224 — Valida transiciones forward-only de lifecycle_phase';

-- -----------------------------------------------------------
-- 5. Trigger de sincronía bidireccional lifecycle_phase ↔ status
--    Mantiene status sincronizado para la app legacy (RxDB)
--    mientras el frontend migra a lifecycle_phase.
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_legacy_work_order_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Si status fue explícitamente seteado y lifecycle_phase es el default → status gana
    IF NEW.status IS NOT NULL AND NEW.lifecycle_phase = 'WAPPR'::lifecycle_phase THEN
      NEW.lifecycle_phase := CASE NEW.status
        WHEN 'pending'      THEN 'WAPPR'
        WHEN 'approved'     THEN 'APPROVED'
        WHEN 'in_progress'  THEN 'INPRG'
        WHEN 'completed'    THEN 'COMP'
        WHEN 'cancelled'    THEN 'CANCELLED'
        ELSE 'WAPPR'
      END::lifecycle_phase;
    -- Si lifecycle_phase fue explícitamente seteado (no default) → lifecycle_phase gana
    ELSIF NEW.lifecycle_phase IS NOT NULL THEN
      NEW.status := CASE NEW.lifecycle_phase
        WHEN 'WAPPR'     THEN 'pending'
        WHEN 'APPROVED'  THEN 'approved'
        WHEN 'INPRG'     THEN 'in_progress'
        WHEN 'COMP'      THEN 'completed'
        WHEN 'CLOSED'    THEN 'completed'
        WHEN 'CANCELLED' THEN 'cancelled'
        WHEN 'REJECTED'  THEN 'cancelled'
        ELSE 'pending'
      END;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Si cambiaron lifecycle_phase → sincronizar status
    IF NEW.lifecycle_phase IS DISTINCT FROM OLD.lifecycle_phase THEN
      NEW.status := CASE NEW.lifecycle_phase
        WHEN 'WAPPR'     THEN 'pending'
        WHEN 'APPROVED'  THEN 'approved'
        WHEN 'INPRG'     THEN 'in_progress'
        WHEN 'COMP'      THEN 'completed'
        WHEN 'CLOSED'    THEN 'completed'
        WHEN 'CANCELLED' THEN 'cancelled'
        WHEN 'REJECTED'  THEN 'cancelled'
        ELSE 'pending'
      END;
    -- Si solo cambiaron status (app legacy) → sincronizar lifecycle_phase
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.lifecycle_phase := CASE NEW.status
        WHEN 'pending'      THEN 'WAPPR'
        WHEN 'approved'     THEN 'APPROVED'
        WHEN 'in_progress'  THEN 'INPRG'
        WHEN 'completed'    THEN 'COMP'
        WHEN 'cancelled'    THEN 'CANCELLED'
        ELSE 'WAPPR'
      END::lifecycle_phase;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_status ON work_orders;

CREATE TRIGGER trg_sync_legacy_status
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_legacy_work_order_status();

COMMENT ON TRIGGER trg_sync_legacy_status ON work_orders IS
  'Sincronía bidireccional lifecycle_phase ↔ status para retrocompatibilidad RxDB';

-- -----------------------------------------------------------
-- 6. Migrar datos históricos (solo en producción con columnas legacy)
-- -----------------------------------------------------------
DO $$ BEGIN
  -- Solo ejecutar si existe la columna legacy 'status'
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'work_orders' AND column_name = 'status') THEN

    BEGIN
      UPDATE work_orders
      SET lifecycle_phase = CASE status
        WHEN 'pending'      THEN 'WAPPR'
        WHEN 'approved'     THEN 'APPROVED'
        WHEN 'in_progress'  THEN 'INPRG'
        WHEN 'completed'    THEN 'COMP'
        WHEN 'cancelled'    THEN 'CANCELLED'
        ELSE 'WAPPR'
      END::lifecycle_phase
      WHERE lifecycle_phase IS NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET symptom_note = description
      WHERE symptom_note IS NULL AND description IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET planned_start_at = scheduled_date::TIMESTAMPTZ
      WHERE planned_start_at IS NULL AND scheduled_date IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET actual_start_at = start_date
      WHERE actual_start_at IS NULL AND start_date IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET completed_at = completed_date::TIMESTAMPTZ
      WHERE completed_at IS NULL AND completed_date IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET closed_at = end_date
      WHERE closed_at IS NULL AND end_date IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;

    BEGIN
      UPDATE work_orders
      SET approved_at = approval_date
      WHERE approved_at IS NULL AND approval_date IS NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
END $$;

-- Preservar IDs legacy
UPDATE work_orders
SET legacy_id = id::text
WHERE legacy_id IS NULL;

-- -----------------------------------------------------------
-- 7. Verificación post-migración
-- -----------------------------------------------------------
DO $$
DECLARE
  v_count INT;
  v_nulls INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM work_orders;
  SELECT COUNT(*) INTO v_nulls FROM work_orders WHERE lifecycle_phase IS NULL;

  IF v_nulls > 0 THEN
    RAISE WARNING 'Migración: % de % work_orders tienen lifecycle_phase NULL', v_nulls, v_count;
  ELSE
    RAISE NOTICE 'Migración completada: % work_orders con lifecycle_phase asignado', v_count;
  END IF;
END $$;
