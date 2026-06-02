-- ============================================================
-- MIGRATION: condition_sources — Registro y Gobierno de Fuentes
-- Change: condition-monitoring-hybrid-sources (PR 1)
-- ============================================================
-- Crea la tabla condition_sources para gobierno centralizado de
-- fuentes de datos de condición con lifecycle tracking y RLS.
--
-- Columnas: source_id (UNIQUE PK lógico), source_type (CHECK: edge,
--   manual, portable, csv, modbus, mqtt, api, scada), name, status
--   (draft→candidate→field_trial→active→disabled→deprecated),
--   asset_id (nullable), owner, last_seen_at, validation_status
--   (draft→candidate→bench_validated→field_trial→active→deprecated→rejected),
--   late_event_cutoff_hours (DEFAULT 24), created_by, created_at,
--   updated_at.
--
-- Índices: source_type, status, asset_id, last_seen_at DESC,
--   validation_status.
--
-- Seeds: ≥5 fuentes (edge_001, manual_route_001, csv_import,
--   mock_source, portable_01) con status variados.
--
-- RLS: SELECT→auth, INSERT/UPDATE→PLANNER+ADMIN, DELETE→ADMIN.
--
-- Dependencias: get_user_role() definida en migración de RBAC.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Tabla: condition_sources
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT UNIQUE NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'edge', 'manual', 'portable', 'csv', 'modbus', 'mqtt', 'api', 'scada'
  )),
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'candidate', 'field_trial', 'active', 'disabled', 'deprecated'
  )),
  asset_id TEXT,
  owner TEXT,
  last_seen_at TIMESTAMPTZ,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  late_event_cutoff_hours INTEGER DEFAULT 24,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_sources
  IS 'Registro y gobierno de fuentes de datos de condición con lifecycle tracking';

COMMENT ON COLUMN public.condition_sources.source_id
  IS 'Identificador único lógico de la fuente (ej: edge_001, manual_route_001)';

COMMENT ON COLUMN public.condition_sources.source_type
  IS 'Tipo de fuente: edge, manual, portable, csv, modbus, mqtt, api, scada';

COMMENT ON COLUMN public.condition_sources.name
  IS 'Nombre descriptivo legible de la fuente';

COMMENT ON COLUMN public.condition_sources.status
  IS 'Estado operativo: draft → candidate → field_trial → active → disabled → deprecated';

COMMENT ON COLUMN public.condition_sources.asset_id
  IS 'Referencia al activo asociado con esta fuente (NULL si multi-activo)';

COMMENT ON COLUMN public.condition_sources.owner
  IS 'Responsable de la fuente (usuario o equipo)';

COMMENT ON COLUMN public.condition_sources.last_seen_at
  IS 'Timestamp de la última ingesta exitosa desde esta fuente';

COMMENT ON COLUMN public.condition_sources.validation_status
  IS 'Ciclo de validación: draft → candidate → bench_validated → field_trial → active → deprecated → rejected';

COMMENT ON COLUMN public.condition_sources.late_event_cutoff_hours
  IS 'Horas máximas de retraso para generar eventos (0=nunca, default 24h)';

COMMENT ON COLUMN public.condition_sources.created_by
  IS 'Usuario que registró la fuente en el sistema';

COMMENT ON COLUMN public.condition_sources.created_at
  IS 'Fecha de creación del registro';

COMMENT ON COLUMN public.condition_sources.updated_at
  IS 'Fecha de última actualización del registro';

-- -----------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sources_type
  ON public.condition_sources(source_type);

CREATE INDEX IF NOT EXISTS idx_sources_status
  ON public.condition_sources(status);

CREATE INDEX IF NOT EXISTS idx_sources_asset
  ON public.condition_sources(asset_id);

CREATE INDEX IF NOT EXISTS idx_sources_last_seen
  ON public.condition_sources(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_sources_validation
  ON public.condition_sources(validation_status);

-- -----------------------------------------------------------
-- 3. Row-Level Security
-- -----------------------------------------------------------
ALTER TABLE public.condition_sources ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede ver fuentes
DROP POLICY IF EXISTS condition_sources_select ON public.condition_sources;
CREATE POLICY condition_sources_select ON public.condition_sources
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden registrar nuevas fuentes
DROP POLICY IF EXISTS condition_sources_insert ON public.condition_sources;
CREATE POLICY condition_sources_insert ON public.condition_sources
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar fuentes
DROP POLICY IF EXISTS condition_sources_update ON public.condition_sources;
CREATE POLICY condition_sources_update ON public.condition_sources
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo ADMIN puede eliminar fuentes
DROP POLICY IF EXISTS condition_sources_delete ON public.condition_sources;
CREATE POLICY condition_sources_delete ON public.condition_sources
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- -----------------------------------------------------------
-- 4. Datos Semilla: ≥5 fuentes
-- -----------------------------------------------------------
INSERT INTO public.condition_sources
  (source_id, source_type, name, status, asset_id, owner, late_event_cutoff_hours, created_by)
VALUES
  ('edge_001',            'edge',     'Sensor Vibración Banda TR-01',        'active',      'BANDA-TR-01', 'ing-mantenimiento', 24, 'admin'),
  ('manual_route_001',    'manual',   'Ruta Inspección Operador Turno A',    'active',      NULL,          'sup-turno-a',        0, 'admin'),
  ('csv_import',          'csv',      'Importación CSV Histórico',           'candidate',   NULL,          'planner',            0, 'admin'),
  ('mock_source',         'api',      'Mock Source Desarrollo',              'field_trial', NULL,          'dev-team',          24, 'admin'),
  ('portable_01',         'portable', 'Analizador Portátil Vibraciones TI-1','field_trial', NULL,          'inspector',         24, 'admin')
ON CONFLICT (source_id) DO NOTHING;
