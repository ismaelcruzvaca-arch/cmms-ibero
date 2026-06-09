-- ============================================================
-- MIGRATION: PDF Seed — Template fix + Seed data
-- Change: pdf-engine-seed-testing
-- ============================================================
-- 1. Corrige el template seed 'ot-default' para usar:
--    - types correctos: details-grid, condition-block
--    - titleField/dataField en vez de fields[]/source
--    - pipes que YA existen: status_label, wo_type_label,
--      priority_label, datetime, activity_label, number
-- 2. Inserta seed data para integration test:
--    - 1 asset, 1 WO, 2 labor_records, 1 material_request
--
-- Idempotente: UPDATE WHERE + INSERT ON CONFLICT
-- ============================================================

-- -----------------------------------------------------------
-- 0. Asegurar columnas que pueden no existir en work_orders
--    (legacy de pre-ISO 14224 — algunas BD pueden no tenerlas)
-- -----------------------------------------------------------
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS priority VARCHAR(20);

-- -----------------------------------------------------------
-- 1. Corregir template seed ot-default (version 1)
-- -----------------------------------------------------------
UPDATE report_templates
SET template = '{
  "sections": [
    {
      "type": "header",
      "titleField": "title",
      "badgeField": "badge"
    },
    {
      "type": "details-grid",
      "columns": 2,
      "items": [
        { "label": "Equipo", "value": "{{work_order.equipment_id}}" },
        { "label": "Descripción", "value": "{{work_order.description}}" },
        { "label": "Tipo", "value": "{{work_order.wo_type | wo_type_label}}" },
        { "label": "Prioridad", "value": "{{work_order.priority | priority_label}}" },
        { "label": "Estado", "value": "{{work_order.lifecycle_phase | status_label}}" },
        { "label": "Inicio real", "value": "{{work_order.actual_start_at | datetime}}" },
        { "label": "Completado", "value": "{{work_order.completed_at | datetime}}" },
        { "label": "Horas reales", "value": "{{work_order.actual_hours | number}}" }
      ]
    },
    { "type": "divider" },
    {
      "type": "table",
      "dataField": "labor_records",
      "columns": [
        { "header": "Técnico", "key": "technician_name" },
        { "header": "Inicio", "key": "start_time", "pipe": "datetime" },
        { "header": "Fin", "key": "end_time", "pipe": "datetime" },
        { "header": "Actividad", "key": "activity_code", "pipe": "activity_label" }
      ]
    },
    {
      "type": "condition-block",
      "condition": "material_requests | notEmpty",
      "sections": [
        {
          "type": "table",
          "dataField": "material_requests",
          "columns": [
            { "header": "Código", "key": "part_num" },
            { "header": "Descripción", "key": "line_desc" },
            { "header": "Cant.", "key": "requested_qty", "pipe": "number" }
          ]
        }
      ]
    },
    {
      "type": "footer",
      "text": "Generado por CMMS Ibero — {{generated_at | datetime}}"
    }
  ]
}'::jsonb
WHERE code = 'ot-default' AND version = 1;

-- -----------------------------------------------------------
-- 2. Seed data: asset
-- -----------------------------------------------------------
INSERT INTO assets (id, equipment_id, description, location, site, status, criticality)
VALUES (
  'SEED-ASSET-001',
  'EQ-PUMP-001',
  'Bomba Centrífuga Principal — Planta de Tratamiento',
  'Planta Baja — Sala de Bombas',
  'Planta Central',
  'active',
  'A'
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------
-- 3. Seed data: work_order
--    Usamos lifecycle_phase = 'COMP' (valor válido del ENUM).
--    El pipe status_label NO mapea 'COMP' directamente, pero
--    la integration test construye renderData manualmente con
--    'COMPLETED' para ejercitar el pipe.
--    INSERT directo — el FSM trigger solo actúa en UPDATE.
-- -----------------------------------------------------------
INSERT INTO work_orders (
  id, asset_id, equipment_id, wo_type, lifecycle_phase, block_reason,
  description, priority, actual_start_at, completed_at, actual_hours,
  created_at, updated_at
)
VALUES (
  'SEED-WO-001',
  'SEED-ASSET-001',
  'EQ-PUMP-001',
  'CM',
  'COMP',
  'NONE',
  'Reparación de bomba centrífuga — reemplazo de sello mecánico',
  'HIGH',
  '2026-06-08T08:00:00Z',
  '2026-06-08T16:30:00Z',
  8.5,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------
-- 4. Seed data: labor_records (2 rows)
--    activity_code usa valores del CHECK constraint existente.
--    technician_id usa el UUID del sistema (creado en migración
--    previa 20260531000002_pm_engine_extend.sql).
-- -----------------------------------------------------------
INSERT INTO labor_records (id, work_order_id, technician_id, start_time, end_time, activity_code, notes)
VALUES
  (
    gen_random_uuid(),
    'SEED-WO-001',
    '00000000-0000-0000-0000-000000000000',
    '2026-06-08T08:00:00Z',
    '2026-06-08T12:00:00Z',
    'DIRECT_WORK',
    'Desmontaje de bomba y extracción de sello dañado'
  ),
  (
    gen_random_uuid(),
    'SEED-WO-001',
    '00000000-0000-0000-0000-000000000000',
    '2026-06-08T13:00:00Z',
    '2026-06-08T16:30:00Z',
    'DIRECT_WORK',
    'Instalación de sello nuevo y montaje de bomba'
  )
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------
-- 5. Seed data: material_requests (1 row)
-- -----------------------------------------------------------
INSERT INTO material_requests (id, work_order_id, part_num, line_desc, is_non_stock, requested_qty)
VALUES (
  gen_random_uuid(),
  'SEED-WO-001',
  'MECH-SEAL-001',
  'Sello mecánico 25mm — Viton/Carburo Silicio',
  false,
  2
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- FIN MIGRATION: pdf_seed_fix
-- ============================================================
