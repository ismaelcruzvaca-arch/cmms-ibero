-- ============================================================
-- MIGRATION: condition_threshold_catalog — Catálogo de Umbrales de Condición
-- Change: condition-monitoring-base-metrology (PR 1b)
-- ============================================================
-- Crea la tabla condition_threshold_catalog con umbrales ISO
-- 10816/20816 contextualizados por activo, feature, método y
-- régimen operativo.
--
-- Columnas: feature_definition_id (FK), method_key (CRITICAL G1 fix:
--   parte del UNIQUE constraint + FK a analysis_methods),
--   asset_class, power_range_min/max, mounting_type, regime
--   (CHECK: STOPPED..OVERLOAD), measurement_location, zone_a/b/c/d_max,
--   unit, severity (CHECK: info, warning, critical), iso_standard,
--   standard_reference, validity_notes, validation_status.
--
-- Datos semilla: ISO 10816-7 (centrifugal_pump), ISO 10816-3
--   (electric_motor, centrifugal_fan), ISO 20816-3
--   (centrifugal_compressor) — 4 asset_classes × 2 mountings
--   (rigid + flexible) + generic fallback (9 filas).
--
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE para PLANNER/ADMIN
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_threshold_catalog
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_threshold_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  asset_class TEXT,
  power_range_min NUMERIC,
  power_range_max NUMERIC,
  mounting_type TEXT CHECK (mounting_type IN ('RIGID', 'FLEXIBLE')),
  regime TEXT NOT NULL CHECK (regime IN (
    'STOPPED', 'STARTUP', 'IDLE', 'PARTIAL_LOAD', 'FULL_LOAD', 'OVERLOAD'
  )),
  measurement_location TEXT,
  zone_a_max NUMERIC NOT NULL,
  zone_b_max NUMERIC NOT NULL,
  zone_c_max NUMERIC NOT NULL,
  zone_d_max NUMERIC,
  unit TEXT NOT NULL,
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  iso_standard TEXT NOT NULL,
  standard_reference TEXT,
  validity_notes TEXT,
  validation_status TEXT DEFAULT 'bench_validated' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feature_definition_id, method_key, asset_class, regime, measurement_location)
);

COMMENT ON TABLE public.condition_threshold_catalog IS 'Catálogo de umbrales ISO 10816/20816 contextualizados por activo, feature, método y régimen';
COMMENT ON COLUMN public.condition_threshold_catalog.feature_definition_id IS 'Feature de condición asociado (FK → condition_feature_definitions)';
COMMENT ON COLUMN public.condition_threshold_catalog.method_key IS 'Método de análisis asociado (FK → condition_analysis_methods). CRITICAL G1 fix: parte del UNIQUE constraint.';
COMMENT ON COLUMN public.condition_threshold_catalog.asset_class IS 'Clase de activo (ej: centrifugal_pump, electric_motor). NULL = umbral genérico fallback.';
COMMENT ON COLUMN public.condition_threshold_catalog.power_range_min IS 'Rango inferior de potencia en kW (opcional, para filtrado contextual)';
COMMENT ON COLUMN public.condition_threshold_catalog.power_range_max IS 'Rango superior de potencia en kW (opcional)';
COMMENT ON COLUMN public.condition_threshold_catalog.mounting_type IS 'Tipo de montaje: RIGID o FLEXIBLE (influye en umbrales ISO)';
COMMENT ON COLUMN public.condition_threshold_catalog.regime IS 'Régimen operativo: STOPPED, STARTUP, IDLE, PARTIAL_LOAD, FULL_LOAD, OVERLOAD';
COMMENT ON COLUMN public.condition_threshold_catalog.measurement_location IS 'Punto de medición físico (ej: motor_de, pump_de)';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_a_max IS 'Límite superior zona A (buena condición). Valores ≤ zone_a_max = zona A';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_b_max IS 'Límite superior zona B (condición aceptable). Valores entre zone_a_max y zone_b_max = zona B';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_c_max IS 'Límite superior zona C (alerta). Valores > zone_c_max = zona D (crítica)';
COMMENT ON COLUMN public.condition_threshold_catalog.zone_d_max IS 'Límite superior zona D (opcional). NULL = sin límite superior definido';
COMMENT ON COLUMN public.condition_threshold_catalog.unit IS 'Unidad de medida del umbral (ej: mm/s, °C, bar)';
COMMENT ON COLUMN public.condition_threshold_catalog.severity IS 'Severidad del umbral: info, warning, critical';
COMMENT ON COLUMN public.condition_threshold_catalog.iso_standard IS 'Norma ISO de referencia (ej: ISO 10816-7, ISO 20816-3)';
COMMENT ON COLUMN public.condition_threshold_catalog.standard_reference IS 'Referencia específica dentro de la norma (tabla, sección)';
COMMENT ON COLUMN public.condition_threshold_catalog.validity_notes IS 'Notas sobre condiciones de validez del umbral';
COMMENT ON COLUMN public.condition_threshold_catalog.validation_status IS 'Ciclo de vida: draft → candidate → bench_validated → field_trial → active → deprecated';
COMMENT ON COLUMN public.condition_threshold_catalog.created_at IS 'Fecha de creación del registro';

-- -----------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_thr_feature
  ON public.condition_threshold_catalog(feature_definition_id);

CREATE INDEX IF NOT EXISTS idx_thr_method
  ON public.condition_threshold_catalog(method_key);

CREATE INDEX IF NOT EXISTS idx_thr_asset_class
  ON public.condition_threshold_catalog(asset_class);

CREATE INDEX IF NOT EXISTS idx_thr_regime
  ON public.condition_threshold_catalog(regime);

CREATE INDEX IF NOT EXISTS idx_thr_validation
  ON public.condition_threshold_catalog(validation_status);

-- -----------------------------------------------------------
-- 3. Seed Data: ISO 10816/20816 — 4 asset_classes × 2 mountings + generic fallback
--    Todas las filas con validation_status = bench_validated
--    Todos los umbrales usan vibration.rms (feature) + rms_velocity_window (método)
-- -----------------------------------------------------------

-- ============================================================
-- centrifugal_pump (ISO 10816-7, Category II, >15kW)
-- ============================================================

-- centrifugal_pump, RIGID
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_pump', 'RIGID', 'FULL_LOAD',
  2.3, 4.5, 7.1, 'mm/s',
  'ISO 10816-7', 'Table A.1 — Category II, rigid', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- centrifugal_pump, FLEXIBLE
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_pump', 'FLEXIBLE', 'FULL_LOAD',
  3.5, 7.1, 11.0, 'mm/s',
  'ISO 10816-7', 'Table A.1 — Category II, flexible', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- ============================================================
-- electric_motor (ISO 10816-3, Group 2, 15-300kW)
-- ============================================================

-- electric_motor, RIGID
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'electric_motor', 'RIGID', 'FULL_LOAD',
  1.4, 2.8, 4.5, 'mm/s',
  'ISO 10816-3', 'Table 3 — Group 2, rigid, 15-300kW', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- electric_motor, FLEXIBLE
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'electric_motor', 'FLEXIBLE', 'FULL_LOAD',
  2.3, 4.5, 7.1, 'mm/s',
  'ISO 10816-3', 'Table 4 — Group 2, flexible, 15-300kW', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- ============================================================
-- centrifugal_fan (ISO 10816-3, Group 1, >300kW)
-- ============================================================

-- centrifugal_fan, RIGID
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_fan', 'RIGID', 'FULL_LOAD',
  2.3, 4.5, 7.1, 'mm/s',
  'ISO 10816-3', 'Table 1 — Group 1, rigid, >300kW', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- centrifugal_fan, FLEXIBLE
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_fan', 'FLEXIBLE', 'FULL_LOAD',
  3.5, 7.1, 11.0, 'mm/s',
  'ISO 10816-3', 'Table 2 — Group 1, flexible, >300kW', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- ============================================================
-- centrifugal_compressor (ISO 20816-3, industrial)
-- ============================================================

-- centrifugal_compressor, RIGID
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_compressor', 'RIGID', 'FULL_LOAD',
  2.3, 4.5, 7.1, 'mm/s',
  'ISO 20816-3', 'Industrial compressors, rigid mounting', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- centrifugal_compressor, FLEXIBLE
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validation_status)
SELECT
  fd.id, 'rms_velocity_window', 'centrifugal_compressor', 'FLEXIBLE', 'FULL_LOAD',
  3.5, 7.1, 11.0, 'mm/s',
  'ISO 20816-3', 'Industrial compressors, flexible mounting', 'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- ============================================================
-- Generic fallback (ISO 10816-1) — asset_class=NULL
--    Umbral conservador usado cuando no hay datos específicos de la clase
-- ============================================================
INSERT INTO public.condition_threshold_catalog
  (feature_definition_id, method_key, asset_class, mounting_type, regime,
   zone_a_max, zone_b_max, zone_c_max, unit,
   iso_standard, standard_reference, validity_notes, validation_status)
SELECT
  fd.id, 'rms_velocity_window', NULL, 'RIGID', 'FULL_LOAD',
  1.8, 4.5, 7.1, 'mm/s',
  'ISO 10816-1', 'General evaluation criteria',
  'Umbral genérico conservador. Usar como fallback cuando no hay datos específicos de la clase de activo.',
  'bench_validated'
FROM public.condition_feature_definitions fd
WHERE fd.feature_key = 'vibration.rms'
ON CONFLICT (feature_definition_id, method_key, asset_class, regime, measurement_location) DO NOTHING;

-- -----------------------------------------------------------
-- 4. Row-Level Security
-- -----------------------------------------------------------
ALTER TABLE public.condition_threshold_catalog ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer el catálogo de umbrales
DROP POLICY IF EXISTS condition_threshold_catalog_select ON public.condition_threshold_catalog;
CREATE POLICY condition_threshold_catalog_select ON public.condition_threshold_catalog
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden agregar umbrales
DROP POLICY IF EXISTS condition_threshold_catalog_insert ON public.condition_threshold_catalog;
CREATE POLICY condition_threshold_catalog_insert ON public.condition_threshold_catalog
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar
DROP POLICY IF EXISTS condition_threshold_catalog_update ON public.condition_threshold_catalog;
CREATE POLICY condition_threshold_catalog_update ON public.condition_threshold_catalog
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo PLANNER y ADMIN pueden eliminar
DROP POLICY IF EXISTS condition_threshold_catalog_delete ON public.condition_threshold_catalog;
CREATE POLICY condition_threshold_catalog_delete ON public.condition_threshold_catalog
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));
