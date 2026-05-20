-- ============================================================
-- MIGRATION: work_orders v2 — Phase 1: Supabase Foundation
-- Change: work-order-fsm-schema-phase-1
-- PR: 1 of 2
-- ============================================================
-- This file is idempotent. Safe to run multiple times in the
-- Supabase SQL Editor.
-- ============================================================

-- -----------------------------------------------------------
-- 1. ENUM type for work order classification
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wo_type_enum') THEN
    CREATE TYPE wo_type_enum AS ENUM (
      'preventive', 'corrective', 'predictive', 'emergency', 'inspection'
    );
  END IF;
END $$;

-- -----------------------------------------------------------
-- 2. New columns on work_orders
-- -----------------------------------------------------------
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS asset_id TEXT,
  ADD COLUMN IF NOT EXISTS wo_type wo_type_enum DEFAULT 'corrective',
  ADD COLUMN IF NOT EXISTS planned_hours NUMERIC DEFAULT 0 CHECK (planned_hours >= 0),
  ADD COLUMN IF NOT EXISTS actual_hours NUMERIC DEFAULT 0 CHECK (actual_hours >= 0),
  ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC DEFAULT 0 CHECK (cost_estimate >= 0),
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0 CHECK (actual_cost >= 0),
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approval_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS work_center TEXT,
  ADD COLUMN IF NOT EXISTS planner_group TEXT,
  ADD COLUMN IF NOT EXISTS downtime_hours NUMERIC DEFAULT 0 CHECK (downtime_hours >= 0),
  ADD COLUMN IF NOT EXISTS percentage_complete INTEGER DEFAULT 0 CHECK (percentage_complete BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS _conflict BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS _deleted BOOLEAN DEFAULT FALSE;

-- -----------------------------------------------------------
-- 3. Timestamp trigger — update updated_at (BIGINT) to epoch ms
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_work_orders_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_timestamp ON work_orders;

CREATE TRIGGER work_orders_timestamp
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_work_orders_timestamp();

-- -----------------------------------------------------------
-- 4. FSM validation trigger — reject invalid status transitions
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_work_order_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status NOT IN ('in_progress', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status transition from pending to %', NEW.status;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status transition from in_progress to %', NEW.status;
  END IF;

  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status transition: % is a terminal status', OLD.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_fsm_validation ON work_orders;

CREATE TRIGGER work_orders_fsm_validation
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_work_order_status_transition();

-- -----------------------------------------------------------
-- 5. Audit table: work_order_status_history
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);

-- -----------------------------------------------------------
-- 6. Audit trigger — log every status change with reason
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION log_work_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_reason TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_reason := COALESCE(NEW.cancel_reason, NEW.close_reason, NEW.hold_reason, NULL);

  INSERT INTO work_order_status_history (
    work_order_id,
    from_status,
    to_status,
    changed_by,
    reason
  ) VALUES (
    NEW.id,
    OLD.status,
    NEW.status,
    COALESCE(NEW.approved_by, NEW.requested_by, NULL),
    v_reason
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_orders_status_audit ON work_orders;

CREATE TRIGGER work_orders_status_audit
  AFTER UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_work_order_status_change();

-- -----------------------------------------------------------
-- 7. Enable Row Level Security
-- -----------------------------------------------------------
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------
-- 8. RLS policies on work_orders
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_orders'
      AND policyname = 'work_orders_select_policy'
  ) THEN
    CREATE POLICY work_orders_select_policy
      ON work_orders FOR SELECT
      USING (_deleted = FALSE OR _deleted IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_orders'
      AND policyname = 'work_orders_insert_policy'
  ) THEN
    CREATE POLICY work_orders_insert_policy
      ON work_orders FOR INSERT
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_orders'
      AND policyname = 'work_orders_update_policy'
  ) THEN
    CREATE POLICY work_orders_update_policy
      ON work_orders FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- -----------------------------------------------------------
-- 9. RLS policies on work_order_status_history
-- -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_order_status_history'
      AND policyname = 'work_order_status_history_select_policy'
  ) THEN
    CREATE POLICY work_order_status_history_select_policy
      ON work_order_status_history FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'work_order_status_history'
      AND policyname = 'work_order_status_history_insert_policy'
  ) THEN
    CREATE POLICY work_order_status_history_insert_policy
      ON work_order_status_history FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- -----------------------------------------------------------
-- 10. Backfill existing rows
-- -----------------------------------------------------------
UPDATE work_orders SET _conflict = FALSE WHERE _conflict IS NULL;
UPDATE work_orders SET _deleted = FALSE WHERE _deleted IS NULL;
UPDATE work_orders SET updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint WHERE updated_at = 0;

-- -----------------------------------------------------------
-- VERIFICATION QUERIES (run manually if desired)
-- -----------------------------------------------------------
/*
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_orders'
ORDER BY ordinal_position;

SELECT * FROM work_order_status_history LIMIT 0;

SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('work_orders', 'work_order_status_history');
*/
