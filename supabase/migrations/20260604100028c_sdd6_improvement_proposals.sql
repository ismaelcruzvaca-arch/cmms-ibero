-- ============================================================
-- MIGRATION: sdd6_improvement_proposals — Improvement
--   Proposal Engine Table (SDD 6, PR 5)
-- Change: condition-monitoring-performance-improvement (PR 5)
-- ============================================================
-- Crea la tabla de propuestas de mejora para el motor de
-- mejora continua. El sistema detecta oportunidades — reglas
-- ruidosas, FP altos, sesgo RUL, baja calidad de datos,
-- disponibilidad de modelos — y genera propuestas para
-- revisión humana. El sistema NUNCA auto-implementa.
--
-- Lifecycle: draft → review → approved → implemented → superseded
--            draft → review → rejected
--
-- Key constraint: NUNCA se auto-avanza más allá de 'review'.
--   generate_improvement_proposals() SIEMPRE inserta en 'draft'.
--   No trigger, scheduler ni función auto-avanza a approved o
--   implemented.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.
--
-- RLS: SELECT → authenticated; INSERT → función SECURITY DEFINER
--   solamente (sin política INSERT); UPDATE → PLANNER puede
--   cambiar status a approved/rejected desde review; ADMIN
--   puede cambiar a implemented/superseded.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_improvement_proposals
--    Propuestas de mejora generadas automáticamente por el
--    sistema. Cada propuesta describe una oportunidad de mejora
--    detectada, su estado actual, cambio propuesto, beneficio
--    esperado y riesgo. El sistema propone, humanos deciden.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN ('threshold_adjustment', 'rule_review', 'pattern_update',
           'baseline_recalibration', 'policy_change', 'model_switch', 'rul_method_change')),
  source_analysis TEXT,
  current_state JSONB DEFAULT '{}',
  proposed_state JSONB DEFAULT '{}',
  expected_benefit TEXT,
  risk TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'implemented', 'superseded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  change_proposal_id UUID REFERENCES public.condition_change_proposals(id) ON DELETE SET NULL,
  CONSTRAINT uq_imp_proposal_key UNIQUE (proposal_key)
);

COMMENT ON TABLE public.condition_improvement_proposals
  IS 'Propuestas de mejora generadas automáticamente. El sistema detecta oportunidades y crea propuestas en draft para revisión humana. Lifecycle: draft→review→approved→implemented→superseded o draft→review→rejected. NUNCA auto-avanza más allá de review.';
COMMENT ON COLUMN public.condition_improvement_proposals.proposal_key
  IS 'Clave única de la propuesta (ej: imp_noisy_bearing_rule_1, imp_rulbias_BANDA-TR-01)';
COMMENT ON COLUMN public.condition_improvement_proposals.title
  IS 'Título descriptivo generado automáticamente con valores actuales';
COMMENT ON COLUMN public.condition_improvement_proposals.description
  IS 'Descripción detallada de la oportunidad detectada y contexto';
COMMENT ON COLUMN public.condition_improvement_proposals.proposal_type
  IS 'Tipo de propuesta: threshold_adjustment, rule_review, pattern_update, baseline_recalibration, policy_change, model_switch, rul_method_change';
COMMENT ON COLUMN public.condition_improvement_proposals.source_analysis
  IS 'Identificador de la fuente de análisis que generó la propuesta. Usado para deduplicación: mismo source_analysis + status IN (draft,review,approved) previene duplicados. Formato: noisy_rule:{rule_name}, low_perf_fm:{fm_key}, low_perf_rule:{rule_name}, rul_bias:{asset_id}:{fm_key}, low_quality:{source_id}, drl_model:{asset_id}:{model_key}';
COMMENT ON COLUMN public.condition_improvement_proposals.current_state
  IS 'JSONB con el estado actual que originó la propuesta (métricas, tasas, conteos)';
COMMENT ON COLUMN public.condition_improvement_proposals.proposed_state
  IS 'JSONB con el estado propuesto del cambio (nuevos valores, configuración sugerida)';
COMMENT ON COLUMN public.condition_improvement_proposals.expected_benefit
  IS 'Beneficio esperado de implementar la propuesta (texto descriptivo)';
COMMENT ON COLUMN public.condition_improvement_proposals.risk
  IS 'Riesgo identificado de no implementar o de implementar incorrectamente';
COMMENT ON COLUMN public.condition_improvement_proposals.status
  IS 'Estado actual: draft|review|approved|rejected|implemented|superseded';
COMMENT ON COLUMN public.condition_improvement_proposals.created_at
  IS 'Fecha de generación automática de la propuesta';
COMMENT ON COLUMN public.condition_improvement_proposals.reviewed_at
  IS 'Fecha en que fue revisada por un humano';
COMMENT ON COLUMN public.condition_improvement_proposals.implemented_at
  IS 'Fecha en que se implementó el cambio aprobado';
COMMENT ON COLUMN public.condition_improvement_proposals.change_proposal_id
  IS 'FK a condition_change_proposals — vincula la propuesta de mejora con el cambio controlado que la implementó';

-- ============================================================
-- 2. ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_imp_status
  ON public.condition_improvement_proposals(status);

CREATE INDEX IF NOT EXISTS idx_imp_type
  ON public.condition_improvement_proposals(proposal_type);

CREATE INDEX IF NOT EXISTS idx_imp_source
  ON public.condition_improvement_proposals(source_analysis);

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================
ALTER TABLE public.condition_improvement_proposals ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado puede ver propuestas
DROP POLICY IF EXISTS cip_select ON public.condition_improvement_proposals;
CREATE POLICY cip_select ON public.condition_improvement_proposals
  FOR SELECT TO authenticated USING (true);

-- NO hay política INSERT directa — solo funciones SECURITY DEFINER
-- pueden insertar (generate_improvement_proposals()).
-- Esto es intencional: evita inserciones manuales no controladas.

-- UPDATE: controlado por rol y estado
--   - Cualquiera puede editar campos no-status mientras esté en draft
--   - PLANNER puede enviar a review (draft→review) y
--     aprobar/rechazar desde review (review→approved/rejected)
--   - ADMIN puede todo lo anterior + implementar (approved→implemented)
--     y superseder (implemented→superseded)
--   - rejected es terminal (no se puede reabrir desde rejected)
--   - superseded es terminal (no se puede modificar)
DROP POLICY IF EXISTS cip_update ON public.condition_improvement_proposals;
CREATE POLICY cip_update ON public.condition_improvement_proposals
  FOR UPDATE TO authenticated USING (
    -- Edición de draft: cualquiera puede modificar campos no-status
    (OLD.status = 'draft' AND NEW.status = 'draft')
    OR
    -- PLANNER y ADMIN: draft→review, review→approved/rejected
    (
      get_user_role() IN ('PLANNER', 'ADMIN')
      AND (
        (OLD.status = 'draft' AND NEW.status = 'review')
        OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected'))
      )
    )
    OR
    -- ADMIN solamente: approved→implemented, implemented→superseded
    (
      get_user_role() = 'ADMIN'
      AND (
        (OLD.status = 'approved' AND NEW.status = 'implemented')
        OR (OLD.status = 'implemented' AND NEW.status = 'superseded')
      )
    )
  );

-- DELETE: solo ADMIN puede eliminar propuestas en draft
DROP POLICY IF EXISTS cip_delete ON public.condition_improvement_proposals;
CREATE POLICY cip_delete ON public.condition_improvement_proposals
  FOR DELETE TO authenticated USING (
    get_user_role() = 'ADMIN'
    AND OLD.status = 'draft'
  );

-- ============================================================
-- FIN MIGRATION: sdd6_improvement_proposals
-- ============================================================
