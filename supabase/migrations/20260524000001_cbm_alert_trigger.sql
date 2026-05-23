-- ============================================================
-- MIGRATION 6: CBM Alert Trigger — Condition Based Maintenance
-- Change: cbm-alert-trigger
-- ============================================================
-- BEFORE INSERT trigger en meter_readings que evalúa límites
-- (Warning vs Critical) y genera OT automática para casos
-- críticos con filtro Anti-Spam por activo + medidor.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Añadir meter_id a work_orders para trazabilidad directa
--    al sensor que disparó la alerta (ISO 17359 CBM)
-- -----------------------------------------------------------
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS meter_id UUID REFERENCES meters(id);

COMMENT ON COLUMN work_orders.meter_id IS 'Medidor (sensor) que disparó esta OT por condición (CBM)';

-- -----------------------------------------------------------
-- 2. Función trigger: evaluate_meter_reading_for_cbm()
--    BEFORE INSERT ON meter_readings FOR EACH ROW
--
--    Lógica:
--      a. Busca measure_points para el medidor
--      b. Compara reading_value contra los 4 límites
--      c. Warning → solo marca is_alert_triggered = true
--      d. Critical → marca alerta + crea OT (si pasa anti-spam)
--      e. Anti-Spam: busca WO abierta por mismo activo + medidor
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION evaluate_meter_reading_for_cbm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset_id TEXT;
  v_meter_code TEXT;
  v_uom TEXT;
  v_mp measure_points%ROWTYPE;
  v_alert TEXT;
  v_limit_val NUMERIC;
  v_equip_id VARCHAR;
  v_existing_wo_id UUID;
BEGIN
  -- 1. Resolver activo desde el medidor
  SELECT m.asset_id, m.code, m.uom
    INTO v_asset_id, v_meter_code, v_uom
  FROM meters m WHERE m.id = NEW.meter_id;

  IF NOT FOUND THEN
    RAISE WARNING 'CBM: meter_id % no existe — lectura ignorada', NEW.meter_id;
    RETURN NEW;
  END IF;

  -- 2. Obtener límites del punto de medición
  SELECT * INTO v_mp FROM measure_points WHERE meter_id = NEW.meter_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- 3. Evaluar el valor contra los 4 cuadrantes
  IF v_mp.upper_limit_critical IS NOT NULL
     AND NEW.reading_value >= v_mp.upper_limit_critical THEN
    v_alert := 'CRITICAL_HIGH';
    v_limit_val := v_mp.upper_limit_critical;

  ELSIF v_mp.upper_limit_warning IS NOT NULL
        AND NEW.reading_value >= v_mp.upper_limit_warning THEN
    v_alert := 'WARNING_HIGH';
    v_limit_val := v_mp.upper_limit_warning;

  ELSIF v_mp.lower_limit_critical IS NOT NULL
        AND NEW.reading_value <= v_mp.lower_limit_critical THEN
    v_alert := 'CRITICAL_LOW';
    v_limit_val := v_mp.lower_limit_critical;

  ELSIF v_mp.lower_limit_warning IS NOT NULL
        AND NEW.reading_value <= v_mp.lower_limit_warning THEN
    v_alert := 'WARNING_LOW';
    v_limit_val := v_mp.lower_limit_warning;
  END IF;

  -- 4. Marcar la lectura si cruzó algún límite
  IF v_alert IS NOT NULL THEN
    NEW.is_alert_triggered := true;
  END IF;

  -- 5. Solo CRÍTICO dispara creación de OT
  IF v_alert IN ('CRITICAL_HIGH', 'CRITICAL_LOW') THEN
    -- Filtro Anti-Spam: ¿ya hay OT abierta para este activo + medidor?
    SELECT id INTO v_existing_wo_id FROM work_orders
    WHERE asset_id = v_asset_id
      AND meter_id = NEW.meter_id
      AND wo_type = 'CBM'
      AND lifecycle_phase IN ('WAPPR', 'APPROVED', 'INPRG')
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT equipment_id INTO v_equip_id FROM assets WHERE id = v_asset_id;

      INSERT INTO work_orders (
        asset_id, equipment_id, wo_type, lifecycle_phase, meter_id,
        reported_at, criticality, symptom_note
      ) VALUES (
        v_asset_id, v_equip_id, 'CBM', 'WAPPR', NEW.meter_id,
        NOW(), 'A',
        format(
          'Alerta Predictiva: %s en %s alcanzó %s %s (Límite Crítico: %s %s)',
          v_meter_code, v_asset_id, NEW.reading_value, v_uom,
          v_limit_val, v_uom
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------
-- 3. Adjuntar trigger a meter_readings
--    BEFORE INSERT: escribe is_alert_triggered de una sola vez
-- -----------------------------------------------------------
DROP TRIGGER IF EXISTS trg_meter_reading_cbm ON meter_readings;

CREATE TRIGGER trg_meter_reading_cbm
  BEFORE INSERT ON meter_readings
  FOR EACH ROW
  EXECUTE FUNCTION evaluate_meter_reading_for_cbm();
