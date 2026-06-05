-- ============================================================
-- MIGRATION: sdd6_prediction_snapshots — RUL Prediction
--   Snapshots Table (SDD 6, PR 4)
-- Change: condition-monitoring-performance-improvement (PR 4)
-- ============================================================
-- Almacena snapshots de cada predicción de RUL para
-- calibración futura contra outcomes reales. Sin snapshots
-- no hay calibración posible.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.
--
-- RLS: SELECT → authenticated; sin INSERT directo (solo via
--   SECURITY DEFINER en compute_rul_linear); ADMIN puede
--   UPDATE actual_outcome_id.
--
-- Dependencias: condition_diagnoses, condition_degradation_models,
--   condition_outcomes (FKs débiles con ON DELETE SET NULL).
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_prediction_snapshots
--    Cada fila representa una predicción de RUL tomada en un
--    momento específico para un asset y modo de falla.
--    Se vincula con outcomes reales para calibración.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_prediction_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  diagnosis_id UUID REFERENCES public.condition_diagnoses(id) ON DELETE SET NULL,
  failure_mode_key TEXT,
  prediction_type TEXT NOT NULL DEFAULT 'rul_estimate'
    CHECK (prediction_type IN ('rul_estimate', 'failure_probability', 'state_estimate')),
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rul_low NUMERIC,
  rul_mid NUMERIC,
  rul_high NUMERIC,
  unit TEXT DEFAULT 'hours',
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  method_key TEXT,
  method_version TEXT,
  model_key TEXT REFERENCES public.condition_degradation_models(model_key) ON DELETE SET NULL,
  model_version INT,
  threshold_id TEXT,
  input_analysis_result_ids UUID[] DEFAULT '{}',
  actual_outcome_id UUID REFERENCES public.condition_outcomes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_prediction_snapshots
  IS 'Instantáneas de predicciones de RUL para calibración futura. Cada fila captura el estado de una predicción en el momento en que se generó. Se vincula con condition_outcomes cuando hay confirmación operacional.';

COMMENT ON COLUMN public.condition_prediction_snapshots.asset_id
  IS 'ID del activo al que pertenece la predicción';
COMMENT ON COLUMN public.condition_prediction_snapshots.diagnosis_id
  IS 'FK al diagnóstico de condición vinculado. SET NULL si el diagnóstico se elimina.';
COMMENT ON COLUMN public.condition_prediction_snapshots.failure_mode_key
  IS 'Modo de falla para el cual se estimó RUL (ej: bearing.wear)';
COMMENT ON COLUMN public.condition_prediction_snapshots.prediction_type
  IS 'Tipo de predicción: rul_estimate|failure_probability|state_estimate';
COMMENT ON COLUMN public.condition_prediction_snapshots.predicted_at
  IS 'Momento en que se generó la predicción';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_low
  IS 'Límite inferior del intervalo de confianza del RUL';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_mid
  IS 'Valor medio estimado de RUL (horas por defecto)';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_high
  IS 'Límite superior del intervalo de confianza del RUL';
COMMENT ON COLUMN public.condition_prediction_snapshots.unit
  IS 'Unidad del RUL (horas por defecto)';
COMMENT ON COLUMN public.condition_prediction_snapshots.confidence
  IS 'Nivel de confianza de la predicción (0-1)';
COMMENT ON COLUMN public.condition_prediction_snapshots.method_key
  IS 'Clave del método de estimación usado (ej: linear_extrapolation)';
COMMENT ON COLUMN public.condition_prediction_snapshots.method_version
  IS 'Versión del método de estimación';
COMMENT ON COLUMN public.condition_prediction_snapshots.model_key
  IS 'FK al modelo de degradación usado (model_key). SET NULL si el modelo se elimina.';
COMMENT ON COLUMN public.condition_prediction_snapshots.model_version
  IS 'Versión del modelo de degradación al momento de la predicción';
COMMENT ON COLUMN public.condition_prediction_snapshots.threshold_id
  IS 'Identificador del threshold usado para la estimación (valor textual)';
COMMENT ON COLUMN public.condition_prediction_snapshots.input_analysis_result_ids
  IS 'IDs de los condition_analysis_results que sirvieron como input';
COMMENT ON COLUMN public.condition_prediction_snapshots.actual_outcome_id
  IS 'FK al outcome real que confirma o refuta esta predicción. SET NULL si se elimina. NULL hasta que se vincule.';
COMMENT ON COLUMN public.condition_prediction_snapshots.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_snap_asset_time
  ON public.condition_prediction_snapshots(asset_id, predicted_at);

CREATE INDEX IF NOT EXISTS idx_snap_diagnosis
  ON public.condition_prediction_snapshots(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_snap_outcome
  ON public.condition_prediction_snapshots(actual_outcome_id)
  WHERE actual_outcome_id IS NOT NULL;

-- ============================================================
-- 2. RLS: condition_prediction_snapshots
--    SELECT → todos los authenticated
--    Sin INSERT directo — solo via SECURITY DEFINER function
--      (compute_rul_linear)
--    UPDATE → solo ADMIN (para vincular actual_outcome_id)
--    Sin DELETE — snapshots son inmutables
-- ============================================================
ALTER TABLE public.condition_prediction_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cps_select ON public.condition_prediction_snapshots;
CREATE POLICY cps_select ON public.condition_prediction_snapshots
  FOR SELECT TO authenticated USING (true);

-- Sin INSERT policy — solo via SECURITY DEFINER function
-- Sin DELETE policy — snapshots son inmutables

DROP POLICY IF EXISTS cps_update ON public.condition_prediction_snapshots;
CREATE POLICY cps_update ON public.condition_prediction_snapshots
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- ============================================================
-- FIN MIGRATION: sdd6_prediction_snapshots
-- ============================================================
