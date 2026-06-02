-- ============================================================
-- MIGRATION: condition_ingest_schema — Ventanas y Feature Values de Condición
-- Change: condition-monitoring-base-metrology (PR 1c)
-- ============================================================
-- Crea las tablas de ingesta de datos de condición:
--   condition_windows        — ventanas de tiempo para ingesta batch
--   condition_feature_values — valores de features con trazabilidad completa
--
-- Idempotente: usa CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS + CREATE POLICY, COMMENT ON.
--
-- Dependencias:
--   condition_feature_definitions (FK feature_definition_id)
--   condition_analysis_methods  (catálogo, soft validation en EF)
--   condition_source_capabilities (validación de fuente en EF)
--
-- RLS:
--   SELECT → authenticated (todos los roles)
--   INSERT → authenticated (Edge Functions usan service_role, bypass RLS)
--   UPDATE/DELETE → ADMIN solamente
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_windows
--    Ventanas de tiempo para ingesta batch de features de condición.
--    external_window_id es único — el edge garantiza la idempotencia.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_window_id TEXT UNIQUE NOT NULL,
  asset_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  pipeline_version TEXT,
  config_version TEXT,
  operational_context JSONB DEFAULT '{}',
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'processed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_windows
  IS 'Ventanas de tiempo para ingesta batch de features de condición';

COMMENT ON COLUMN public.condition_windows.external_window_id
  IS 'ID único externo de la ventana (edge_id:asset_id:timestamp:version)';

COMMENT ON COLUMN public.condition_windows.asset_id
  IS 'Referencia al activo monitoreado';

COMMENT ON COLUMN public.condition_windows.source_id
  IS 'Identificador de la fuente que envió esta ventana';

COMMENT ON COLUMN public.condition_windows.source_type
  IS 'Tipo de fuente de datos (edge, manual, scada, etc.)';

COMMENT ON COLUMN public.condition_windows.window_start
  IS 'Timestamp de inicio de la ventana de medición';

COMMENT ON COLUMN public.condition_windows.window_end
  IS 'Timestamp de fin de la ventana de medición';

COMMENT ON COLUMN public.condition_windows.pipeline_version
  IS 'Versión del pipeline de procesamiento en el edge';

COMMENT ON COLUMN public.condition_windows.config_version
  IS 'Versión de la configuración del edge al momento de la medición';

COMMENT ON COLUMN public.condition_windows.operational_context
  IS 'Contexto operacional: regime, rpm, load_pct, etc. (JSONB)';

COMMENT ON COLUMN public.condition_windows.status
  IS 'Estado de procesamiento: received → processed | rejected';

COMMENT ON COLUMN public.condition_windows.created_at
  IS 'Fecha de creación del registro en el CMMS';

-- ============================================================
-- 2. ÍNDICES: condition_windows
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_windows_asset
  ON public.condition_windows(asset_id);

CREATE INDEX IF NOT EXISTS idx_windows_source
  ON public.condition_windows(source_id);

CREATE INDEX IF NOT EXISTS idx_windows_start
  ON public.condition_windows(window_start);

CREATE INDEX IF NOT EXISTS idx_windows_status
  ON public.condition_windows(status);

-- ============================================================
-- 3. TABLA: condition_feature_values
--    Valores de features de condición con trazabilidad completa
--    de método, calidad, parámetros e incertidumbre.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_feature_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id UUID NOT NULL REFERENCES public.condition_windows(id) ON DELETE CASCADE,
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  quality_flag TEXT NOT NULL CHECK (quality_flag IN ('G0', 'G1', 'G2', 'G3')),
  method_key TEXT NOT NULL,
  method_version TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  uncertainty NUMERIC,
  confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  measurement_point_id TEXT,
  sample_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_feature_values
  IS 'Valores de features de condición con trazabilidad completa de método y calidad';

COMMENT ON COLUMN public.condition_feature_values.window_id
  IS 'FK a condition_windows — ventana de tiempo a la que pertenece este valor';

COMMENT ON COLUMN public.condition_feature_values.feature_definition_id
  IS 'FK a condition_feature_definitions — definición del feature medido';

COMMENT ON COLUMN public.condition_feature_values.value
  IS 'Valor numérico del feature (ej: 3.2 mm/s, 55.0 °C)';

COMMENT ON COLUMN public.condition_feature_values.unit
  IS 'Unidad de medida del valor (ej: mm/s, °C, bar)';

COMMENT ON COLUMN public.condition_feature_values.quality_flag
  IS 'Calidad del dato: G0=excelente, G1=buena, G2=aceptable, G3=no confiable';

COMMENT ON COLUMN public.condition_feature_values.method_key
  IS 'Método de cálculo usado (soft validation: verificado en Edge Function, no FK)';

COMMENT ON COLUMN public.condition_feature_values.method_version
  IS 'Versión del método usado (obligatorio, trazabilidad)';

COMMENT ON COLUMN public.condition_feature_values.parameters
  IS 'Parámetros usados por el método de cálculo (JSONB)';

COMMENT ON COLUMN public.condition_feature_values.uncertainty
  IS 'Incertidumbre declarada por la fuente (si está disponible)';

COMMENT ON COLUMN public.condition_feature_values.confidence
  IS 'Confianza del método en este valor [0.0, 1.0] — DEFAULT 1.0';

COMMENT ON COLUMN public.condition_feature_values.measurement_point_id
  IS 'Punto de medición físico en el activo';

COMMENT ON COLUMN public.condition_feature_values.sample_count
  IS 'Cantidad de muestras crudas usadas en la ventana para calcular este valor';

COMMENT ON COLUMN public.condition_feature_values.created_at
  IS 'Fecha de creación del registro en el CMMS';

-- ============================================================
-- 4. ÍNDICES: condition_feature_values
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fv_window
  ON public.condition_feature_values(window_id);

CREATE INDEX IF NOT EXISTS idx_fv_feature
  ON public.condition_feature_values(feature_definition_id);

CREATE INDEX IF NOT EXISTS idx_fv_quality
  ON public.condition_feature_values(quality_flag);

CREATE INDEX IF NOT EXISTS idx_fv_method
  ON public.condition_feature_values(method_key);

-- ============================================================
-- 5. ROW-LEVEL SECURITY: condition_windows
-- ============================================================
ALTER TABLE public.condition_windows ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer ventanas
DROP POLICY IF EXISTS condition_windows_select ON public.condition_windows;
CREATE POLICY condition_windows_select ON public.condition_windows
  FOR SELECT TO authenticated USING (true);

-- INSERT: cualquier usuario autenticado puede insertar (Edge Functions usan service_role)
DROP POLICY IF EXISTS condition_windows_insert ON public.condition_windows;
CREATE POLICY condition_windows_insert ON public.condition_windows
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: solo ADMIN puede modificar ventanas
DROP POLICY IF EXISTS condition_windows_update ON public.condition_windows;
CREATE POLICY condition_windows_update ON public.condition_windows
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- DELETE: solo ADMIN puede eliminar ventanas
DROP POLICY IF EXISTS condition_windows_delete ON public.condition_windows;
CREATE POLICY condition_windows_delete ON public.condition_windows
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 6. ROW-LEVEL SECURITY: condition_feature_values
-- ============================================================
ALTER TABLE public.condition_feature_values ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer feature values
DROP POLICY IF EXISTS condition_feature_values_select ON public.condition_feature_values;
CREATE POLICY condition_feature_values_select ON public.condition_feature_values
  FOR SELECT TO authenticated USING (true);

-- INSERT: cualquier usuario autenticado puede insertar (Edge Functions usan service_role)
DROP POLICY IF EXISTS condition_feature_values_insert ON public.condition_feature_values;
CREATE POLICY condition_feature_values_insert ON public.condition_feature_values
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: solo ADMIN puede modificar feature values
DROP POLICY IF EXISTS condition_feature_values_update ON public.condition_feature_values;
CREATE POLICY condition_feature_values_update ON public.condition_feature_values
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- DELETE: solo ADMIN puede eliminar feature values
DROP POLICY IF EXISTS condition_feature_values_delete ON public.condition_feature_values;
CREATE POLICY condition_feature_values_delete ON public.condition_feature_values
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
