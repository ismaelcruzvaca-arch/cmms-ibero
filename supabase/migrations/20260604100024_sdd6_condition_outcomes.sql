-- ============================================================
-- MIGRATION: sdd6_condition_outcomes — Outcomes Table + RLS
--   + record function (SDD 6, PR 2a)
-- Change: condition-monitoring-performance-improvement (PR 2a)
-- ============================================================
-- Crea la tabla de outcomes de condición y su función de
-- inserción controlada:
--   1. condition_outcomes — verdad operacional post-OT
--   2. record_condition_outcome() — SECURITY DEFINER insert
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX
--   IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
--   CREATE OR REPLACE FUNCTION.
--
-- RLS: SELECT → authenticated; sin INSERT directo (solo
--   via función SECURITY DEFINER); UPDATE → ADMIN.
--
-- Dependencias: get_user_role() (migración RBAC).
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TABLA: condition_outcomes
--    Verdad operacional post-OT: modo de falla real,
--    componente, causa y estado de confirmación.
--    Lifecycle separado de condition_diagnosis_feedback.
--    Cierra el ciclo Monitor→Diagnosticar→Actuar→Verificar.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.condition_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID REFERENCES public.condition_diagnoses(id) ON DELETE SET NULL,
  work_order_id TEXT,
  actual_failure_mode TEXT,
  actual_component TEXT,
  actual_cause TEXT,
  confirmed_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confirmed_status IN ('confirmed', 'partial', 'rejected', 'unknown')),
  failure_date TIMESTAMPTZ,
  technician_notes TEXT,
  evidence_quality TEXT CHECK (evidence_quality IN ('high', 'medium', 'low')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.condition_outcomes
  IS 'Verdad operacional post-OT: modo de falla real, componente, causa y estado de confirmación. Lifecycle separado de condition_diagnosis_feedback. Cierra el ciclo Monitor→Diagnosticar→Actuar→Verificar.';

COMMENT ON COLUMN public.condition_outcomes.diagnosis_id
  IS 'FK al diagnóstico de condición evaluado. SET NULL si el diagnóstico se elimina.';
COMMENT ON COLUMN public.condition_outcomes.work_order_id
  IS 'ID textual de la work_order que generó el resultado (sin FK formal — las WO pueden pertenecer a otro dominio)';
COMMENT ON COLUMN public.condition_outcomes.actual_failure_mode
  IS 'Modo de falla real observado en campo (ej: pump.cavitation)';
COMMENT ON COLUMN public.condition_outcomes.actual_component
  IS 'Componente real que falló (si difiere del diagnosticado)';
COMMENT ON COLUMN public.condition_outcomes.actual_cause
  IS 'Causa raíz real identificada post-inspección';
COMMENT ON COLUMN public.condition_outcomes.confirmed_status
  IS 'Estado de confirmación: confirmed (correcto), partial (parcial), rejected (rechazado), unknown (sin evaluar)';
COMMENT ON COLUMN public.condition_outcomes.failure_date
  IS 'Fecha real de la falla (puede diferir de la fecha de diagnóstico)';
COMMENT ON COLUMN public.condition_outcomes.technician_notes
  IS 'Notas del técnico sobre la intervención';
COMMENT ON COLUMN public.condition_outcomes.evidence_quality
  IS 'Calidad de la evidencia que respalda este outcome: high|medium|low';
COMMENT ON COLUMN public.condition_outcomes.reviewed_by
  IS 'Email o user ID de quien revisó y confirmó el outcome';
COMMENT ON COLUMN public.condition_outcomes.reviewed_at
  IS 'Fecha de revisión del outcome';
COMMENT ON COLUMN public.condition_outcomes.created_at
  IS 'Fecha de creación del registro';

-- Índices
CREATE INDEX IF NOT EXISTS idx_out_diagnosis
  ON public.condition_outcomes(diagnosis_id);

CREATE INDEX IF NOT EXISTS idx_out_wo
  ON public.condition_outcomes(work_order_id);

CREATE INDEX IF NOT EXISTS idx_out_status
  ON public.condition_outcomes(confirmed_status);

-- ============================================================
-- 2. RLS: condition_outcomes
--    SELECT → todos los authenticated
--    Sin INSERT directo — solo via SECURITY DEFINER function
--    UPDATE → solo ADMIN
--    Sin DELETE — outcomes son inmutables
-- ============================================================
ALTER TABLE public.condition_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS condition_outcomes_select ON public.condition_outcomes;
CREATE POLICY condition_outcomes_select ON public.condition_outcomes
  FOR SELECT TO authenticated USING (true);

-- Sin INSERT policy — solo via SECURITY DEFINER function
-- Sin DELETE policy — outcomes son inmutables

DROP POLICY IF EXISTS condition_outcomes_update ON public.condition_outcomes;
CREATE POLICY condition_outcomes_update ON public.condition_outcomes
  FOR UPDATE TO authenticated USING (get_user_role() = 'ADMIN')
  WITH CHECK (get_user_role() = 'ADMIN');

-- ============================================================
-- 3. FUNCIÓN: record_condition_outcome()
--    SECURITY DEFINER — inserta un outcome desde el flujo de
--    cierre de OT. También sincroniza feedback_status en la
--    diagnosis vinculada.
--    Retorna el UUID del outcome creado.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_condition_outcome(
  p_diagnosis_id UUID,
  p_work_order_id TEXT DEFAULT NULL,
  p_actual_failure_mode TEXT DEFAULT NULL,
  p_actual_component TEXT DEFAULT NULL,
  p_actual_cause TEXT DEFAULT NULL,
  p_confirmed_status TEXT DEFAULT 'unknown',
  p_failure_date TIMESTAMPTZ DEFAULT NULL,
  p_technician_notes TEXT DEFAULT NULL,
  p_evidence_quality TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outcome_id UUID;
BEGIN
  INSERT INTO public.condition_outcomes (
    diagnosis_id, work_order_id, actual_failure_mode, actual_component,
    actual_cause, confirmed_status, failure_date, technician_notes, evidence_quality
  ) VALUES (
    p_diagnosis_id, p_work_order_id, p_actual_failure_mode, p_actual_component,
    p_actual_cause, p_confirmed_status, p_failure_date, p_technician_notes, p_evidence_quality
  ) RETURNING id INTO v_outcome_id;

  -- Sincronizar feedback_status en la diagnosis vinculada
  UPDATE public.condition_diagnoses
  SET feedback_status = CASE
    WHEN p_confirmed_status = 'confirmed' THEN 'confirmed'
    WHEN p_confirmed_status = 'rejected' THEN 'rejected'
    WHEN p_confirmed_status = 'partial' THEN 'partial'
    ELSE feedback_status
  END,
  feedback_notes = COALESCE(
    feedback_notes || E'\n[Outcome] ' || p_technician_notes,
    '[Outcome] ' || p_technician_notes
  )
  WHERE id = p_diagnosis_id;

  RETURN v_outcome_id;
END;
$$;

COMMENT ON FUNCTION public.record_condition_outcome(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT)
  IS 'Crea un outcome de condición desde el flujo de cierre de OT. SECURITY DEFINER — bypass RLS. Sincroniza feedback_status en la diagnosis vinculada. Retorna el UUID del outcome creado. Parámetros: p_diagnosis_id, p_work_order_id, p_actual_failure_mode, p_actual_component, p_actual_cause, p_confirmed_status, p_failure_date, p_technician_notes, p_evidence_quality.';
