-- ============================================================
-- MIGRACIÓN 20: PM Engine — Extension Structured Job Plans
-- Change: job-plan-structured / Phase 2
-- ============================================================
-- Extiende generate_due_preventive_work_orders() para clonar:
--   job_plan_labor → work_order_labor_estimates
--   job_plan_safety → work_order_safety_requirements
--   checklist_templates → checklist_instances (PENDING)
--   Calcular estimated_hours, estimated_parts_cost, estimated_labor_cost
-- ============================================================

-- UUID del sistema para instancias de checklist generadas automáticamente
-- Se crea en auth.users + user_profiles para respetar FK
INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@gema.local', '$2a$10$x', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_profiles (id, role)
VALUES ('00000000-0000-0000-0000-000000000000', 'ADMIN')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_created INT := 0;
  v_wo_id TEXT;
  r RECORD;
  v_system_user_id UUID := '00000000-0000-0000-0000-000000000000';
  v_module_id UUID;
  v_template RECORD;
  v_instance_id UUID;
BEGIN
  FOR r IN
    WITH RECURSIVE due_chain AS (
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
      SELECT
        ps.id,
        ps.parent_schedule_id,
        ps.asset_id,
        ps.job_plan_id,
        ps.time_frequency_days,
        dc.path || ps.id,
        TRUE
      FROM pm_schedules ps
      INNER JOIN due_chain dc ON ps.parent_schedule_id = dc.schedule_id
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
        a.module_id,
        jp.code,
        COALESCE(jp.description, jp.code) AS jp_desc,
        jp.estimated_hours
      FROM due_chain dc
      JOIN assets a ON a.id = dc.asset_id
      JOIN job_plans jp ON jp.id = dc.job_plan_id
      WHERE NOT dc.suppressed
    )
    SELECT * FROM eligible e
    ORDER BY e.time_frequency_days DESC NULLS LAST
  LOOP
    -- a. GENERAR WORK ORDER
    INSERT INTO work_orders (
      id, asset_id, equipment_id, wo_type, lifecycle_phase,
      job_plan_id, reported_at, estimated_hours, symptom_note
    ) VALUES (
      gen_random_uuid()::text, r.asset_id::text, r.equipment_id, 'PM', 'WAPPR',
      r.job_plan_id, NOW(), r.estimated_hours,
      format('[PM] %s — %s (Auto-generada cada %s días)', r.code, r.jp_desc, r.time_frequency_days)
    )
    RETURNING id INTO v_wo_id;

    -- b. HEREDAR MATERIALES → material_requests
    INSERT INTO material_requests (work_order_id, part_num, line_desc, requested_qty)
    SELECT
      v_wo_id,
      jpm.part_num,
      COALESCE(sp.description, jpm.part_num),
      jpm.planned_qty
    FROM job_plan_materials jpm
    LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
    WHERE jpm.job_plan_id = r.job_plan_id;

    -- c. HEREDAR LABOR → work_order_labor_estimates
    INSERT INTO work_order_labor_estimates (work_order_id, job_plan_id, trade, estimated_hours, head_count, hourly_rate)
    SELECT v_wo_id, r.job_plan_id, jpl.trade, jpl.estimated_hours, jpl.head_count, jpl.hourly_rate
    FROM job_plan_labor jpl
    WHERE jpl.job_plan_id = r.job_plan_id;

    -- d. HEREDAR SAFETY → work_order_safety_requirements
    INSERT INTO work_order_safety_requirements (work_order_id, job_plan_id, safety_type, description, is_mandatory)
    SELECT v_wo_id, r.job_plan_id, jps.safety_type, jps.description, jps.is_mandatory
    FROM job_plan_safety jps
    WHERE jps.job_plan_id = r.job_plan_id;

    -- e. HEREDAR CHECKLIST TEMPLATES → checklist_instances (PENDING)
    -- Buscar templates por módulo del activo + por job_plan
    -- Lógica: si tiene module_id solo → matchea módulo; si job_plan_id solo → matchea job plan; si ambos → requiere ambos
    FOR v_template IN
      SELECT ct.id AS template_id, ct.block_type, ct.description
      FROM checklist_templates ct
      WHERE ct.is_active = true
        AND ct.job_plan_task_id IS NULL                               -- Plan-level (no task-specific)
        AND (
          (ct.module_id = r.module_id AND ct.job_plan_id IS NULL)     -- Solo module-level
          OR (ct.job_plan_id = r.job_plan_id AND ct.module_id IS NULL) -- Solo job-plan-level
          OR (ct.module_id = r.module_id AND ct.job_plan_id = r.job_plan_id) -- Ambos deben coincidir
        )
    LOOP
      INSERT INTO checklist_instances (
        id, work_order_id, checklist_template_id, technician_id,
        asset_id, evaluator_source, evaluated_by, status,
        started_at, created_at, notes
      ) VALUES (
        gen_random_uuid(), v_wo_id, v_template.template_id,
        v_system_user_id, r.asset_id::text,
        'SELF', v_system_user_id, 'PENDING',
        NULL, NOW(),
        'Generado automáticamente desde job_plan ' || r.code
      );
    END LOOP;

    -- f. CALCULAR COSTOS ESTIMADOS
    -- Usamos work_order_labor_estimates (snapshot clonado en paso c) como fuente de verdad
    UPDATE work_orders
    SET
      -- Horas totales: SUM(estimated_hours × head_count) desde el snapshot de labor
      estimated_hours = COALESCE((
        SELECT SUM(wole.estimated_hours * wole.head_count)
        FROM work_order_labor_estimates wole
        WHERE wole.work_order_id = v_wo_id
      ), 0),

      -- Costo de partes: SUM(planned_qty × unit_cost) desde job_plan_materials
      estimated_parts_cost = COALESCE((
        SELECT SUM(jpm.planned_qty * COALESCE(sp.unit_cost, 0))
        FROM job_plan_materials jpm
        LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
        WHERE jpm.job_plan_id = r.job_plan_id
      ), 0),

      -- Costo de mano de obra: SUM(estimated_hours × head_count × hourly_rate) desde el snapshot
      estimated_labor_cost = COALESCE((
        SELECT SUM(wole.estimated_hours * wole.head_count * wole.hourly_rate)
        FROM work_order_labor_estimates wole
        WHERE wole.work_order_id = v_wo_id
      ), 0)
    WHERE id = v_wo_id;

    -- g. ACTUALIZAR PM SCHEDULE
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

COMMENT ON FUNCTION generate_due_preventive_work_orders IS
  'Genera work orders desde pm_schedules vencidos. Extendido para clonar labor, safety, checklists y calcular costos estimados. Usa UUID placeholder 00000000-0000-0000-0000-000000000000 para checklist_instances sin técnico asignado.';
