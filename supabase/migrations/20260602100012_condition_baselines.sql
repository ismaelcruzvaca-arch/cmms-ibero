-- ============================================================
-- MIGRATION: condition_baselines — Líneas Base de Condición
-- Change: condition-monitoring-detection-estimation (PR 1a)
-- ============================================================
-- Crea la tabla condition_baselines que almacena líneas base
-- estadísticas por activo, feature y contexto operativo.
-- Cada baseline representa la "normalidad" aprendida del activo
-- en un régimen específico. El ciclo de vida es versionado:
-- no se sobreescribe, se crean nuevas versiones.
--
-- Estados del ciclo de vida:
--   draft → candidate → active → frozen
--   Desde active/frozen → needs_review → candidate
--   Desde cualquier estado → deprecated
--
-- Una única baseline active por contexto (asset_id, feature,
-- method, measurement_point, regime, rpm_band, load_band).
-- Versiones anteriores quedan frozen o deprecated para auditoría.
--
-- Idempotente: usa IF NOT EXISTS, IF EXISTS guards,
--   DROP/CREATE con IF EXISTS/IF NOT EXISTS.
--
-- Dependencias:
--   condition_feature_definitions (FK feature_definition_id)
--   condition_analysis_methods (FK method_key)
--
-- RLS:
--   SELECT → authenticated (todos los roles)
--   INSERT/UPDATE/DELETE → PLANNER, ADMIN
-- ============================================================

-- -----------------------------------------------------------
-- 1. TABLA: condition_baselines
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.condition_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  feature_definition_id UUID NOT NULL REFERENCES public.condition_feature_definitions(id),
  method_key TEXT NOT NULL REFERENCES public.condition_analysis_methods(method_key),
  measurement_point_id TEXT,
  regime TEXT NOT NULL CHECK (regime IN (
    'STOPPED', 'STARTUP', 'IDLE', 'PARTIAL_LOAD', 'FULL_LOAD', 'OVERLOAD'
  )),
  rpm_band TEXT NOT NULL CHECK (rpm_band IN (
    '0-500', '500-1000', '1000-1500', '1500-2000', '2000+'
  )),
  load_band TEXT NOT NULL CHECK (load_band IN (
    '0-25%', '25-50%', '50-75%', '75-100%'
  )),
  mean NUMERIC NOT NULL,
  stddev NUMERIC NOT NULL,
  median NUMERIC,
  mad NUMERIC,
  p95 NUMERIC,
  p99 NUMERIC,
  sample_count INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  baseline_status TEXT NOT NULL DEFAULT 'draft' CHECK (baseline_status IN (
    'draft', 'candidate', 'active', 'frozen', 'needs_review', 'deprecated'
  )),
  baseline_version INTEGER NOT NULL DEFAULT 1,
  quality_filter TEXT NOT NULL DEFAULT 'G0' CHECK (quality_filter IN ('G0', 'G1', 'G2', 'G3')),
  ewma_alpha NUMERIC DEFAULT 0.1,
  created_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- La clave única completa incluye la versión:
  -- cada baseline es único por contexto operativo + versión
  UNIQUE(asset_id, feature_definition_id, method_key, measurement_point_id,
         regime, rpm_band, load_band, baseline_version)
);

COMMENT ON TABLE public.condition_baselines
  IS 'Líneas base estadísticas por activo, feature y contexto operativo. Cada baseline representa la normalidad aprendida en un régimen.';

COMMENT ON COLUMN public.condition_baselines.asset_id
  IS 'Referencia al activo monitoreado (TEXT, consistente con otras tablas de condición)';
COMMENT ON COLUMN public.condition_baselines.feature_definition_id
  IS 'FK a condition_feature_definitions — feature medido';
COMMENT ON COLUMN public.condition_baselines.method_key
  IS 'FK a condition_analysis_methods — método de análisis usado para calcular el baseline';
COMMENT ON COLUMN public.condition_baselines.measurement_point_id
  IS 'Punto de medición físico en el activo (opcional; NULL = cualquier punto para el feature+método)';
COMMENT ON COLUMN public.condition_baselines.regime
  IS 'Régimen operativo del baseline';
COMMENT ON COLUMN public.condition_baselines.rpm_band
  IS 'Banda de RPM del contexto operativo';
COMMENT ON COLUMN public.condition_baselines.load_band
  IS 'Banda de carga del contexto operativo';
COMMENT ON COLUMN public.condition_baselines.mean
  IS 'Media estadística de las ventanas que componen el baseline';
COMMENT ON COLUMN public.condition_baselines.stddev
  IS 'Desviación estándar de las ventanas del baseline';
COMMENT ON COLUMN public.condition_baselines.median
  IS 'Mediana (estadística robusta) — opcional, calculada si hay suficientes datos';
COMMENT ON COLUMN public.condition_baselines.mad
  IS 'Desviación absoluta mediana (estadística robusta) — opcional';
COMMENT ON COLUMN public.condition_baselines.p95
  IS 'Percentil 95 — opcional, útil para límites de alerta';
COMMENT ON COLUMN public.condition_baselines.p99
  IS 'Percentil 99 — opcional, útil para límites críticos';
COMMENT ON COLUMN public.condition_baselines.sample_count
  IS 'Cantidad de ventanas usadas en el cálculo del baseline';
COMMENT ON COLUMN public.condition_baselines.valid_from
  IS 'Inicio de vigencia del baseline (se setea al promover a active)';
COMMENT ON COLUMN public.condition_baselines.valid_to
  IS 'Fin de vigencia (se setea al deprecar; NULL = vigente)';
COMMENT ON COLUMN public.condition_baselines.baseline_status
  IS 'Estado del ciclo de vida: draft → candidate → active → frozen, con transiciones a needs_review y deprecated';
COMMENT ON COLUMN public.condition_baselines.baseline_version
  IS 'Versión secuencial del baseline por contexto. Se incrementa al recalcular.';
COMMENT ON COLUMN public.condition_baselines.quality_filter
  IS 'Calidad mínima usada al calcular: G0 = 100% ventanas G0, G1 = al menos una G1 incluida';
COMMENT ON COLUMN public.condition_baselines.ewma_alpha
  IS 'Factor de suavizado EWMA para actualización incremental (default 0.1)';
COMMENT ON COLUMN public.condition_baselines.created_by
  IS 'Usuario que creó el baseline (TEXT, referencia al email o username del operador)';
COMMENT ON COLUMN public.condition_baselines.approved_by
  IS 'Usuario que aprobó el baseline (se setea al promover a active)';
COMMENT ON COLUMN public.condition_baselines.created_at
  IS 'Fecha de creación del baseline';
COMMENT ON COLUMN public.condition_baselines.updated_at
  IS 'Fecha de última modificación del baseline';

-- -----------------------------------------------------------
-- 2. ÍNDICES
-- -----------------------------------------------------------

-- Índice único parcial: solo una baseline active por contexto
-- (active y frozen pueden coexistir: active=v2, frozen=v1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_active_unique
  ON public.condition_baselines(asset_id, feature_definition_id, method_key,
                                COALESCE(measurement_point_id,''), regime, rpm_band, load_band)
  WHERE baseline_status = 'active';

-- Índice único parcial: solo una baseline frozen por contexto
CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_frozen_unique
  ON public.condition_baselines(asset_id, feature_definition_id, method_key,
                                COALESCE(measurement_point_id,''), regime, rpm_band, load_band)
  WHERE baseline_status = 'frozen';

CREATE INDEX IF NOT EXISTS idx_baselines_asset
  ON public.condition_baselines(asset_id);

CREATE INDEX IF NOT EXISTS idx_baselines_status
  ON public.condition_baselines(baseline_status);

CREATE INDEX IF NOT EXISTS idx_baselines_created_at
  ON public.condition_baselines(created_at);

CREATE INDEX IF NOT EXISTS idx_baselines_feature
  ON public.condition_baselines(feature_definition_id);

CREATE INDEX IF NOT EXISTS idx_baselines_method
  ON public.condition_baselines(method_key);

-- -----------------------------------------------------------
-- 3. TRIGGER: actualización automática de updated_at
-- -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tgr_condition_baselines_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tgr_condition_baselines_updated_at()
  IS 'BEFORE UPDATE trigger: actualiza updated_at automáticamente en condition_baselines';

DROP TRIGGER IF EXISTS trg_condition_baselines_updated_at ON public.condition_baselines;
CREATE TRIGGER trg_condition_baselines_updated_at
  BEFORE UPDATE ON public.condition_baselines
  FOR EACH ROW
  EXECUTE FUNCTION public.tgr_condition_baselines_updated_at();

-- -----------------------------------------------------------
-- 4. ROW-LEVEL SECURITY
-- -----------------------------------------------------------
ALTER TABLE public.condition_baselines ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede leer baselines
DROP POLICY IF EXISTS condition_baselines_select ON public.condition_baselines;
CREATE POLICY condition_baselines_select ON public.condition_baselines
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo PLANNER y ADMIN pueden crear baselines
DROP POLICY IF EXISTS condition_baselines_insert ON public.condition_baselines;
CREATE POLICY condition_baselines_insert ON public.condition_baselines
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- UPDATE: solo PLANNER y ADMIN pueden modificar baselines
DROP POLICY IF EXISTS condition_baselines_update ON public.condition_baselines;
CREATE POLICY condition_baselines_update ON public.condition_baselines
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- DELETE: solo PLANNER y ADMIN pueden eliminar baselines
DROP POLICY IF EXISTS condition_baselines_delete ON public.condition_baselines;
CREATE POLICY condition_baselines_delete ON public.condition_baselines
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- FIN MIGRATION: condition_baselines
-- ============================================================
