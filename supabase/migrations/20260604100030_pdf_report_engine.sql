-- ============================================================
-- MIGRATION: PDF Report Engine — Templates + History
-- Change: pdf-report-engine (Phase 1)
-- ============================================================
-- Tablas para el motor de reportes PDF:
--   report_templates — define la estructura del reporte
--   report_history — auditoría de reportes generados
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- ============================================================

-- -----------------------------------------------------------
-- 1. report_templates
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  name VARCHAR(200),
  description TEXT,
  template JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(code, version)
);

COMMENT ON TABLE report_templates IS
  'Plantillas de reporte PDF — definen la estructura visual y campos de cada reporte';
COMMENT ON COLUMN report_templates.code IS
  'Código identificador del template (ej: work_order, maintenance_history)';
COMMENT ON COLUMN report_templates.version IS
  'Versión del template (UNIQUE con code para versionado)';
COMMENT ON COLUMN report_templates.template IS
  'Estructura completa del template: secciones, campos, pipes, estilos, branding';
COMMENT ON COLUMN report_templates.is_active IS
  'Si está activo, se puede usar para generar reportes';
COMMENT ON COLUMN report_templates.created_by IS
  'Usuario que creó el template (UUID como TEXT)';

-- -----------------------------------------------------------
-- 2. report_history
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES report_templates(id),
  template_code VARCHAR(100),
  template_version INT,
  report_data JSONB,
  generated_by TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE report_history IS
  'Historial de reportes generados — auditoría de todas las exportaciones PDF';
COMMENT ON COLUMN report_history.template_id IS
  'Template usado para generar el reporte (FK a report_templates)';
COMMENT ON COLUMN report_history.template_code IS
  'Código del template en el momento de generación (denormalizado)';
COMMENT ON COLUMN report_history.template_version IS
  'Versión del template en el momento de generación (denormalizado)';
COMMENT ON COLUMN report_history.report_data IS
  'Snapshot de los datos usados para generar el reporte (JSONB)';
COMMENT ON COLUMN report_history.generated_by IS
  'Usuario que generó el reporte (UUID como TEXT)';
COMMENT ON COLUMN report_history.generated_at IS
  'Momento en que se generó el reporte';

-- -----------------------------------------------------------
-- 3. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_report_templates_code_active
  ON report_templates (code, is_active);

CREATE INDEX IF NOT EXISTS idx_report_history_template_code_generated
  ON report_history (template_code, generated_at DESC);

-- -----------------------------------------------------------
-- 4. Audit trigger: updated_at automático en report_templates
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION set_report_templates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_templates_updated_at ON report_templates;

CREATE TRIGGER trg_report_templates_updated_at
  BEFORE UPDATE ON report_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_report_templates_updated_at();

COMMENT ON TRIGGER trg_report_templates_updated_at ON report_templates IS
  'Actualiza updated_at automáticamente al modificar el template';

-- -----------------------------------------------------------
-- 5. RLS: report_templates
--    SELECT: todos los authenticated
--    INSERT/UPDATE/DELETE: solo PLANNER y ADMIN
-- -----------------------------------------------------------
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_templates_select_authenticated ON report_templates
  FOR SELECT
  USING (get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN'));

CREATE POLICY report_templates_insert_planner_admin ON report_templates
  FOR INSERT
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY report_templates_update_planner_admin ON report_templates
  FOR UPDATE
  USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

CREATE POLICY report_templates_delete_planner_admin ON report_templates
  FOR DELETE
  USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 6. RLS: report_history
--    SELECT: todos los authenticated
--    INSERT: todos los authenticated (SECURITY DEFINER vía trigger)
--    Sin UPDATE ni DELETE (immutable)
-- -----------------------------------------------------------
ALTER TABLE report_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_history_select_authenticated ON report_history
  FOR SELECT
  USING (get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN'));

-- INSERT permitido para cualquier authenticated user (SECURITY DEFINER en cliente)
CREATE POLICY report_history_insert_authenticated ON report_history
  FOR INSERT
  WITH CHECK (get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN'));

-- -----------------------------------------------------------
-- 7. Seed template: ot-default (work_order)
--    Template por defecto para reportes de Orden de Trabajo
--    con 6 secciones: header, details-grid, divider, labor-table,
--    materials-conditional, footer. Branding primario #1B3A5C.
-- -----------------------------------------------------------
INSERT INTO report_templates (code, version, name, description, template, is_active, created_by)
SELECT
  'ot-default', 1, 'Orden de Trabajo (por defecto)',
  'Template estándar para imprimir Órdenes de Trabajo con datos de la WO, labor y materiales',
  jsonb_build_object(
    'branding', jsonb_build_object(
      'primary_color', '#1B3A5C',
      'secondary_color', '#0D47A1',
      'logo_url', '{{logo_url}}',
      'logo_max_height_mm', 20
    ),
    'page', jsonb_build_object(
      'size', 'A4',
      'margin_top_mm', 15,
      'margin_bottom_mm', 15,
      'margin_left_mm', 15,
      'margin_right_mm', 15
    ),
    'sections', jsonb_build_array(
      -- Section 1: Header — título, código, estado, fechas
      jsonb_build_object(
        'id', 'header',
        'type', 'header',
        'label', 'Encabezado',
        'fields', jsonb_build_array(
          jsonb_build_object('key', 'title', 'label', 'Orden de Trabajo', 'type', 'text'),
          jsonb_build_object('key', 'wo_code', 'label', 'Código OT', 'type', 'field', 'source', 'work_order.id'),
          jsonb_build_object('key', 'status', 'label', 'Estado', 'type', 'field', 'source', 'work_order.lifecycle_phase', 'pipe', 'status_label')
        )
      ),
      -- Section 2: Details Grid — 12 campos de WO en grilla 2 columnas
      jsonb_build_object(
        'id', 'details-grid',
        'type', 'field_table',
        'label', 'Detalles de la Orden',
        'columns', 2,
        'fields', jsonb_build_array(
          jsonb_build_object('label', 'Equipo', 'key', 'equipo', 'source', 'work_order.equipment_id'),
          jsonb_build_object('label', 'Activo', 'key', 'activo', 'source', 'work_order.asset_id'),
          jsonb_build_object('label', 'Descripción', 'key', 'descripcion', 'source', 'work_order.description'),
          jsonb_build_object('label', 'Tipo', 'key', 'tipo', 'source', 'work_order.wo_type', 'pipe', 'wo_type_label'),
          jsonb_build_object('label', 'Prioridad', 'key', 'prioridad', 'source', 'work_order.priority', 'pipe', 'priority_label'),
          jsonb_build_object('label', 'Criticidad', 'key', 'criticidad', 'source', 'work_order.criticality'),
          jsonb_build_object('label', 'Asignado a', 'key', 'asignado', 'source', 'work_order.assigned_to'),
          jsonb_build_object('label', 'Fecha programada', 'key', 'fecha_prog', 'source', 'work_order.scheduled_date', 'pipe', 'date'),
          jsonb_build_object('label', 'Inicio real', 'key', 'inicio_real', 'source', 'work_order.actual_start_at', 'pipe', 'datetime'),
          jsonb_build_object('label', 'Completado', 'key', 'completado', 'source', 'work_order.completed_at', 'pipe', 'datetime'),
          jsonb_build_object('label', 'Horas planificadas', 'key', 'horas_plan', 'source', 'work_order.planned_hours', 'pipe', 'number'),
          jsonb_build_object('label', 'Horas reales', 'key', 'horas_reales', 'source', 'work_order.actual_hours', 'pipe', 'number')
        )
      ),
      -- Section 3: Divider
      jsonb_build_object(
        'id', 'divider-1',
        'type', 'divider',
        'style', jsonb_build_object('color', '#1B3A5C', 'thickness', 1)
      ),
      -- Section 4: Labor Table — registros de labor
      jsonb_build_object(
        'id', 'labor-table',
        'type', 'table',
        'label', 'Registro de Labor',
        'source', 'labor_records',
        'columns', jsonb_build_array(
          jsonb_build_object('label', 'Técnico', 'key', 'technician_id'),
          jsonb_build_object('label', 'Inicio', 'key', 'start_time', 'pipe', 'datetime'),
          jsonb_build_object('label', 'Fin', 'key', 'end_time', 'pipe', 'datetime'),
          jsonb_build_object('label', 'Actividad', 'key', 'activity_code', 'pipe', 'activity_label'),
          jsonb_build_object('label', 'Notas', 'key', 'notes')
        ),
        'empty_text', 'Sin registros de labor'
      ),
      -- Section 5: Materials (conditional block)
      jsonb_build_object(
        'id', 'materials-conditional',
        'type', 'condition_block',
        'label', 'Materiales Utilizados',
        'source', 'material_requests',
        'condition', jsonb_build_object(
          'field', 'count',
          'operator', 'gt',
          'value', 0
        ),
        'columns', jsonb_build_array(
          jsonb_build_object('label', 'Código', 'key', 'part_num'),
          jsonb_build_object('label', 'Descripción', 'key', 'line_desc'),
          jsonb_build_object('label', 'Cant.', 'key', 'requested_qty', 'pipe', 'number')
        ),
        'empty_text', 'Sin materiales registrados'
      ),
      -- Section 6: Footer
      jsonb_build_object(
        'id', 'footer',
        'type', 'footer',
        'fields', jsonb_build_array(
          jsonb_build_object('key', 'generated_at', 'label', 'Generado el', 'type', 'field', 'source', 'generated_at', 'pipe', 'datetime'),
          jsonb_build_object('key', 'generated_by', 'label', 'Generado por', 'type', 'field', 'source', 'generated_by'),
          jsonb_build_object('key', 'signature', 'label', 'Firma', 'type', 'text', 'value', '_________________________')
        )
      )
    )
  ),
  true,
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM report_templates WHERE code = 'ot-default' AND version = 1
);

-- ============================================================
-- FIN MIGRATION: pdf_report_engine
-- ============================================================
