-- ============================================================
-- SEED: Escenario Industrial Realista — PM Engine
-- ============================================================
-- Activo: BANDA-TR-01 (Banda Transportadora)
-- Job Plans: LUB-01 (Lubricación), MEC-FAJA-01 (Cambio de Faja)
-- Spare Parts: GRASA-LITIO, FAJA-24IN
-- PM Schedules: LUB-01 cada 30d (vence HOY), MEC-FAJA-01 cada 180d (vence HOY+5)
-- Jerarquía: MEC-FAJA-01 es padre de LUB-01 (suprime lubricación si hay cambio)
--
-- Idempotente: se puede ejecutar múltiples veces sin duplicar.
-- ============================================================

DO $$
DECLARE
  v_asset_id TEXT;
  v_lub_jp_id UUID;
  v_faja_jp_id UUID;
  v_lub_sched_id UUID;
  v_faja_sched_id UUID;
BEGIN
  -- ============================================================
  -- 0. ASEGURAR TIPO DE ACTIVO
  -- ============================================================
  INSERT INTO asset_types (id, name) VALUES ('BANDA', 'Banda Transportadora')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 1. SPARE PARTS (catálogo de refacciones)
  -- ============================================================
  INSERT INTO spare_parts (part_num, description, uom)
  VALUES
    ('GRASA-LITIO', 'Grasa de litio para rodamientos — 400g', 'UN'),
    ('FAJA-24IN', 'Faja de transmisión 24 pulgadas', 'UN')
  ON CONFLICT (part_num) DO NOTHING;

  -- ============================================================
  -- 2. ACTIVO
  -- ============================================================
  INSERT INTO assets (id, equipment_id, description, asset_type_id, site, location, criticality)
  VALUES (
    'BANDA-TR-01',
    'BANDA-TR-01',
    'Banda Transportadora Principal — Línea 1',
    'BANDA',
    'PLANTA_GENERAL',
    'NAVE_A_LINEA_1',
    'A'
  )
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    asset_type_id = EXCLUDED.asset_type_id
  RETURNING id INTO v_asset_id;

  -- Si el activo ya existía, RETURNING no devuelve nada → leerlo directo
  IF v_asset_id IS NULL THEN
    SELECT id INTO v_asset_id FROM assets WHERE equipment_id = 'BANDA-TR-01';
  END IF;

  -- ============================================================
  -- 3. JOB PLANS (idempotente por code UNIQUE)
  -- ============================================================
  INSERT INTO job_plans (code, description, intervention_type, estimated_hours)
  VALUES
    ('LUB-01', 'Lubricación de Rodamientos — Banda Transportadora', 'LUBRICATION', 1),
    ('MEC-FAJA-01', 'Cambio de Faja de Transmisión — Banda Transportadora', 'MINOR_SERVICE', 3)
  ON CONFLICT (code) DO UPDATE SET
    description = EXCLUDED.description,
    intervention_type = EXCLUDED.intervention_type,
    estimated_hours = EXCLUDED.estimated_hours;

  -- Capturo IDs
  SELECT id INTO v_lub_jp_id FROM job_plans WHERE code = 'LUB-01';
  SELECT id INTO v_faja_jp_id FROM job_plans WHERE code = 'MEC-FAJA-01';

  -- ============================================================
  -- 4. JOB PLAN MATERIALS (solo si no existen)
  -- ============================================================
  IF NOT EXISTS (SELECT 1 FROM job_plan_materials WHERE job_plan_id = v_lub_jp_id AND part_num = 'GRASA-LITIO') THEN
    INSERT INTO job_plan_materials (job_plan_id, part_num, planned_qty)
    VALUES (v_lub_jp_id, 'GRASA-LITIO', 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM job_plan_materials WHERE job_plan_id = v_faja_jp_id AND part_num = 'FAJA-24IN') THEN
    INSERT INTO job_plan_materials (job_plan_id, part_num, planned_qty)
    VALUES (v_faja_jp_id, 'FAJA-24IN', 1);
  END IF;

  -- ============================================================
  -- 5. PM SCHEDULES con JERARQUÍA de supresión
  --    MEC-FAJA-01 (180 días) es PADRE de LUB-01 (30 días)
  --    LUB-01 vence HOY → genera OT
  --    MEC-FAJA-01 vence HOY+5 → no vence aún
  -- ============================================================

  -- Primero: padre (MEC-FAJA-01) con id fijo para referencia
  INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, is_floating)
  VALUES (
    'a0000000-0000-0000-0000-000000000001'::uuid,
    v_asset_id, v_faja_jp_id, 180, CURRENT_DATE + 5, false
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_faja_sched_id;

  IF v_faja_sched_id IS NULL THEN
    v_faja_sched_id := 'a0000000-0000-0000-0000-000000000001'::uuid;
  END IF;

  -- Segundo: hijo (LUB-01) referenciando al padre
  INSERT INTO pm_schedules (id, asset_id, job_plan_id, time_frequency_days, next_target_date, parent_schedule_id, is_floating)
  VALUES (
    'a0000000-0000-0000-0000-000000000002'::uuid,
    v_asset_id, v_lub_jp_id, 30, CURRENT_DATE, 'a0000000-0000-0000-0000-000000000001'::uuid, false
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_lub_sched_id;

  IF v_lub_sched_id IS NULL THEN
    v_lub_sched_id := 'a0000000-0000-0000-0000-000000000002'::uuid;
  END IF;

  RAISE NOTICE 'Seed completado: asset=%, LUB-01=%, MEC-FAJA-01=%, lub_sched=%, faja_sched=%',
    v_asset_id, v_lub_jp_id, v_faja_jp_id, v_lub_sched_id, v_faja_sched_id;
END $$;
