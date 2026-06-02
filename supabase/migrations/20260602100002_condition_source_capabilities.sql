-- ============================================================
-- MIGRATION: condition_source_capabilities — Capacidades de Fuente de Condición
-- Change: condition-monitoring-base-metrology (PR 1b)
-- ============================================================
-- Crea la tabla condition_source_capabilities para registrar qué
-- features puede producir cada fuente de datos, con qué método
-- de análisis, frecuencia de muestreo, calidad esperada y estado
-- de validación.
--
-- Columnas: source_id, source_type (CHECK: edge, manual, portable,
--   csv, modbus, mqtt, api, scada), can_produce (feature_key),
--   method_key (FK → condition_analysis_methods), sample_rate_hz,
--   unit, quality_expected (G0-G3), uncertainty_available,
--   validation_status (ciclo de vida), notes.
--
-- Restricciones: UNIQUE(source_id, can_produce, method_key),
--   FK method_key → condition_analysis_methods(method_key).
--
-- Datos semilla: edge_001 + manual_route_001 + mock_source_001
--
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE para PLANNER/ADMIN
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_source_capabilities
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_source_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'edge', 'manual', 'portable', 'csv', 'modbus', 'mqtt', 'api', 'scada'
  )),
  asset_id TEXT,
  can_produce TEXT NOT NULL,
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  sample_rate_hz NUMERIC,
  unit TEXT,
  quality_expected TEXT DEFAULT 'G0' CHECK (quality_expected IN ('G0', 'G1', 'G2', 'G3')),
  uncertainty_available BOOLEAN DEFAULT false,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, can_produce, method_key)
);

COMMENT ON TABLE public.condition_source_capabilities IS 'Capacidades declaradas por fuente: qué feature + método puede producir con qué calidad';
COMMENT ON COLUMN public.condition_source_capabilities.source_id IS 'Identificador único de la fuente de datos (ej: edge_001, manual_op_juan)';
COMMENT ON COLUMN public.condition_source_capabilities.source_type IS 'Tipo de fuente: edge, manual, portable, csv, modbus, mqtt, api, scada';
COMMENT ON COLUMN public.condition_source_capabilities.asset_id IS 'Referencia al activo asociado con esta fuente (si aplica)';
COMMENT ON COLUMN public.condition_source_capabilities.can_produce IS 'Feature key que la fuente puede producir (ej: vibration.rms, temperature.bearing)';
COMMENT ON COLUMN public.condition_source_capabilities.method_key IS 'Método de análisis usado (FK → condition_analysis_methods)';
COMMENT ON COLUMN public.condition_source_capabilities.sample_rate_hz IS 'Frecuencia de muestreo en Hz (NULL para fuentes manuales)';
COMMENT ON COLUMN public.condition_source_capabilities.unit IS 'Unidad de medida del feature producido';
COMMENT ON COLUMN public.condition_source_capabilities.quality_expected IS 'Calidad esperada: G0(excelente), G1(buena), G2(aceptable), G3(no confiable)';
COMMENT ON COLUMN public.condition_source_capabilities.uncertainty_available IS 'Indica si la fuente provee datos de incertidumbre de medición';
COMMENT ON COLUMN public.condition_source_capabilities.validation_status IS 'Ciclo de vida: draft → candidate → bench_validated → field_trial → active → deprecated';
COMMENT ON COLUMN public.condition_source_capabilities.notes IS 'Notas adicionales sobre la capacidad de la fuente';
COMMENT ON COLUMN public.condition_source_capabilities.created_at IS 'Fecha de creación del registro';

-- -----------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_scap_source
  ON public.condition_source_capabilities(source_id);

CREATE INDEX IF NOT EXISTS idx_scap_validation
  ON public.condition_source_capabilities(validation_status);

CREATE INDEX IF NOT EXISTS idx_scap_method
  ON public.condition_source_capabilities(method_key);

-- -----------------------------------------------------------
-- 3. Seed Data: ≥3 capacidades de fuente
-- -----------------------------------------------------------
-- Capacidad 1: edge_001 — sensor vibration.rms con método rms_velocity_window
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, asset_id, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('edge_001', 'edge', NULL, 'vibration.rms', 'rms_velocity_window',
   25600, 'mm/s', 'G0', true,
   'active',
   'Sensor edge IoT de vibración en bomba centrífuga principal. Muestreo 25.6 kHz, filtro 10-1000 Hz.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad 2: manual_route_001 — observación manual del operador
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, asset_id, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('manual_route_001', 'manual', NULL, 'manual.composite', 'manual_observation',
   NULL, 'score', 'G2', false,
   'active',
   'Ruta de inspección manual del operador — puntajes sensoriales combinados.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad 3: mock_source_001 — fuente de prueba para desarrollo (api)
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, asset_id, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('mock_source_001', 'api', NULL, 'vibration.rms', 'rms_velocity_window',
   1000, 'mm/s', 'G2', false,
   'candidate',
   'Fuente mock para desarrollo y testing de ingesta. Simula datos de vibración.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 4. Row-Level Security
-- -----------------------------------------------------------
ALTER TABLE public.condition_source_capabilities ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer capacidades
DROP POLICY IF EXISTS condition_source_capabilities_select ON public.condition_source_capabilities;
CREATE POLICY condition_source_capabilities_select ON public.condition_source_capabilities
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden registrar capacidades
DROP POLICY IF EXISTS condition_source_capabilities_insert ON public.condition_source_capabilities;
CREATE POLICY condition_source_capabilities_insert ON public.condition_source_capabilities
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar
DROP POLICY IF EXISTS condition_source_capabilities_update ON public.condition_source_capabilities;
CREATE POLICY condition_source_capabilities_update ON public.condition_source_capabilities
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo PLANNER y ADMIN pueden eliminar
DROP POLICY IF EXISTS condition_source_capabilities_delete ON public.condition_source_capabilities;
CREATE POLICY condition_source_capabilities_delete ON public.condition_source_capabilities
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));
