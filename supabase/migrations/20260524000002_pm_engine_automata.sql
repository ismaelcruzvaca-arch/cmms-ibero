-- ============================================================
-- MIGRATION 7: PM Engine — Preventive Maintenance Automata
-- Change: pm-engine-automata
-- ============================================================
-- Genera Órdenes de Trabajo preventivas a partir de
-- pm_schedules. Incluye supresión jerárquica (SAP/Maximo),
-- herencia de materiales, y recálculo de reloj fijo.
--
-- NOTA: En producción, pm_schedules.asset_id es INTEGER
-- (assets.id es INTEGER), y work_orders.asset_id es TEXT.
-- Por eso el JOIN usa a.id = dc.asset_id (INTEGER) y el
-- INSERT castea r.asset_id::text para work_orders.asset_id.
-- Ver migración 20260522000003 para el schema evolution.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Añadir job_plan_id a work_orders para trazabilidad
--    de la plantilla que originó la OT preventiva
-- -----------------------------------------------------------
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS job_plan_id UUID REFERENCES job_plans(id);

COMMENT ON COLUMN work_orders.job_plan_id IS 'Plan de trabajo (job_plan) que originó esta OT preventiva';

-- -----------------------------------------------------------
-- 2. Función: generate_due_preventive_work_orders()
--    Devuelve INT = número de OTs creadas
--
--    Flujo:
--      a. SCAN: pm_schedules WHERE next_target_date::DATE <= CURRENT_DATE
--      b. SUPPRESS: CTE recursiva — si padre e hijo vencen juntos,
--         suprime al hijo (solo se genera la OT del padre)
--      c. GENERATE: INSERT en work_orders con ISO 14224
--      d. INHERIT: Copia job_plan_materials → material_requests
--      e. RECALC: next_target_date += time_frequency_days
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_created INT := 0;
  v_wo_id UUID;
  r RECORD;
BEGIN
  FOR r IN
    WITH RECURSIVE due_chain AS (
      -- BASE: schedules vencidos cuyo padre NO está vencido (o son raíz)
      -- Si el padre está vencido, el hijo entra solo vía la recursión
      -- con suppressed=TRUE, garantizando supresión en N niveles.
      SELECT
        ps.id AS schedule_id,
        ps.parent_schedule_id,
        ps.asset_id,
        ps.job_plan_id,
        ps.time_frequency_days,
        ARRAY[ps.id] AS path,
        FALSE AS suppressed
      FROM pm_schedules ps
      WHERE ps.next_target_date IS NOT NULL
        AND ps.next_target_date::DATE <= CURRENT_DATE
        AND (ps.parent_schedule_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM pm_schedules p
            WHERE p.id = ps.parent_schedule_id
              AND p.next_target_date IS NOT NULL
              AND p.next_target_date::DATE <= CURRENT_DATE
          ))

      UNION ALL

      -- Hijos cuyo padre (o abuelo) también está vencido → SUPRIMIDOS
      SELECT
        ps.id,
        ps.parent_schedule_id,
        ps.asset_id,
        ps.job_plan_id,
        ps.time_frequency_days,
        dc.path || ps.id,
        TRUE
      FROM pm_schedules ps
      INNER JOIN due_chain dc ON ps.parent_schedule_id = dc.id
      WHERE ps.next_target_date IS NOT NULL
        AND ps.next_target_date::DATE <= CURRENT_DATE
        AND NOT ps.id = ANY(dc.path)
    ),
    eligible AS (
      SELECT
        dc.schedule_id,
        dc.asset_id,
        dc.job_plan_id,
        dc.time_frequency_days,
        a.equipment_id,
        jp.code,
        COALESCE(jp.description, jp.code) AS jp_desc,
        jp.estimated_hours
      FROM due_chain dc
      JOIN assets a ON a.id = dc.asset_id  -- assets.id es INTEGER en prod
      JOIN job_plans jp ON jp.id = dc.job_plan_id
      WHERE NOT dc.suppressed
    )
    SELECT * FROM eligible e
    ORDER BY e.time_frequency_days DESC NULLS LAST
  LOOP
    -- a. GENERAR WORK ORDER
    INSERT INTO work_orders (
      asset_id, equipment_id, wo_type, lifecycle_phase,
      job_plan_id, reported_at, planned_hours, symptom_note
    ) VALUES (
      r.asset_id, r.equipment_id, 'PM', 'WAPPR',
      r.job_plan_id, NOW(), r.estimated_hours,
      format(
        '[PM] %s — %s (Auto-generada cada %s días)',
        r.code, r.jp_desc, r.time_frequency_days
      )
    )
    RETURNING id INTO v_wo_id;

    -- b. HEREDAR MATERIALES del job_plan a la OT
    INSERT INTO material_requests (
      work_order_id, part_num, line_desc, requested_qty
    )
    SELECT
      v_wo_id,
      jpm.part_num,
      COALESCE(sp.description, jpm.part_num),
      jpm.planned_qty
    FROM job_plan_materials jpm
    LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
    WHERE jpm.job_plan_id = r.job_plan_id;

    -- c. RECALCULAR RELOJ (fijo — suma días a la fecha actual)
    UPDATE pm_schedules
    SET
      last_completion_date = NOW(),
      next_target_date = next_target_date + (r.time_frequency_days || ' days')::INTERVAL
    WHERE id = r.schedule_id;

    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$$;
