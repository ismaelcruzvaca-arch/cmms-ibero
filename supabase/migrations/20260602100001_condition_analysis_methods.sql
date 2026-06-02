-- ============================================================
-- MIGRATION: condition_analysis_methods — Catálogo de Métodos de Análisis
-- Change: condition-monitoring-base-metrology (PR 1a)
-- ============================================================
-- Crea la tabla condition_analysis_methods con 12 métodos
-- semilla para procesamiento de señales de condición.
--
-- Columnas: method_key (unique), category (CHECK: time_domain,
--   frequency_domain, statistical, model_based, hybrid),
--   input_features, output_features, default_parameters (JSONB),
--   validation_status (ciclo de vida: draft → candidate →
--   bench_validated → field_trial → active → deprecated).
--
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE para PLANNER/ADMIN
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_analysis_methods
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_analysis_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_key TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'time_domain', 'frequency_domain', 'statistical', 'model_based', 'hybrid'
  )),
  input_features TEXT[] DEFAULT '{}',
  output_features TEXT[] DEFAULT '{}',
  default_parameters JSONB DEFAULT '{}',
  description TEXT,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_analysis_methods IS 'Catálogo de métodos científicos de análisis de condición';
COMMENT ON COLUMN public.condition_analysis_methods.method_key IS 'Clave única del método (ej: rms_velocity_window, fft_band_energy)';
COMMENT ON COLUMN public.condition_analysis_methods.category IS 'Categoría del método: time_domain, frequency_domain, statistical, model_based, hybrid';
COMMENT ON COLUMN public.condition_analysis_methods.input_features IS 'Feature keys de entrada requeridos por el método';
COMMENT ON COLUMN public.condition_analysis_methods.output_features IS 'Feature keys de salida producidos por el método';
COMMENT ON COLUMN public.condition_analysis_methods.default_parameters IS 'Parámetros por defecto del método en JSONB';
COMMENT ON COLUMN public.condition_analysis_methods.description IS 'Descripción del método de análisis';
COMMENT ON COLUMN public.condition_analysis_methods.validation_status IS 'Ciclo de vida: draft → candidate → bench_validated → field_trial → active → deprecated';
COMMENT ON COLUMN public.condition_analysis_methods.created_at IS 'Fecha de creación del registro en catálogo';

-- -----------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_methods_key
  ON public.condition_analysis_methods(method_key);

CREATE INDEX IF NOT EXISTS idx_methods_validation
  ON public.condition_analysis_methods(validation_status);

-- -----------------------------------------------------------
-- 3. Seed Data: 12 métodos semilla
-- -----------------------------------------------------------
INSERT INTO public.condition_analysis_methods
  (method_key, category, input_features, output_features, default_parameters, description, validation_status)
VALUES
  -- Time Domain (4 métodos)
  ('rms_velocity_window',     'time_domain',
    ARRAY['vibration.raw'],
    ARRAY['vibration.rms'],
    '{"window_s": 1.0, "filter": "10-1000Hz"}',
    'RMS de velocidad en ventana temporal (10-1000 Hz)',
    'bench_validated'),

  ('rms_acceleration_window', 'time_domain',
    ARRAY['vibration.raw'],
    ARRAY['vibration.acceleration_rms'],
    '{"window_s": 1.0, "filter": "10-5000Hz"}',
    'RMS de aceleración en ventana temporal (10-5000 Hz)',
    'bench_validated'),

  ('peak',                    'time_domain',
    ARRAY['vibration.raw'],
    ARRAY['vibration.peak'],
    '{"window_s": 1.0}',
    'Detección de valor pico en ventana temporal',
    'candidate'),

  ('crest_factor',            'statistical',
    ARRAY['vibration.raw'],
    ARRAY['vibration.crest_factor'],
    '{"window_s": 1.0}',
    'Factor de cresta (peak/RMS) — indicador de impulsividad',
    'candidate'),

  -- Frequency Domain (2 métodos)
  ('fft_band_energy',         'frequency_domain',
    ARRAY['vibration.raw'],
    ARRAY['vibration.band_1x'],
    '{"bands": [{"low": 10, "high": 1000}], "window": "hanning"}',
    'Energía por banda espectral FFT con ventana Hanning',
    'bench_validated'),

  ('hilbert_envelope',        'frequency_domain',
    ARRAY['vibration.raw'],
    ARRAY['vibration.envelope'],
    '{"filter_band": [500, 5000]}',
    'Envolvente de Hilbert para detección de fallas en rodamientos',
    'bench_validated'),

  -- Statistical (2 métodos)
  ('linear_regression',       'statistical',
    ARRAY['vibration.rms'],
    ARRAY['trend.slope', 'trend.r2'],
    '{"window_hours": 168, "min_points": 5}',
    'Regresión lineal sobre serie temporal (168h) para detección de tendencias',
    'candidate'),

  ('window_average',          'statistical',
    ARRAY['temperature.bearing'],
    ARRAY['temperature.bearing'],
    '{"window_s": 60}',
    'Promedio móvil en ventana temporal (60s)',
    'candidate'),

  -- Model Based (2 métodos)
  ('kalman_filter',           'model_based',
    ARRAY['vibration.rms'],
    ARRAY['state.estimate'],
    '{"Q": 0.01, "R": 0.1}',
    'Filtro de Kalman para estimación de estado (placeholder Phase 2)',
    'draft'),

  ('model_residual',          'model_based',
    ARRAY['state.estimate', 'vibration.rms'],
    ARRAY['residual.value'],
    '{"threshold": 2.0}',
    'Residual entre modelo de estado y medición real',
    'candidate'),

  -- Hybrid (2 métodos)
  ('manual_observation',      'hybrid',
    ARRAY['manual.noise_score', 'manual.visual_condition_score'],
    ARRAY['manual.composite'],
    '{}',
    'Observación manual del operador (inspección sensorial)',
    'active'),

  ('weighted_health_index',   'hybrid',
    ARRAY['vibration.rms', 'temperature.bearing', 'pressure.suction', 'pressure.discharge'],
    ARRAY['health_index'],
    '{"zone_weights": {"A": 1.0, "B": 0.7, "C": 0.2, "D": 0.0}, "quality_modifiers": {"G0": 1.0, "G1": 0.8, "G2": 0.5, "G3": 0.0}}',
    'Índice de salud ponderado multi-feature con zonas ISO y modificadores de calidad',
    'candidate')
ON CONFLICT (method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 4. Row-Level Security
-- -----------------------------------------------------------
ALTER TABLE public.condition_analysis_methods ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer el catálogo
DROP POLICY IF EXISTS condition_analysis_methods_select ON public.condition_analysis_methods;
CREATE POLICY condition_analysis_methods_select ON public.condition_analysis_methods
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden agregar métodos
DROP POLICY IF EXISTS condition_analysis_methods_insert ON public.condition_analysis_methods;
CREATE POLICY condition_analysis_methods_insert ON public.condition_analysis_methods
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar
DROP POLICY IF EXISTS condition_analysis_methods_update ON public.condition_analysis_methods;
CREATE POLICY condition_analysis_methods_update ON public.condition_analysis_methods
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo PLANNER y ADMIN pueden eliminar
DROP POLICY IF EXISTS condition_analysis_methods_delete ON public.condition_analysis_methods;
CREATE POLICY condition_analysis_methods_delete ON public.condition_analysis_methods
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));
