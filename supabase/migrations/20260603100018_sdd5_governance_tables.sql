-- ============================================================
-- MIGRATION: sdd5_governance_tables — Tablas de Governance,
--   Operaciones y Mejora Continua (SDD 5, PR 1a)
-- Change: condition-monitoring-operations-governance (PR 1a)
-- ============================================================
-- Crea las tablas de governance para el pipeline de condición:
--   1. condition_automation_policies — políticas HITL configurables
--   2. condition_diagnosis_feedback — feedback técnico de campo
--   3. condition_audit_log — auditoría inmutable de acciones
--   4. condition_daily_metrics — métricas diarias agregadas
--   5. ALTER maintenance_recommendations — +columnas governance
--   6. Índices compuestos para performance de dashboard
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, ALTER ... IF NOT EXISTS,
--   DROP CONSTRAINT IF EXISTS + ADD.
--
-- RLS:
--   condition_automation_policies: SELECT authenticated,
--     INSERT/UPDATE/DELETE PLANNER/ADMIN
--   condition_diagnosis_feedback: TECHNICIAN INSERT,
--     PLANNER/ADMIN INSERT+UPDATE, authenticated SELECT
--   condition_audit_log: SELECT authenticated,
--     INSERT solo vía función SECURITY DEFINER
--   condition_daily_metrics: SELECT authenticated,
--     INSERT/UPDATE PLANNER/ADMIN
--
-- Dependencias:
--   condition_automation_policies: autónoma
--   condition_diagnosis_feedback: FK → condition_diagnoses, work_orders
--   condition_audit_log: autónoma
--   condition_daily_metrics: autónoma
--   ALTER maintenance_recommendations: FK self, FK → work_orders
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_automation_policies
--    Políticas configurables de automatización HITL.
--    Reemplazan la lógica hardcodeada confidence ≥ 0.7.
--    Evaluadas en orden por evaluation_order.
--    Soportan versionado via policy_version + valid_from/valid_to.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_automation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL,
  policy_version INT NOT NULL DEFAULT 1,
  policy_name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL DEFAULT '{}',
  evaluation_order INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  approved_by TEXT,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(policy_key, policy_version)
);

COMMENT ON TABLE public.condition_automation_policies
  IS 'Políticas configurables de automatización HITL. Reemplazan la lógica hardcodeada confidence ≥ 0.7. Evaluadas en orden por evaluation_order. Soportan versionado via policy_version.';

COMMENT ON COLUMN public.condition_automation_policies.id
  IS 'Identificador único de la política';
COMMENT ON COLUMN public.condition_automation_policies.policy_key
  IS 'Clave única de la política (ej: conservative, permissive)';
COMMENT ON COLUMN public.condition_automation_policies.policy_version
  IS 'Versión de la política — permite versionado sin perder trazabilidad';
COMMENT ON COLUMN public.condition_automation_policies.policy_name
  IS 'Nombre descriptivo de la política';
COMMENT ON COLUMN public.condition_automation_policies.description
  IS 'Descripción detallada del propósito y condiciones de la política';
COMMENT ON COLUMN public.condition_automation_policies.conditions
  IS 'JSONB schema: {min_confidence NUMERIC, max_contradictory_count INT, min_completeness NUMERIC, min_quality_flag TEXT, required_roles TEXT[], requires_approval BOOLEAN, allowed_wo_types TEXT[], asset_criticality_allowed TEXT[], failure_mode_categories TEXT[], late_data_policy TEXT, requires_source_active BOOLEAN, requires_capability_active BOOLEAN}';
COMMENT ON COLUMN public.condition_automation_policies.evaluation_order
  IS 'Orden de evaluación (ascendente). La primera política que matchea gana. Default 100.';
COMMENT ON COLUMN public.condition_automation_policies.is_active
  IS 'Si true, la política es evaluada. Permite desactivar sin eliminar.';
COMMENT ON COLUMN public.condition_automation_policies.created_by
  IS 'Email o user ID de quien creó la política';
COMMENT ON COLUMN public.condition_automation_policies.approved_by
  IS 'Email o user ID de quien aprobó la política';
COMMENT ON COLUMN public.condition_automation_policies.valid_from
  IS 'Inicio de vigencia de la política';
COMMENT ON COLUMN public.condition_automation_policies.valid_to
  IS 'Fin de vigencia de la política (NULL = vigente indefinidamente)';
COMMENT ON COLUMN public.condition_automation_policies.created_at
  IS 'Fecha de creación del registro';
COMMENT ON COLUMN public.condition_automation_policies.updated_at
  IS 'Fecha de última modificación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_ap_active
  ON public.condition_automation_policies(evaluation_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ap_key
  ON public.condition_automation_policies(policy_key);

-- RLS: SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN
ALTER TABLE public.condition_automation_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_automation_policies_select ON public.condition_automation_policies;
CREATE POLICY condition_automation_policies_select ON public.condition_automation_policies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_automation_policies_insert ON public.condition_automation_policies;
CREATE POLICY condition_automation_policies_insert ON public.condition_automation_policies
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_automation_policies_update ON public.condition_automation_policies;
CREATE POLICY condition_automation_policies_update ON public.condition_automation_policies
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_automation_policies_delete ON public.condition_automation_policies;
CREATE POLICY condition_automation_policies_delete ON public.condition_automation_policies
  FOR DELETE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'));

-- ============================================================
-- 2. TABLA: condition_diagnosis_feedback
--    Feedback técnico sobre diagnósticos de condición.
--    Cada fila representa una evaluación de un diagnóstico
--    vinculado a una OT.
--    Diseño crítico: feedback_status y recommendation_usefulness
--    son DOS CAMPOS SEPARADOS — un diagnóstico puede ser correcto
--    pero la recomendación inútil, o viceversa.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_diagnosis_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID NOT NULL
    REFERENCES public.condition_diagnoses(id) ON DELETE CASCADE,
  work_order_id TEXT
    REFERENCES public.work_orders(id) ON DELETE SET NULL,
  feedback_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (feedback_status IN ('confirmed', 'partial', 'rejected', 'pending')),
  actual_failure_mode TEXT,
  actual_component TEXT,
  actual_cause TEXT,
  technician_observation TEXT,
  recommendation_usefulness TEXT
    CHECK (recommendation_usefulness IN ('useful', 'not_useful', 'not_executed', 'superseded')),
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_diagnosis_feedback
  IS 'Feedback técnico sobre diagnósticos de condición. Cada fila representa una evaluación de un diagnóstico vinculado a una OT. feedback_status y recommendation_usefulness son campos independientes.';

COMMENT ON COLUMN public.condition_diagnosis_feedback.id
  IS 'Identificador único del feedback';
COMMENT ON COLUMN public.condition_diagnosis_feedback.diagnosis_id
  IS 'FK al diagnóstico evaluado — ON DELETE CASCADE';
COMMENT ON COLUMN public.condition_diagnosis_feedback.work_order_id
  IS 'FK a la work_order asociada — ON DELETE SET NULL';
COMMENT ON COLUMN public.condition_diagnosis_feedback.feedback_status
  IS 'Estado del feedback: confirmed (diagnóstico correcto), partial (parcialmente correcto), rejected (incorrecto), pending (pendiente de evaluación)';
COMMENT ON COLUMN public.condition_diagnosis_feedback.actual_failure_mode
  IS 'Modo de falla real observado en campo (si difiere del diagnosticado)';
COMMENT ON COLUMN public.condition_diagnosis_feedback.actual_component
  IS 'Componente real que falló (si difiere del diagnosticado)';
COMMENT ON COLUMN public.condition_diagnosis_feedback.actual_cause
  IS 'Causa raíz real identificada en campo';
COMMENT ON COLUMN public.condition_diagnosis_feedback.technician_observation
  IS 'Observaciones del técnico durante la intervención';
COMMENT ON COLUMN public.condition_diagnosis_feedback.recommendation_usefulness
  IS 'Utilidad de la recomendación: useful (útil), not_useful (no útil), not_executed (no ejecutada), superseded (reemplazada)';
COMMENT ON COLUMN public.condition_diagnosis_feedback.reviewed_by
  IS 'Email o user ID de quien realizó la evaluación';
COMMENT ON COLUMN public.condition_diagnosis_feedback.reviewed_at
  IS 'Fecha de la evaluación';
COMMENT ON COLUMN public.condition_diagnosis_feedback.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_fb_diagnosis
  ON public.condition_diagnosis_feedback(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_fb_wo
  ON public.condition_diagnosis_feedback(work_order_id);

-- RLS: TECHNICIAN INSERT; PLANNER/ADMIN INSERT+UPDATE; authenticated SELECT
ALTER TABLE public.condition_diagnosis_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_diagnosis_feedback_select ON public.condition_diagnosis_feedback;
CREATE POLICY condition_diagnosis_feedback_select ON public.condition_diagnosis_feedback
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_diagnosis_feedback_insert ON public.condition_diagnosis_feedback;
CREATE POLICY condition_diagnosis_feedback_insert ON public.condition_diagnosis_feedback
  FOR INSERT TO authenticated WITH CHECK (
    get_user_role() IN ('TECHNICIAN', 'PLANNER', 'ADMIN')
  );

DROP POLICY IF EXISTS condition_diagnosis_feedback_update ON public.condition_diagnosis_feedback;
CREATE POLICY condition_diagnosis_feedback_update ON public.condition_diagnosis_feedback
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- No DELETE policy — feedback no se elimina, se corrige via UPDATE

-- ============================================================
-- 3. TABLA: condition_audit_log
--    Auditoría INMUTABLE de acciones de governance.
--    INSERT-only — no existen políticas UPDATE/DELETE.
--    Escritura solo vía triggers SECURITY DEFINER o función
--    log_audit_entry() para ADMIN.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_audit_log
  IS 'Auditoría INMUTABLE de acciones de governance. INSERT-only — no existen políticas UPDATE/DELETE. Escritura solo vía triggers o función SECURITY DEFINER.';

COMMENT ON COLUMN public.condition_audit_log.id
  IS 'Identificador único del registro de auditoría';
COMMENT ON COLUMN public.condition_audit_log.action
  IS 'Acción realizada (ej: policy_changed, rec_status_changed, diagnosis_feedback)';
COMMENT ON COLUMN public.condition_audit_log.entity_type
  IS 'Tipo de entidad afectada (condition_automation_policies, maintenance_recommendations, etc.)';
COMMENT ON COLUMN public.condition_audit_log.entity_id
  IS 'ID de la entidad afectada (como TEXT para flexibilidad)';
COMMENT ON COLUMN public.condition_audit_log.before_state
  IS 'Estado previo a la acción (NULL en INSERTs)';
COMMENT ON COLUMN public.condition_audit_log.after_state
  IS 'Estado posterior a la acción (NULL en DELETEs)';
COMMENT ON COLUMN public.condition_audit_log.reason
  IS 'Razón o justificación del cambio';
COMMENT ON COLUMN public.condition_audit_log.changed_by
  IS 'Email o user ID de quien realizó la acción';
COMMENT ON COLUMN public.condition_audit_log.changed_at
  IS 'Momento en que ocurrió la acción';

-- Índices
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON public.condition_audit_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON public.condition_audit_log(action);

CREATE INDEX IF NOT EXISTS idx_audit_at
  ON public.condition_audit_log(changed_at);

-- RLS: SELECT → authenticated; INSERT solo vía SECURITY DEFINER (sin policy);
-- NO existen UPDATE/DELETE policies
ALTER TABLE public.condition_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_audit_log_select ON public.condition_audit_log;
CREATE POLICY condition_audit_log_select ON public.condition_audit_log
  FOR SELECT TO authenticated USING (true);

-- Sin política INSERT — solo SECURITY DEFINER functions/triggers pueden escribir
-- Sin política UPDATE — la auditoría es inmutable
-- Sin política DELETE — la auditoría es inmutable

-- ============================================================
-- 4. TABLA: condition_daily_metrics
--    Métricas diarias agregadas por asset.
--    Infraestructura de datos para SDD 6 (analytics).
--    Poblada por cron vía compute_daily_metrics().
--    Idempotente: INSERT ... ON CONFLICT DO UPDATE.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  asset_id TEXT NOT NULL,
  diagnoses_created INT NOT NULL DEFAULT 0,
  diagnoses_confirmed INT NOT NULL DEFAULT 0,
  diagnoses_rejected INT NOT NULL DEFAULT 0,
  recommendations_created INT NOT NULL DEFAULT 0,
  recommendations_approved INT NOT NULL DEFAULT 0,
  recommendations_dismissed INT NOT NULL DEFAULT 0,
  recommendations_converted_to_wo INT NOT NULL DEFAULT 0,
  cbm_wo_created INT NOT NULL DEFAULT 0,
  cbm_wo_closed INT NOT NULL DEFAULT 0,
  feedback_pending_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_date, asset_id)
);

COMMENT ON TABLE public.condition_daily_metrics
  IS 'Métricas diarias agregadas por asset. Infraestructura de datos para SDD 6. Poblada por cron vía compute_daily_metrics(). Idempotente: ON CONFLICT DO UPDATE.';

COMMENT ON COLUMN public.condition_daily_metrics.id
  IS 'Identificador único de la métrica diaria';
COMMENT ON COLUMN public.condition_daily_metrics.metric_date
  IS 'Fecha de la métrica';
COMMENT ON COLUMN public.condition_daily_metrics.asset_id
  IS 'ID del activo';
COMMENT ON COLUMN public.condition_daily_metrics.diagnoses_created
  IS 'Cantidad de diagnósticos creados en esta fecha para este asset';
COMMENT ON COLUMN public.condition_daily_metrics.diagnoses_confirmed
  IS 'Cantidad de diagnósticos confirmados (feedback_status=confirmed)';
COMMENT ON COLUMN public.condition_daily_metrics.diagnoses_rejected
  IS 'Cantidad de diagnósticos rechazados (feedback_status=rejected)';
COMMENT ON COLUMN public.condition_daily_metrics.recommendations_created
  IS 'Cantidad de recomendaciones generadas';
COMMENT ON COLUMN public.condition_daily_metrics.recommendations_approved
  IS 'Cantidad de recomendaciones aprobadas';
COMMENT ON COLUMN public.condition_daily_metrics.recommendations_dismissed
  IS 'Cantidad de recomendaciones descartadas';
COMMENT ON COLUMN public.condition_daily_metrics.recommendations_converted_to_wo
  IS 'Cantidad de recomendaciones convertidas a OT';
COMMENT ON COLUMN public.condition_daily_metrics.cbm_wo_created
  IS 'Cantidad de OTs CBM/CM creadas';
COMMENT ON COLUMN public.condition_daily_metrics.cbm_wo_closed
  IS 'Cantidad de OTs CBM/CM cerradas';
COMMENT ON COLUMN public.condition_daily_metrics.feedback_pending_count
  IS 'Cantidad de diagnósticos activos sin feedback';
COMMENT ON COLUMN public.condition_daily_metrics.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_dm_date
  ON public.condition_daily_metrics(metric_date);

CREATE INDEX IF NOT EXISTS idx_dm_asset
  ON public.condition_daily_metrics(asset_id);

-- RLS: SELECT → authenticated; INSERT/UPDATE → PLANNER, ADMIN
ALTER TABLE public.condition_daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_daily_metrics_select ON public.condition_daily_metrics;
CREATE POLICY condition_daily_metrics_select ON public.condition_daily_metrics
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS condition_daily_metrics_insert ON public.condition_daily_metrics;
CREATE POLICY condition_daily_metrics_insert ON public.condition_daily_metrics
  FOR INSERT TO authenticated WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

DROP POLICY IF EXISTS condition_daily_metrics_update ON public.condition_daily_metrics;
CREATE POLICY condition_daily_metrics_update ON public.condition_daily_metrics
  FOR UPDATE TO authenticated USING (get_user_role() IN ('PLANNER', 'ADMIN'))
  WITH CHECK (get_user_role() IN ('PLANNER', 'ADMIN'));

-- No DELETE policy — métricas históricas no se eliminan

-- ============================================================
-- 5. ALTER TABLE: maintenance_recommendations
--    Extiende la tabla con columnas de governance:
--      - reviewed_by, reviewed_at — trazabilidad de revisión
--      - dismissed_reason — razón de descarte (requerido si
--        status='dismissed')
--      - superseded_by UUID FK self — cadena de reemplazo
--      - work_order_id UUID FK work_orders — OT generada
--      - status CHECK extendido con 'expired'
-- ============================================================

-- 5a. Nuevas columnas
ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS dismissed_reason TEXT;

ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS superseded_by UUID
  REFERENCES public.maintenance_recommendations(id) ON DELETE SET NULL;

ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS work_order_id TEXT
  REFERENCES public.work_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.maintenance_recommendations.reviewed_by
  IS 'Email o user ID de quien revisó la recomendación';
COMMENT ON COLUMN public.maintenance_recommendations.reviewed_at
  IS 'Momento en que se realizó la revisión';
COMMENT ON COLUMN public.maintenance_recommendations.dismissed_reason
  IS 'Razón de descarte — requerida si status = dismissed';
COMMENT ON COLUMN public.maintenance_recommendations.superseded_by
  IS 'Auto-referencia FK: si esta recomendación fue reemplazada por otra mejor';
COMMENT ON COLUMN public.maintenance_recommendations.work_order_id
  IS 'FK a work_orders: la OT que se generó desde esta recomendación';

-- 5b. Índices para nuevas columnas
CREATE INDEX IF NOT EXISTS idx_mr_superseded
  ON public.maintenance_recommendations(superseded_by);

CREATE INDEX IF NOT EXISTS idx_mr_wo
  ON public.maintenance_recommendations(work_order_id);

-- 5c. Extender status CHECK para incluir 'expired'
DO $$
BEGIN
  ALTER TABLE public.maintenance_recommendations
    DROP CONSTRAINT IF EXISTS maintenance_recommendations_status_check;

  ALTER TABLE public.maintenance_recommendations
    ADD CONSTRAINT maintenance_recommendations_status_check
      CHECK (status IN ('suggested', 'review_required', 'approved',
             'converted_to_wo', 'dismissed', 'superseded', 'expired'));
END;
$$;

COMMENT ON COLUMN public.maintenance_recommendations.status
  IS 'Estado del ciclo de vida: suggested, review_required, approved, converted_to_wo, dismissed, superseded, expired';

-- ============================================================
-- 6. ÍNDICES COMPUESTOS para performance del dashboard
--    condition_diagnoses: consultas por asset + status + fecha
--    condition_analysis_results: consultas por asset + tipo + fecha
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_diag_asset_status_created
  ON public.condition_diagnoses(asset_id, diagnosis_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_asset_type_window
  ON public.condition_analysis_results(asset_id, analysis_type, window_end DESC);

-- ============================================================
-- FIN MIGRATION: sdd5_governance_tables
-- ============================================================
