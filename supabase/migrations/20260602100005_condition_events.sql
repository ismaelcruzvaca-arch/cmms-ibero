-- ============================================================
-- MIGRATION: condition_events — Eventos de Condición y Fuentes
-- Change: condition-monitoring-base-metrology (PR 1d)
-- ============================================================
-- Crea las tablas de eventos de condición y fuentes de eventos:
--   condition_events        — registro de eventos de condición con ciclo de vida
--   condition_event_sources — vínculo entre eventos y los feature_values
--                             y/o analysis_results que los dispararon
--
-- La tabla condition_events preexistía con un esquema antiguo incompatible
-- (columnas: diagnosis, confidence, health_index, rul_estimate, etc.).
-- Se reemplaza completamente con el esquema del diseño (PR 1d).
--
-- Idempotente: usa DROP TABLE IF EXISTS CASCADE + CREATE TABLE,
--   CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--
-- Dependencias:
--   condition_feature_values (FK feature_value_id en condition_event_sources)
--   condition_analysis_results (FK analysis_result_id se agrega en PR 2; por ahora es UUID nullable)
--
-- RLS:
--   SELECT → authenticated (todos los roles pueden leer eventos)
--   INSERT → PLANNER, ADMIN (eventos manuales; Edge Functions usan service_role)
--   UPDATE/DELETE → ADMIN solamente
-- ============================================================

-- ============================================================
-- 0. Limpiar tabla preexistente con esquema antiguo
--    (0 rows, sin dependencias FK entrantes)
-- ============================================================
DROP TABLE IF EXISTS public.condition_events CASCADE;

-- ============================================================
-- 1. TABLA: condition_events
--    Registro de eventos de condición con ciclo de vida:
--    open → linked_to_wo → closed | dismissed
-- ============================================================
CREATE TABLE public.condition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  rule_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'threshold_exceeded', 'trend_detected', 'quality_degraded', 'manual'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  hi_value NUMERIC,
  dhi_dt_value NUMERIC,
  message TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN (
    'open', 'linked_to_wo', 'closed', 'dismissed'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_events
  IS 'Registro de eventos de condición con ciclo de vida open → linked_to_wo → closed/dismissed';

COMMENT ON COLUMN public.condition_events.asset_id
  IS 'Referencia al activo monitoreado que generó el evento';

COMMENT ON COLUMN public.condition_events.rule_id
  IS 'Regla que disparó el evento (FK a condition_rules agregado en PR 2)';

COMMENT ON COLUMN public.condition_events.event_type
  IS 'Tipo de evento: threshold_exceeded, trend_detected, quality_degraded, manual';

COMMENT ON COLUMN public.condition_events.severity
  IS 'Severidad del evento: info, warning, critical';

COMMENT ON COLUMN public.condition_events.hi_value
  IS 'Health Index del activo al momento del evento';

COMMENT ON COLUMN public.condition_events.dhi_dt_value
  IS 'Tasa de degradación (dHI/dt) al momento del evento';

COMMENT ON COLUMN public.condition_events.message
  IS 'Descripción legible del evento generada por el motor de reglas';

COMMENT ON COLUMN public.condition_events.status
  IS 'Ciclo de vida del evento: open → linked_to_wo → closed | dismissed';

COMMENT ON COLUMN public.condition_events.created_at
  IS 'Fecha de creación del evento';

COMMENT ON COLUMN public.condition_events.updated_at
  IS 'Fecha de última modificación del evento';

-- ============================================================
-- 2. ÍNDICES: condition_events
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_events_asset
  ON public.condition_events(asset_id);

CREATE INDEX IF NOT EXISTS idx_events_status
  ON public.condition_events(status);

CREATE INDEX IF NOT EXISTS idx_events_severity
  ON public.condition_events(severity);

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON public.condition_events(created_at);

-- ============================================================
-- 3. TABLA: condition_event_sources
--    Vincula eventos con los feature_values y/o analysis_results
--    que contribuyeron a dispararlos.
--    analysis_result_id es nullable — FK se agrega en PR 2 cuando
--    condition_analysis_results exista.
-- ============================================================
DROP TABLE IF EXISTS public.condition_event_sources CASCADE;

CREATE TABLE public.condition_event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.condition_events(id) ON DELETE CASCADE,
  feature_value_id UUID REFERENCES public.condition_feature_values(id),
  analysis_result_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (feature_value_id IS NOT NULL OR analysis_result_id IS NOT NULL)
);

COMMENT ON TABLE public.condition_event_sources
  IS 'Vincula eventos con los feature_values y/o analysis_results que los dispararon';

COMMENT ON COLUMN public.condition_event_sources.event_id
  IS 'FK a condition_events — evento al que pertenece esta fuente';

COMMENT ON COLUMN public.condition_event_sources.feature_value_id
  IS 'FK a condition_feature_values — feature value que contribuyó al evento (si aplica)';

COMMENT ON COLUMN public.condition_event_sources.analysis_result_id
  IS 'FK a condition_analysis_results (PR 2) — resultado de análisis que contribuyó al evento (si aplica)';

COMMENT ON COLUMN public.condition_event_sources.created_at
  IS 'Fecha de creación del vínculo';

-- ============================================================
-- 4. ÍNDICES: condition_event_sources
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_es_event
  ON public.condition_event_sources(event_id);

CREATE INDEX IF NOT EXISTS idx_es_feature
  ON public.condition_event_sources(feature_value_id);

-- Índices únicos parciales: un evento no puede vincularse dos veces
-- al mismo feature_value_id o analysis_result_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_es_event_feature_unique
  ON public.condition_event_sources(event_id, feature_value_id)
  WHERE feature_value_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_es_event_analysis_unique
  ON public.condition_event_sources(event_id, analysis_result_id)
  WHERE analysis_result_id IS NOT NULL;

-- ============================================================
-- 5. TRIGGER: actualización automática de updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.tgr_condition_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_condition_events_updated_at ON public.condition_events;
CREATE TRIGGER trg_condition_events_updated_at
  BEFORE UPDATE ON public.condition_events
  FOR EACH ROW
  EXECUTE FUNCTION public.tgr_condition_events_updated_at();

-- ============================================================
-- 6. ROW-LEVEL SECURITY: condition_events
-- ============================================================
ALTER TABLE public.condition_events ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer eventos
DROP POLICY IF EXISTS condition_events_select ON public.condition_events;
CREATE POLICY condition_events_select ON public.condition_events
  FOR SELECT TO authenticated USING (true);

-- INSERT: PLANNER y ADMIN pueden crear eventos manualmente
-- (Edge Functions usan service_role y bypass RLS)
DROP POLICY IF EXISTS condition_events_insert ON public.condition_events;
CREATE POLICY condition_events_insert ON public.condition_events
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo ADMIN puede modificar eventos
DROP POLICY IF EXISTS condition_events_update ON public.condition_events;
CREATE POLICY condition_events_update ON public.condition_events
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- DELETE: solo ADMIN puede eliminar eventos
DROP POLICY IF EXISTS condition_events_delete ON public.condition_events;
CREATE POLICY condition_events_delete ON public.condition_events
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 7. ROW-LEVEL SECURITY: condition_event_sources
-- ============================================================
ALTER TABLE public.condition_event_sources ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer fuentes de eventos
DROP POLICY IF EXISTS condition_event_sources_select ON public.condition_event_sources;
CREATE POLICY condition_event_sources_select ON public.condition_event_sources
  FOR SELECT TO authenticated USING (true);

-- INSERT: PLANNER y ADMIN pueden crear vínculos manualmente
DROP POLICY IF EXISTS condition_event_sources_insert ON public.condition_event_sources;
CREATE POLICY condition_event_sources_insert ON public.condition_event_sources
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo ADMIN puede modificar fuentes de eventos
DROP POLICY IF EXISTS condition_event_sources_update ON public.condition_event_sources;
CREATE POLICY condition_event_sources_update ON public.condition_event_sources
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- DELETE: solo ADMIN puede eliminar fuentes de eventos
DROP POLICY IF EXISTS condition_event_sources_delete ON public.condition_event_sources;
CREATE POLICY condition_event_sources_delete ON public.condition_event_sources
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');
