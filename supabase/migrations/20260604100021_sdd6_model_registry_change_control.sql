-- ============================================================
-- MIGRATION: sdd6_model_registry_change_control — Model
--   Registry + Change Control + Seeds (SDD 6, PR 1a)
-- Change: condition-monitoring-performance-improvement (PR 1a)
-- ============================================================
-- Crea las tablas de registro de modelos de degradación,
-- matriz de aplicabilidad y control de cambios:
--   1. condition_degradation_models — catálogo de modelos
--   2. condition_model_applicability — matriz FM+asset_class
--   3. condition_change_proposals — propuestas de cambio
--   4. Seeds — 6 modelos de degradación iniciales
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.
--
-- RLS: SELECT → authenticated; INSERT → PLANNER, ADMIN;
--   UPDATE → PLANNER, ADMIN; DELETE → ADMIN.
--
-- Dependencias: get_user_role() (migración RBAC).
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_degradation_models
--    Catálogo gobernado de modelos de degradación.
--    Cada modelo declara tipo, DRL mínimo requerido,
--    y schema de parámetros.
--    Lifecycle: draft→candidate→field_trial→active→
--              deprecated/superseded.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_degradation_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_type TEXT NOT NULL
    CHECK (model_type IN ('linear','piecewise_linear','exponential','weibull','gamma','wiener','custom')),
  description TEXT,
  assumptions TEXT[] DEFAULT '{}',
  input_requirements TEXT[] DEFAULT '{}',
  min_data_readiness_level INT NOT NULL DEFAULT 0
    CHECK (min_data_readiness_level BETWEEN 0 AND 6),
  validation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (validation_status IN ('draft','candidate','field_trial','active','deprecated','superseded')),
  version INT NOT NULL DEFAULT 1,
  parameters_schema JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_degradation_model_key UNIQUE (model_key)
);

COMMENT ON TABLE public.condition_degradation_models
  IS 'Catálogo gobernado de modelos de degradación. Cada modelo declara tipo, DRL mínimo requerido, y schema de parámetros. Lifecycle: draft→candidate→field_trial→active→deprecated/superseded.';

COMMENT ON COLUMN public.condition_degradation_models.model_key
  IS 'Identificador único del modelo (ej: linear_extrapolation, weibull_rul)';
COMMENT ON COLUMN public.condition_degradation_models.model_name
  IS 'Nombre descriptivo del modelo en español';
COMMENT ON COLUMN public.condition_degradation_models.model_type
  IS 'Tipo de modelo: linear|piecewise_linear|exponential|weibull|gamma|wiener|custom';
COMMENT ON COLUMN public.condition_degradation_models.description
  IS 'Descripción detallada del modelo, suposiciones y uso recomendado';
COMMENT ON COLUMN public.condition_degradation_models.assumptions
  IS 'Array de supuestos del modelo (ej: ARRAY[''degradation_is_linear'',''constant_rate_of_change''])';
COMMENT ON COLUMN public.condition_degradation_models.input_requirements
  IS 'Array de features requeridas como input del modelo';
COMMENT ON COLUMN public.condition_degradation_models.min_data_readiness_level
  IS 'DRL mínimo requerido para promover el modelo a active. 0-6. Hard gate vía trigger.';
COMMENT ON COLUMN public.condition_degradation_models.validation_status
  IS 'Estado en el lifecycle gobernado: draft|candidate|field_trial|active|deprecated|superseded';
COMMENT ON COLUMN public.condition_degradation_models.version
  IS 'Versión del modelo. Se incrementa con cada modificación significativa.';
COMMENT ON COLUMN public.condition_degradation_models.parameters_schema
  IS 'JSONB describiendo el schema de parámetros del modelo (keys, tipos, defaults). NO almacena valores de parámetros.';
COMMENT ON COLUMN public.condition_degradation_models.created_at
  IS 'Fecha de creación del registro';
COMMENT ON COLUMN public.condition_degradation_models.updated_at
  IS 'Fecha de última modificación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_cdm_status_drl
  ON public.condition_degradation_models(validation_status, min_data_readiness_level);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN; DELETE → ADMIN
ALTER TABLE public.condition_degradation_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_degradation_models_select ON public.condition_degradation_models;
CREATE POLICY condition_degradation_models_select ON public.condition_degradation_models
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_degradation_models_insert ON public.condition_degradation_models;
CREATE POLICY condition_degradation_models_insert ON public.condition_degradation_models
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_degradation_models_update ON public.condition_degradation_models;
CREATE POLICY condition_degradation_models_update ON public.condition_degradation_models
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_degradation_models_delete ON public.condition_degradation_models;
CREATE POLICY condition_degradation_models_delete ON public.condition_degradation_models
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 2. TABLA: condition_model_applicability
--    Matriz de aplicabilidad: qué modelos aplican a qué
--    modos de falla y clase de asset.
--    No todos los modelos sirven para todos los FMs.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_model_applicability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL
    REFERENCES public.condition_degradation_models(id) ON DELETE CASCADE,
  failure_mode_key TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  min_samples INT,
  min_r_squared NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_model_applicability UNIQUE (model_id, failure_mode_key, asset_class)
);

COMMENT ON TABLE public.condition_model_applicability
  IS 'Matriz de aplicabilidad: qué modelos aplican a qué modos de falla y clase de asset. No todos los modelos sirven para todos los FMs.';

COMMENT ON COLUMN public.condition_model_applicability.model_id
  IS 'FK al modelo de degradación — ON DELETE CASCADE';
COMMENT ON COLUMN public.condition_model_applicability.failure_mode_key
  IS 'Clave del modo de falla (ej: pump.wear, bearing.corrosion)';
COMMENT ON COLUMN public.condition_model_applicability.asset_class
  IS 'Clase de asset (ej: centrif_pump, fan, compressor)';
COMMENT ON COLUMN public.condition_model_applicability.min_samples
  IS 'Cantidad mínima de muestras históricas requeridas para aplicar este modelo';
COMMENT ON COLUMN public.condition_model_applicability.min_r_squared
  IS 'R² mínimo requerido para considerar el ajuste aceptable';
COMMENT ON COLUMN public.condition_model_applicability.notes
  IS 'Notas adicionales sobre la aplicabilidad del modelo';
COMMENT ON COLUMN public.condition_model_applicability.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_cma_model
  ON public.condition_model_applicability(model_id);

CREATE INDEX IF NOT EXISTS idx_cma_fm_asset
  ON public.condition_model_applicability(failure_mode_key, asset_class);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN; DELETE → ADMIN
ALTER TABLE public.condition_model_applicability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_model_applicability_select ON public.condition_model_applicability;
CREATE POLICY condition_model_applicability_select ON public.condition_model_applicability
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_model_applicability_insert ON public.condition_model_applicability;
CREATE POLICY condition_model_applicability_insert ON public.condition_model_applicability
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_model_applicability_update ON public.condition_model_applicability;
CREATE POLICY condition_model_applicability_update ON public.condition_model_applicability
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_model_applicability_delete ON public.condition_model_applicability;
CREATE POLICY condition_model_applicability_delete ON public.condition_model_applicability
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 3. TABLA: condition_change_proposals
--    Propuestas de cambio controlado para thresholds, reglas,
--    baselines, políticas HITL, métodos RUL y modelos de
--    degradación.
--    Lifecycle: draft→review→approved→active→rolled_back.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_change_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('threshold','rule','diagnostic_pattern','baseline','hitl_policy','rul_method','degradation_model','source_capability','analysis_method','failure_mode','evidence_matrix','recommendation_mapping','pf_curve','hi_weight')),
  entity_id TEXT NOT NULL,
  change_type TEXT NOT NULL
    CHECK (change_type IN ('update','replace','deactivate','activate')),
  before_state JSONB,
  after_state JSONB,
  justification TEXT,
  expected_impact TEXT,
  impact_summary JSONB DEFAULT '{}',
  proposed_by TEXT,
  reviewed_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','approved','rejected','active','rolled_back')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  active_at TIMESTAMPTZ,
  CONSTRAINT uq_change_proposal_key UNIQUE (proposal_key)
);

COMMENT ON TABLE public.condition_change_proposals
  IS 'Propuestas de cambio controlado para thresholds, reglas, baselines, políticas HITL, métodos RUL y modelos de degradación. Lifecycle: draft→review→approved→active→rolled_back.';

COMMENT ON COLUMN public.condition_change_proposals.proposal_key
  IS 'Clave única de la propuesta (ej: chg-001, increase_oil_temp_threshold)';
COMMENT ON COLUMN public.condition_change_proposals.title
  IS 'Título descriptivo de la propuesta de cambio';
COMMENT ON COLUMN public.condition_change_proposals.description
  IS 'Descripción detallada del cambio propuesto';
COMMENT ON COLUMN public.condition_change_proposals.entity_type
  IS 'Tipo de entidad afectada: threshold, rule, diagnostic_pattern, baseline, hitl_policy, rul_method, degradation_model, source_capability, analysis_method, failure_mode, evidence_matrix, recommendation_mapping, pf_curve, hi_weight';
COMMENT ON COLUMN public.condition_change_proposals.entity_id
  IS 'ID textual de la entidad afectada (ej: threshold_key, rule_id, baseline_key)';
COMMENT ON COLUMN public.condition_change_proposals.change_type
  IS 'Tipo de cambio: update (modificar), replace (reemplazar), deactivate (desactivar), activate (activar)';
COMMENT ON COLUMN public.condition_change_proposals.before_state
  IS 'Estado completo de la entidad ANTES del cambio (para rollback). Capturado al crear la propuesta.';
COMMENT ON COLUMN public.condition_change_proposals.after_state
  IS 'Estado completo de la entidad DESPUÉS del cambio (para diff y aprobación)';
COMMENT ON COLUMN public.condition_change_proposals.justification
  IS 'Justificación del cambio: por qué es necesario';
COMMENT ON COLUMN public.condition_change_proposals.expected_impact
  IS 'Impacto esperado del cambio en texto libre';
COMMENT ON COLUMN public.condition_change_proposals.impact_summary
  IS 'JSONB con métricas de impacto estructuradas (ej: affected_assets, fm_count, false_positive_reduction_estimate)';
COMMENT ON COLUMN public.condition_change_proposals.proposed_by
  IS 'Email o user ID de quien propone el cambio';
COMMENT ON COLUMN public.condition_change_proposals.reviewed_by
  IS 'Email o user ID de quien revisó y aprobó/rechazó';
COMMENT ON COLUMN public.condition_change_proposals.status
  IS 'Estado actual en el lifecycle: draft|review|approved|rejected|active|rolled_back';
COMMENT ON COLUMN public.condition_change_proposals.created_at
  IS 'Fecha de creación de la propuesta';
COMMENT ON COLUMN public.condition_change_proposals.reviewed_at
  IS 'Fecha en que se realizó la revisión';
COMMENT ON COLUMN public.condition_change_proposals.active_at
  IS 'Fecha en que el cambio entró en vigencia';

-- Índices
CREATE INDEX IF NOT EXISTS idx_ccp_entity
  ON public.condition_change_proposals(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_ccp_status
  ON public.condition_change_proposals(status);

CREATE INDEX IF NOT EXISTS idx_ccp_proposal_key
  ON public.condition_change_proposals(proposal_key);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN; DELETE → ADMIN
ALTER TABLE public.condition_change_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_change_proposals_select ON public.condition_change_proposals;
CREATE POLICY condition_change_proposals_select ON public.condition_change_proposals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_change_proposals_insert ON public.condition_change_proposals;
CREATE POLICY condition_change_proposals_insert ON public.condition_change_proposals
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_change_proposals_update ON public.condition_change_proposals;
CREATE POLICY condition_change_proposals_update ON public.condition_change_proposals
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_change_proposals_delete ON public.condition_change_proposals;
CREATE POLICY condition_change_proposals_delete ON public.condition_change_proposals
  FOR DELETE TO authenticated USING (get_user_role() = 'ADMIN');

-- ============================================================
-- 4. SEED: Modelos de degradación (SDD 6, PR 1)
--    6 modelos con diferentes niveles de madurez:
--      - linear_extrapolation: activo, DRL 2 (producción SDD 4)
--      - piecewise_linear: candidato, DRL 4
--      - exponential_degradation: candidato, DRL 4
--      - weibull_rul: draft, DRL 6
--      - gamma_process: draft, DRL 6
--      - wiener_process: draft, DRL 6
-- ============================================================
INSERT INTO public.condition_degradation_models (
  model_key, model_name, model_type,
  description, assumptions, input_requirements,
  min_data_readiness_level, validation_status, version,
  parameters_schema
) VALUES
(
  'linear_extrapolation',
  'Extrapolación Lineal',
  'linear',
  'Modelo lineal simple: proyecta el valor actual de la feature de degradación hasta el umbral crítico usando la tasa de cambio promedio de las últimas N ventanas.',
  ARRAY['degradation_is_linear', 'constant_rate_of_change', 'no_seasonality'],
  ARRAY['degradation_feature', 'threshold_value', 'window_history_count'],
  2,
  'active',
  1,
  '{
    "rate_window": {"type": "integer", "default": 10, "description": "Ventanas para calcular tasa de cambio"},
    "min_r_squared": {"type": "numeric", "default": 0.8, "description": "R² mínimo del ajuste lineal"},
    "confidence_interval": {"type": "numeric", "default": 0.95, "description": "Intervalo de confianza para predicción"}
  }'::JSONB
),
(
  'piecewise_linear',
  'Regresión Lineal Segmentada',
  'piecewise_linear',
  'Modelo con múltiples segmentos lineales conectados por puntos de quiebre (breakpoints). Captura cambios de régimen en la degradación.',
  ARRAY['degradation_has_regime_changes', 'breakpoints_identifiable', 'piecewise_continuous'],
  ARRAY['degradation_feature', 'threshold_value', 'min_segment_length'],
  4,
  'candidate',
  1,
  '{
    "max_segments": {"type": "integer", "default": 3, "description": "Máximo de segmentos lineales"},
    "min_segment_length": {"type": "integer", "default": 5, "description": "Ventanas mínimas por segmento"},
    "optimization_method": {"type": "string", "default": "dp", "description": "Método de optimización: dp|pwl"}
  }'::JSONB
),
(
  'exponential_degradation',
  'Degradación Exponencial',
  'exponential',
  'Modelo exponencial para degradaciones que se aceleran en el tiempo (ej: corrosión, fatiga térmica). Ajusta curva A·exp(B·t).',
  ARRAY['degradation_accelerates_over_time', 'positive_rate_parameter', 'no_saturation_effects'],
  ARRAY['degradation_feature', 'threshold_value', 'initial_value'],
  4,
  'candidate',
  1,
  '{
    "fit_method": {"type": "string", "default": "nls", "description": "Método de ajuste: nls|log_transform"},
    "min_r_squared": {"type": "numeric", "default": 0.85, "description": "R² mínimo del ajuste"},
    "asymptote_detection": {"type": "boolean", "default": false, "description": "Detectar asíntota superior"}
  }'::JSONB
),
(
  'weibull_rul',
  'Weibull RUL',
  'weibull',
  'Modelo basado en distribución Weibull para estimar RUL a partir de datos históricos de falla. Requiere DRL 6 para activación.',
  ARRAY['failure_times_follow_weibull', 'sufficient_failure_history', 'iid_failure_times'],
  ARRAY['failure_times_historical', 'censored_data', 'confidence_level'],
  6,
  'draft',
  1,
  '{
    "shape_parameter": {"type": "numeric", "default": null, "description": "Parámetro de forma Weibull (estimado si null)"},
    "scale_parameter": {"type": "numeric", "default": null, "description": "Parámetro de escala Weibull (estimado si null)"},
    "estimation_method": {"type": "string", "default": "mle", "description": "Método: mle|least_squares|bayesian"}
  }'::JSONB
),
(
  'gamma_process',
  'Proceso Gamma',
  'gamma',
  'Modelo de proceso estocástico Gamma para degradación monotónica con incrementos independientes. Adecuado para desgaste progresivo.',
  ARRAY['degradation_is_monotonic', 'increments_are_independent', 'gamma_distributed_increments'],
  ARRAY['degradation_feature', 'threshold_value', 'inspection_times'],
  6,
  'draft',
  1,
  '{
    "shape_parameter": {"type": "numeric", "default": null, "description": "Parámetro de forma Gamma"},
    "rate_parameter": {"type": "numeric", "default": null, "description": "Parámetro de tasa Gamma"},
    "simulation_paths": {"type": "integer", "default": 1000, "description": "Trayectorias Monte Carlo"}
  }'::JSONB
),
(
  'wiener_process',
  'Proceso Wiener',
  'wiener',
  'Modelo de proceso Wiener (movimiento Browniano con deriva) para degradación no-monotónica con volatilidad. Adecuado para señales con ruido significativo.',
  ARRAY['degradation_has_random_walk', 'constant_drift_rate', 'volatility_is_stable'],
  ARRAY['degradation_feature', 'threshold_value', 'sampling_interval'],
  6,
  'draft',
  1,
  '{
    "drift_parameter": {"type": "numeric", "default": null, "description": "Parámetro de deriva"},
    "diffusion_parameter": {"type": "numeric", "default": null, "description": "Parámetro de difusión (volatilidad)"},
    "first_hitting_time": {"type": "boolean", "default": true, "description": "Calcular tiempo de primer impacto"}
  }'::JSONB
)
ON CONFLICT (model_key) DO NOTHING;

-- ============================================================
-- FIN MIGRATION: sdd6_model_registry_change_control
-- ============================================================
