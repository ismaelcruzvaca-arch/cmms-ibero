-- ============================================================
-- MIGRATION: condition_import_staging — CSV Staging Tables
-- Change: condition-monitoring-hybrid-sources (PR 2 Slice 2a)
-- ============================================================
-- Crea las tablas de staging para importación batch de datos
-- de condición vía CSV con pipeline de validación e ingesta.
--
-- Tablas:
--   condition_import_batches — cabecera del lote de importación
--   condition_import_rows   — filas individuales con datos crudos
--
-- CHECKs: status pipeline de batch (8 estados) y filas (5 estados)
-- FK: condition_import_rows.batch_id → batches(id) ON DELETE CASCADE
-- RLS: SELECT→authenticated, INSERT/UPDATE→PLANNER+ADMIN, DELETE→ADMIN
--
-- Dependencias: get_user_role() definida en migración de RBAC.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_import_batches
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER DEFAULT 0,
  invalid_rows INTEGER DEFAULT 0,
  source_id TEXT NOT NULL,
  status TEXT DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'validating', 'validated', 'ready_to_import',
    'importing', 'imported', 'failed', 'cancelled'
  )),
  column_mapping JSONB DEFAULT '{}',
  error_summary JSONB,
  created_by TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_import_batches
  IS 'Lotes de importación CSV con pipeline de staging y validación';

COMMENT ON COLUMN public.condition_import_batches.batch_id
  IS 'Identificador único del lote (csv_import:{timestamp}:{hash_8})';

COMMENT ON COLUMN public.condition_import_batches.file_name
  IS 'Nombre original del archivo CSV subido';

COMMENT ON COLUMN public.condition_import_batches.file_hash
  IS 'Hash SHA-256 del contenido del archivo para detectar re-uploads';

COMMENT ON COLUMN public.condition_import_batches.row_count
  IS 'Total de filas de datos en el CSV';

COMMENT ON COLUMN public.condition_import_batches.valid_rows
  IS 'Cantidad de filas que pasaron validación';

COMMENT ON COLUMN public.condition_import_batches.invalid_rows
  IS 'Cantidad de filas con errores de validación';

COMMENT ON COLUMN public.condition_import_batches.source_id
  IS 'Referencia a condition_sources.source_id (ej: csv_import)';

COMMENT ON COLUMN public.condition_import_batches.status
  IS 'Pipeline: uploaded → validating → validated → ready_to_import → importing → imported | failed | cancelled';

COMMENT ON COLUMN public.condition_import_batches.column_mapping
  IS 'Mapeo de columnas del archivo → campos FeatureSet v0.2 (JSONB)';

COMMENT ON COLUMN public.condition_import_batches.error_summary
  IS 'Resumen de errores agrupados por tipo (JSONB)';

COMMENT ON COLUMN public.condition_import_batches.created_by
  IS 'Usuario que subió el archivo CSV';

COMMENT ON COLUMN public.condition_import_batches.confirmed_at
  IS 'Timestamp en que el usuario confirmó la ingesta del batch';

COMMENT ON COLUMN public.condition_import_batches.created_at
  IS 'Fecha de creación del lote';

COMMENT ON COLUMN public.condition_import_batches.updated_at
  IS 'Fecha de última actualización del lote';

-- -----------------------------------------------------------
-- 2. Tabla: condition_import_rows
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.condition_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  mapped_data JSONB,
  validation_errors TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'valid', 'invalid', 'imported', 'error'
  )),
  feature_value_id UUID,
  window_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, row_number)
);

COMMENT ON TABLE public.condition_import_rows
  IS 'Filas individuales de importación CSV con datos crudos y validación';

COMMENT ON COLUMN public.condition_import_rows.batch_id
  IS 'FK al lote de importación padre (CASCADE delete)';

COMMENT ON COLUMN public.condition_import_rows.row_number
  IS 'Número de fila en el CSV original (1-indexed)';

COMMENT ON COLUMN public.condition_import_rows.raw_data
  IS 'Datos crudos de la fila CSV como JSONB (headers → valores)';

COMMENT ON COLUMN public.condition_import_rows.mapped_data
  IS 'Datos mapeados a campos FeatureSet v0.2 según column_mapping del batch';

COMMENT ON COLUMN public.condition_import_rows.validation_errors
  IS 'Array de mensajes de error: feature desconocido, asset inexistente, valor no numérico, etc.';

COMMENT ON COLUMN public.condition_import_rows.status
  IS 'Estado de validación/ingesta: pending → valid | invalid → imported | error';

COMMENT ON COLUMN public.condition_import_rows.feature_value_id
  IS 'FK al condition_feature_value creado tras ingesta exitosa';

COMMENT ON COLUMN public.condition_import_rows.window_id
  IS 'FK a la condition_window creada tras ingesta exitosa';

COMMENT ON COLUMN public.condition_import_rows.notes
  IS 'Notas adicionales sobre la fila durante validación o ingesta';

COMMENT ON COLUMN public.condition_import_rows.created_at
  IS 'Fecha de creación del registro de fila';

-- -----------------------------------------------------------
-- 3. Índices: condition_import_batches
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_batches_status
  ON public.condition_import_batches(status);

CREATE INDEX IF NOT EXISTS idx_batches_created_at
  ON public.condition_import_batches(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_batches_created_by
  ON public.condition_import_batches(created_by);

-- -----------------------------------------------------------
-- 4. Índices: condition_import_rows
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_import_rows_batch
  ON public.condition_import_rows(batch_id);

CREATE INDEX IF NOT EXISTS idx_import_rows_status
  ON public.condition_import_rows(status);

-- -----------------------------------------------------------
-- 5. Row-Level Security: condition_import_batches
-- -----------------------------------------------------------
ALTER TABLE public.condition_import_batches ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede ver lotes
DROP POLICY IF EXISTS condition_import_batches_select ON public.condition_import_batches;
CREATE POLICY condition_import_batches_select ON public.condition_import_batches
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden crear lotes
DROP POLICY IF EXISTS condition_import_batches_insert ON public.condition_import_batches;
CREATE POLICY condition_import_batches_insert ON public.condition_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar lotes
DROP POLICY IF EXISTS condition_import_batches_update ON public.condition_import_batches;
CREATE POLICY condition_import_batches_update ON public.condition_import_batches
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo ADMIN puede eliminar lotes
DROP POLICY IF EXISTS condition_import_batches_delete ON public.condition_import_batches;
CREATE POLICY condition_import_batches_delete ON public.condition_import_batches
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- -----------------------------------------------------------
-- 6. Row-Level Security: condition_import_rows
-- -----------------------------------------------------------
ALTER TABLE public.condition_import_rows ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede ver filas
DROP POLICY IF EXISTS condition_import_rows_select ON public.condition_import_rows;
CREATE POLICY condition_import_rows_select ON public.condition_import_rows
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden insertar filas
DROP POLICY IF EXISTS condition_import_rows_insert ON public.condition_import_rows;
CREATE POLICY condition_import_rows_insert ON public.condition_import_rows
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar filas
DROP POLICY IF EXISTS condition_import_rows_update ON public.condition_import_rows;
CREATE POLICY condition_import_rows_update ON public.condition_import_rows
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo ADMIN puede eliminar filas
DROP POLICY IF EXISTS condition_import_rows_delete ON public.condition_import_rows;
CREATE POLICY condition_import_rows_delete ON public.condition_import_rows
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
