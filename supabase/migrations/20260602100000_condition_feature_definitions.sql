-- ============================================================
-- MIGRATION: condition_feature_definitions — Catálogo de Features de Condición
-- Change: condition-monitoring-base-metrology (PR 1a)
-- ============================================================
-- Crea/actualiza la tabla condition_feature_definitions con 12
-- features semilla para monitoreo de condición (ISO 13374 Bloque 3).
--
-- Idempotente: si la tabla ya existe (schema anterior), agrega
-- columnas faltantes (unit, default_weight) y backfillea datos.
--
-- Columnas: feature_key (unique), unit, category, description,
--           default_weight (para cálculo de Health Index).
--
-- RLS: SELECT para authenticated, INSERT/UPDATE/DELETE para PLANNER/ADMIN
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_feature_definitions (crear si no existe)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_feature_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key TEXT UNIQUE NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  default_weight NUMERIC DEFAULT 1.0 CHECK (default_weight >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_feature_definitions IS 'Catálogo EAV de features de condición medibles (ISO 13374)';
COMMENT ON COLUMN public.condition_feature_definitions.feature_key IS 'Clave única del feature (ej: vibration.rms, temperature.bearing)';
COMMENT ON COLUMN public.condition_feature_definitions.unit IS 'Unidad de medida del feature (ej: mm/s, °C, bar, score)';
COMMENT ON COLUMN public.condition_feature_definitions.category IS 'Categoría del feature (vibration, temperature, pressure, manual, etc.)';
COMMENT ON COLUMN public.condition_feature_definitions.description IS 'Descripción detallada del feature medible';
COMMENT ON COLUMN public.condition_feature_definitions.default_weight IS 'Peso por defecto en cálculo de Health Index (0 = excluido, >= 0)';
COMMENT ON COLUMN public.condition_feature_definitions.created_at IS 'Fecha de creación del registro en catálogo';

-- -----------------------------------------------------------
-- 1a. Actualizar schema si la tabla existía con columnas anteriores
--     Compatibilidad con schema previo: display_name, default_unit, weight, etc.
-- -----------------------------------------------------------
ALTER TABLE public.condition_feature_definitions
  ADD COLUMN IF NOT EXISTS unit TEXT;

ALTER TABLE public.condition_feature_definitions
  ADD COLUMN IF NOT EXISTS default_weight NUMERIC DEFAULT 1.0;

-- Backfill unit desde default_unit (schema anterior)
UPDATE public.condition_feature_definitions
  SET unit = COALESCE(default_unit, '')
  WHERE unit IS NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'condition_feature_definitions'
        AND column_name = 'default_unit'
    );

-- Backfill default_weight desde weight (schema anterior)
UPDATE public.condition_feature_definitions
  SET default_weight = COALESCE(weight, 1.0)
  WHERE default_weight IS NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'condition_feature_definitions'
        AND column_name = 'weight'
    );

-- CHECK constraint para default_weight >= 0
ALTER TABLE public.condition_feature_definitions
  DROP CONSTRAINT IF EXISTS check_default_weight_nonnegative;
ALTER TABLE public.condition_feature_definitions
  ADD CONSTRAINT check_default_weight_nonnegative CHECK (default_weight >= 0);

-- Asegurar unit NOT NULL (si no lo era ya)
DO $$
BEGIN
  ALTER TABLE public.condition_feature_definitions ALTER COLUMN unit SET NOT NULL;
EXCEPTION WHEN others THEN
  -- ya es NOT NULL, ignorar
END;
$$;

-- -----------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_feature_defs_key
  ON public.condition_feature_definitions(feature_key);

-- -----------------------------------------------------------
-- 3. Seed Data: 12 features semilla
--    NOTA: usa display_name si la columna existe (schema anterior la requiere NOT NULL)
-- -----------------------------------------------------------
DO $$
BEGIN
  -- Insertar con display_name si la columna existe
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'condition_feature_definitions'
      AND column_name = 'display_name'
  ) THEN
    INSERT INTO public.condition_feature_definitions
      (feature_key, unit, category, description, default_weight, display_name)
    VALUES
      ('vibration.rms',                 'mm/s',    'vibration',    'Velocidad RMS de vibración (10-1000 Hz)',         1.0, 'RMS Vibración'),
      ('vibration.peak',                'mm/s',    'vibration',    'Velocidad pico de vibración',                      0.8, 'Pico Vibración'),
      ('vibration.crest_factor',        'ratio',   'vibration',    'Factor de cresta de vibración (peak/RMS)',         0.6, 'Factor Cresta'),
      ('vibration.band_1x',             'mm/s',    'vibration',    'Energía en banda 1X (frecuencia de giro)',         0.7, 'Banda 1X'),
      ('temperature.bearing',           '°C',      'temperature',  'Temperatura de rodamiento',                        0.9, 'Temp. Rodamiento'),
      ('temperature.winding',           '°C',      'temperature',  'Temperatura de devanado del motor',                0.8, 'Temp. Devanado'),
      ('pressure.suction',              'bar',     'pressure',     'Presión de succión',                               0.6, 'Presión Succión'),
      ('pressure.discharge',            'bar',     'pressure',     'Presión de descarga',                              0.6, 'Presión Descarga'),
      ('manual.noise_score',            'score',   'manual',       'Puntaje de ruido (inspección manual)',             0.4, 'Puntaje Ruido'),
      ('manual.temperature_reading',    '°C',      'manual',       'Lectura manual de temperatura',                    0.4, 'Temp. Manual'),
      ('manual.visual_condition_score', 'score',   'manual',       'Puntaje visual de condición (inspección manual)',  0.4, 'Condición Visual'),
      ('manual.leak_detected',          'boolean', 'manual',       'Detección visual de fugas',                        0.3, 'Fugas Detectadas')
    ON CONFLICT (feature_key) DO NOTHING;
  ELSE
    -- Insertar sin display_name (tabla creada con schema nuevo)
    INSERT INTO public.condition_feature_definitions
      (feature_key, unit, category, description, default_weight)
    VALUES
      ('vibration.rms',                 'mm/s',    'vibration',    'Velocidad RMS de vibración (10-1000 Hz)',         1.0),
      ('vibration.peak',                'mm/s',    'vibration',    'Velocidad pico de vibración',                      0.8),
      ('vibration.crest_factor',        'ratio',   'vibration',    'Factor de cresta de vibración (peak/RMS)',         0.6),
      ('vibration.band_1x',             'mm/s',    'vibration',    'Energía en banda 1X (frecuencia de giro)',         0.7),
      ('temperature.bearing',           '°C',      'temperature',  'Temperatura de rodamiento',                        0.9),
      ('temperature.winding',           '°C',      'temperature',  'Temperatura de devanado del motor',                0.8),
      ('pressure.suction',              'bar',     'pressure',     'Presión de succión',                               0.6),
      ('pressure.discharge',            'bar',     'pressure',     'Presión de descarga',                              0.6),
      ('manual.noise_score',            'score',   'manual',       'Puntaje de ruido (inspección manual)',             0.4),
      ('manual.temperature_reading',    '°C',      'manual',       'Lectura manual de temperatura',                    0.4),
      ('manual.visual_condition_score', 'score',   'manual',       'Puntaje visual de condición (inspección manual)',  0.4),
      ('manual.leak_detected',          'boolean', 'manual',       'Detección visual de fugas',                        0.3)
    ON CONFLICT (feature_key) DO NOTHING;
  END IF;
END;
$$;

-- -----------------------------------------------------------
-- 4. Row-Level Security
-- -----------------------------------------------------------
ALTER TABLE public.condition_feature_definitions ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer el catálogo
DROP POLICY IF EXISTS condition_feature_definitions_select ON public.condition_feature_definitions;
CREATE POLICY condition_feature_definitions_select ON public.condition_feature_definitions
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden agregar features
DROP POLICY IF EXISTS condition_feature_definitions_insert ON public.condition_feature_definitions;
CREATE POLICY condition_feature_definitions_insert ON public.condition_feature_definitions
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar
DROP POLICY IF EXISTS condition_feature_definitions_update ON public.condition_feature_definitions;
CREATE POLICY condition_feature_definitions_update ON public.condition_feature_definitions
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo PLANNER y ADMIN pueden eliminar
DROP POLICY IF EXISTS condition_feature_definitions_delete ON public.condition_feature_definitions;
CREATE POLICY condition_feature_definitions_delete ON public.condition_feature_definitions
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));
