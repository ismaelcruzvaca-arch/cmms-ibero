-- ============================================================
-- MIGRATION: sdd6_model_change_triggers — Triggers de
--   Validación y Auditoría (SDD 6, PR 1b)
-- Change: condition-monitoring-performance-improvement (PR 1b)
-- ============================================================
-- Implementa:
--   1. trg_model_status_audit — valida transiciones de
--      validation_status en condition_degradation_models
--      + hard gate DRL para promoción a 'active'
--      + auditoría en condition_audit_log
--   2. trg_change_proposal_audit — valida transiciones de
--      status en condition_change_proposals
--      + auditoría en condition_audit_log
--
-- Patrón: BEFORE UPDATE para validar + auditar en una sola
--   función trigger. RAISE EXCEPTION bloquea transiciones
--   inválidas. SECURITY DEFINER permite escribir en
--   condition_audit_log (no tiene política INSERT).
--
-- Idempotente: CREATE OR REPLACE FUNCTION,
--   DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--
-- SQL comments en español.
-- ============================================================

-- ============================================================
-- 1. TRIGGER FUNCTION: trg_model_status_audit_func
--    Valida transiciones de validation_status en el lifecycle
--    de modelos de degradación.
--
--    Transiciones permitidas:
--      draft          → candidate, superseded
--      candidate      → field_trial, rejected, superseded
--      field_trial    → active, rejected, superseded
--      active         → deprecated, superseded
--      deprecated     → superseded
--      rejected       → draft (re-evaluación)
--
--    HARD GATE: promotion a 'active' solo si el DRL del asset
--    cumple con min_data_readiness_level del modelo.
--    Si no, RAISE EXCEPTION.
--
--    Auditoría: inserta en condition_audit_log con acción
--    descriptiva (model_promoted, model_deprecated, etc.)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_model_status_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_action TEXT;
  v_asset_id RECORD;
  v_asset_drl INT;
  v_assets_below_drl INT;
BEGIN
  -- Solo disparar si validation_status realmente cambió
  IF OLD.validation_status IS DISTINCT FROM NEW.validation_status THEN

    -- ============================================================
    -- 1a. VALIDAR transiciones permitidas
    -- ============================================================
    IF NOT (
      (OLD.validation_status = 'draft' AND NEW.validation_status IN ('candidate', 'superseded'))
      OR (OLD.validation_status = 'candidate' AND NEW.validation_status IN ('field_trial', 'rejected', 'superseded'))
      OR (OLD.validation_status = 'field_trial' AND NEW.validation_status IN ('active', 'rejected', 'superseded'))
      OR (OLD.validation_status = 'active' AND NEW.validation_status IN ('deprecated', 'superseded'))
      OR (OLD.validation_status = 'deprecated' AND NEW.validation_status = 'superseded')
      OR (OLD.validation_status = 'rejected' AND NEW.validation_status = 'draft')
    ) THEN
      RAISE EXCEPTION 'Transición inválida de validation_status: % → %',
        OLD.validation_status, NEW.validation_status;
    END IF;

    -- ============================================================
    -- 1b. HARD GATE DRL: promoción a 'active'
    --     Verificar que los assets que usan este modelo tienen
    --     DRL >= min_data_readiness_level
    -- ============================================================
    IF NEW.validation_status = 'active' THEN
      -- Contar assets con DRL insuficiente
      SELECT COUNT(*)::INT INTO v_assets_below_drl
      FROM (
        SELECT DISTINCT w.asset_id
        FROM public.condition_windows w
        WHERE EXISTS (
          -- Asset pertenece a una clase aplicable para este modelo
          SELECT 1
          FROM public.condition_model_applicability cma
          WHERE cma.model_id = NEW.id
            AND EXISTS (
              SELECT 1
              FROM public.assets a
              WHERE a.id = w.asset_id
                AND a.asset_type_id IS NOT NULL
            )
        )
        LIMIT 100  -- safety: máximo 100 assets evaluados
      ) applicable_assets
      WHERE (
        SELECT COALESCE(drl_level, 0)
        FROM public.assess_data_readiness(applicable_assets.asset_id)
        LIMIT 1
      ) < NEW.min_data_readiness_level;

      IF v_assets_below_drl > 0 THEN
        RAISE EXCEPTION 'Cannot activate model: asset DRL below minimum requirement (min DRL: %)',
          NEW.min_data_readiness_level;
      END IF;
    END IF;

    -- ============================================================
    -- 1c. AUDITAR en condition_audit_log
    -- ============================================================
    v_changed_by := COALESCE(
      current_setting('request.jwt.claims', true)::json->>'email',
      current_setting('request.jwt.claims', true)::json->>'sub',
      'system'
    );

    v_action := CASE NEW.validation_status
      WHEN 'active' THEN 'model_promoted'
      WHEN 'deprecated' THEN 'model_deprecated'
      WHEN 'superseded' THEN 'model_superseded'
      WHEN 'rejected' THEN 'model_rejected'
      ELSE 'model_status_changed'
    END;

    INSERT INTO public.condition_audit_log (
      action, entity_type, entity_id,
      before_state, after_state, reason, changed_by
    ) VALUES (
      v_action,
      'condition_degradation_models',
      NEW.id::TEXT,
      jsonb_build_object(
        'validation_status', OLD.validation_status,
        'version', OLD.version,
        'model_key', OLD.model_key
      ),
      jsonb_build_object(
        'validation_status', NEW.validation_status,
        'version', NEW.version,
        'model_key', NEW.model_key
      ),
      'Modelo ' || NEW.model_key || ': ' || OLD.validation_status || ' → ' || NEW.validation_status,
      v_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_model_status_audit_func()
  IS 'Valida transiciones de validation_status en condition_degradation_models. Verifica DRL mínimo para activación. Audita en condition_audit_log.';

-- ============================================================
-- 1d. TRIGGER: trg_model_status_audit
-- ============================================================
DROP TRIGGER IF EXISTS trg_model_status_audit ON public.condition_degradation_models;

CREATE TRIGGER trg_model_status_audit
  BEFORE UPDATE OF validation_status ON public.condition_degradation_models
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_model_status_audit_func();

COMMENT ON TRIGGER trg_model_status_audit ON public.condition_degradation_models
  IS 'Dispara BEFORE UPDATE OF validation_status: valida transiciones, hard gate DRL, audita en condition_audit_log.';

-- ============================================================
-- 2. TRIGGER FUNCTION: trg_change_proposal_audit_func
--    Valida transiciones de status en el lifecycle de
--    propuestas de cambio.
--
--    Transiciones permitidas:
--      draft    → review, rejected
--      review   → approved, rejected
--      approved → active
--      active   → rolled_back
--      rejected → draft (re-apertura excepcional, admin)
--
--    Auditoría: inserta en condition_audit_log con acción
--    según el nuevo status (change_proposed, change_approved,
--    change_rejected, change_activated, change_rolled_back).
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_change_proposal_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_action TEXT;
BEGIN
  -- Solo disparar si status realmente cambió
  IF OLD.status IS DISTINCT FROM NEW.status THEN

    -- ============================================================
    -- 2a. VALIDAR transiciones permitidas
    -- ============================================================
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('review', 'rejected'))
      OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status = 'active')
      OR (OLD.status = 'active' AND NEW.status = 'rolled_back')
      OR (OLD.status = 'rejected' AND NEW.status = 'draft')
    ) THEN
      RAISE EXCEPTION 'Transición inválida de status: % → %',
        OLD.status, NEW.status;
    END IF;

    -- ============================================================
    -- 2b. AUDITAR en condition_audit_log
    -- ============================================================
    v_changed_by := COALESCE(
      current_setting('request.jwt.claims', true)::json->>'email',
      current_setting('request.jwt.claims', true)::json->>'sub',
      'system'
    );

    v_action := CASE NEW.status
      WHEN 'review' THEN 'change_proposed'
      WHEN 'approved' THEN 'change_approved'
      WHEN 'rejected' THEN 'change_rejected'
      WHEN 'active' THEN 'change_activated'
      WHEN 'rolled_back' THEN 'change_rolled_back'
      ELSE 'change_status_changed'
    END;

    INSERT INTO public.condition_audit_log (
      action, entity_type, entity_id,
      before_state, after_state, reason, changed_by
    ) VALUES (
      v_action,
      'condition_change_proposals',
      NEW.id::TEXT,
      jsonb_build_object(
        'status', OLD.status,
        'entity_type', OLD.entity_type,
        'entity_id', OLD.entity_id,
        'proposal_key', OLD.proposal_key
      ),
      jsonb_build_object(
        'status', NEW.status,
        'entity_type', NEW.entity_type,
        'entity_id', NEW.entity_id,
        'proposal_key', NEW.proposal_key
      ),
      'Propuesta ' || NEW.proposal_key || ': ' || OLD.status || ' → ' || NEW.status,
      v_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_change_proposal_audit_func()
  IS 'Valida transiciones de status en condition_change_proposals. Audita en condition_audit_log con acción descriptiva.';

-- ============================================================
-- 2c. TRIGGER: trg_change_proposal_audit
-- ============================================================
DROP TRIGGER IF EXISTS trg_change_proposal_audit ON public.condition_change_proposals;

CREATE TRIGGER trg_change_proposal_audit
  BEFORE UPDATE OF status ON public.condition_change_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_change_proposal_audit_func();

COMMENT ON TRIGGER trg_change_proposal_audit ON public.condition_change_proposals
  IS 'Dispara BEFORE UPDATE OF status: valida transiciones del lifecycle, audita en condition_audit_log.';

-- ============================================================
-- FIN MIGRATION: sdd6_model_change_triggers
-- ============================================================
