-- ============================================================
-- MIGRATION: condition_extended_capabilities — Capacidades Multi-Feature
-- Change: condition-monitoring-hybrid-sources (PR 2 Slice 2a)
-- ============================================================
-- Extiende condition_source_capabilities con nuevas capacidades
-- multi-feature para fuentes existentes y nuevas fuentes (csv_import,
-- portable_01, mock_source).
--
-- Agrega:
--   edge_001: +vibration.peak (peak), +temperature.bearing (window_average)
--   manual_route_001: +manual.noise_score, +manual.temperature_reading
--   mock_source: +vibration.rms (rms_velocity_window)
--   csv_import: capacidades genéricas de importación
--   portable_01: capacidades de analizador portátil
--
-- Idempotente: usa ON CONFLICT (source_id, can_produce, method_key) DO NOTHING.
-- Dependencias: condition_source_capabilities, condition_analysis_methods
--   deben existir (migraciones PR1 ya aplicadas).
-- ============================================================

-- -----------------------------------------------------------
-- 1. edge_001: agregar vibration.peak + temperature.bearing
-- -----------------------------------------------------------

-- Capacidad: vibration.peak bajo método peak
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('edge_001', 'edge', 'vibration.peak', 'peak',
   25600, 'mm/s', 'G1', false,
   'active',
   'Sensor edge IoT — valor pico de vibración.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: temperature.bearing bajo método window_average
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('edge_001', 'edge', 'temperature.bearing', 'window_average',
   1, '°C', 'G1', false,
   'active',
   'Sensor edge IoT — temperatura de rodamiento con promedio móvil 60s.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 2. manual_route_001: agregar manual.noise_score + manual.temperature_reading
-- -----------------------------------------------------------

-- Capacidad: manual.noise_score bajo método manual_observation
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('manual_route_001', 'manual', 'manual.noise_score', 'manual_observation',
   NULL, 'score', 'G2', false,
   'active',
   'Ruta de inspección — puntaje de ruido ambiental.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: manual.temperature_reading bajo método manual_observation
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('manual_route_001', 'manual', 'manual.temperature_reading', 'manual_observation',
   NULL, '°C', 'G2', false,
   'active',
   'Ruta de inspección — lectura manual de temperatura.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 3. mock_source: vibration.rms capability (source_id = 'mock_source')
-- -----------------------------------------------------------
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('mock_source', 'api', 'vibration.rms', 'rms_velocity_window',
   1000, 'mm/s', 'G2', false,
   'candidate',
   'Mock source desarrollo — datos simulados de vibración RMS.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 4. csv_import: capacidades genéricas de importación (candidate)
-- -----------------------------------------------------------

-- Capacidad: vibration.rms vía CSV
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('csv_import', 'csv', 'vibration.rms', 'rms_velocity_window',
   NULL, 'mm/s', 'G2', false,
   'candidate',
   'CSV import — vibration.rms desde archivo histórico.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: vibration.peak vía CSV
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('csv_import', 'csv', 'vibration.peak', 'peak',
   NULL, 'mm/s', 'G2', false,
   'candidate',
   'CSV import — vibration.peak desde archivo histórico.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: temperature.bearing vía CSV
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('csv_import', 'csv', 'temperature.bearing', 'window_average',
   NULL, '°C', 'G2', false,
   'candidate',
   'CSV import — temperatura de rodamiento desde archivo histórico.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: pressure.discharge vía CSV
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('csv_import', 'csv', 'pressure.discharge', 'window_average',
   NULL, 'bar', 'G2', false,
   'candidate',
   'CSV import — presión de descarga desde archivo histórico.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- -----------------------------------------------------------
-- 5. portable_01: capacidades de analizador portátil (field_trial)
-- -----------------------------------------------------------

-- Capacidad: vibration.rms vía analizador portátil
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('portable_01', 'portable', 'vibration.rms', 'rms_velocity_window',
   25600, 'mm/s', 'G1', true,
   'field_trial',
   'Analizador portátil vib-01 — RMS de velocidad.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: vibration.peak vía analizador portátil
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('portable_01', 'portable', 'vibration.peak', 'peak',
   25600, 'mm/s', 'G1', false,
   'field_trial',
   'Analizador portátil vib-01 — pico de vibración.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;

-- Capacidad: temperature.bearing vía analizador portátil
INSERT INTO public.condition_source_capabilities
  (source_id, source_type, can_produce, method_key,
   sample_rate_hz, unit, quality_expected, uncertainty_available,
   validation_status, notes)
VALUES
  ('portable_01', 'portable', 'temperature.bearing', 'window_average',
   1, '°C', 'G1', false,
   'field_trial',
   'Analizador portátil vib-01 con sensor térmico integrado.')
ON CONFLICT (source_id, can_produce, method_key) DO NOTHING;
