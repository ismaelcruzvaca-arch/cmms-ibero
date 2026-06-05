-- ============================================================
-- MIGRATION: sdd5_governance_triggers_seeds — Triggers, Seeds,
--   Cron y pgTAP (SDD 5, PR 1c)
-- Change: condition-monitoring-operations-governance (PR 1c)
-- ============================================================
-- Crea 4 triggers, 2 políticas semilla, y schedule de pg_cron
-- para el pipeline de governance:
--   1. trg_maint_rec_audit — audita cambios de status en
--      maintenance_recommendations
--   2. trg_policy_audit — audita INSERT/UPDATE/DELETE en
--      condition_automation_policies
--   3. trg_feedback_audit — audita INSERT en
--      condition_diagnosis_feedback
--   4. trg_feedback_summary — sincroniza feedback_status y
--      feedback_notes en condition_diagnoses
--   5. Seeds: 2 políticas default (conservadora, permisiva)
--   6. pg_cron: compute_daily_metrics cada día a las 00:05 UTC
--
-- Idempotente: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF
--   EXISTS + CREATE TRIGGER, ON CONFLICT DO NOTHING.
-- ============================================================

-- ============================================================
-- 1a. TRIGGER FUNCTION: trg_maint_rec_audit_func
--   BEFORE UPDATE OF status ON maintenance_recommendations
--   Captura OLD.status como before_state, NEW.status como
--   after_state. Usa log_audit_entry() para la inserción.
--   Si el status cambia a 'dismissed', pasa dismissed_reason
--   como razón; si no, pasa NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_maint_rec_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Solo auditar si el status realmente cambió
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.log_audit_entry(
      'rec_status_changed',
      'maintenance_recommendations',
      NEW.id::TEXT,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object(
        'status', NEW.status,
        'work_order_id', NEW.work_order_id,
        'superseded_by', NEW.superseded_by
      ),
      NEW.dismissed_reason  -- NULL si no es dismissed
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_maint_rec_audit_func()
  IS 'Trigger function: audita cambios de status en maintenance_recommendations vía log_audit_entry().';

DROP TRIGGER IF EXISTS trg_maint_rec_audit ON public.maintenance_recommendations;
CREATE TRIGGER trg_maint_rec_audit
  BEFORE UPDATE OF status ON public.maintenance_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_maint_rec_audit_func();

COMMENT ON TRIGGER trg_maint_rec_audit ON public.maintenance_recommendations
  IS 'Trigger BEFORE UPDATE OF status: audita cambios en condition_audit_log.';

-- ============================================================
-- 1b. TRIGGER FUNCTION: trg_policy_audit_func
--   AFTER INSERT OR UPDATE OR DELETE ON
--   condition_automation_policies → condition_audit_log
--   INSERT: action=policy_created, before_state=NULL,
--     after_state=NEW row to_jsonb
--   UPDATE: action=policy_updated, before_state=OLD,
--     after_state=NEW
--   DELETE: action=policy_deleted, before_state=OLD,
--     after_state=NULL
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_policy_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_entry(
      'policy_created',
      'condition_automation_policies',
      NEW.id::TEXT,
      NULL,
      to_jsonb(NEW),
      'Política creada: ' || NEW.policy_key
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.log_audit_entry(
      'policy_updated',
      'condition_automation_policies',
      NEW.id::TEXT,
      to_jsonb(OLD),
      to_jsonb(NEW),
      'Política actualizada: ' || NEW.policy_key
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit_entry(
      'policy_deleted',
      'condition_automation_policies',
      OLD.id::TEXT,
      to_jsonb(OLD),
      NULL,
      'Política eliminada: ' || OLD.policy_key
    );
    RETURN OLD;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.trg_policy_audit_func()
  IS 'Trigger function: audita INSERT/UPDATE/DELETE en condition_automation_policies vía log_audit_entry().';

DROP TRIGGER IF EXISTS trg_policy_audit ON public.condition_automation_policies;
CREATE TRIGGER trg_policy_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.condition_automation_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_policy_audit_func();

COMMENT ON TRIGGER trg_policy_audit ON public.condition_automation_policies
  IS 'Trigger AFTER INSERT/UPDATE/DELETE: audita cambios de políticas en condition_audit_log.';

-- ============================================================
-- 1c. TRIGGER FUNCTION: trg_feedback_audit_func
--   AFTER INSERT ON condition_diagnosis_feedback
--   action=diagnosis_feedback_submitted, before_state=NULL,
--   after_state=NEW row to_jsonb
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_feedback_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.log_audit_entry(
    'diagnosis_feedback_submitted',
    'condition_diagnosis_feedback',
    NEW.id::TEXT,
    NULL,
    to_jsonb(NEW),
    'Feedback ' || NEW.feedback_status || ' para diagnóstico ' || NEW.diagnosis_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_feedback_audit_func()
  IS 'Trigger function: audita INSERT en condition_diagnosis_feedback vía log_audit_entry().';

DROP TRIGGER IF EXISTS trg_feedback_audit ON public.condition_diagnosis_feedback;
CREATE TRIGGER trg_feedback_audit
  AFTER INSERT ON public.condition_diagnosis_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feedback_audit_func();

COMMENT ON TRIGGER trg_feedback_audit ON public.condition_diagnosis_feedback
  IS 'Trigger AFTER INSERT: audita nuevo feedback en condition_audit_log.';

-- ============================================================
-- 1d. TRIGGER FUNCTION: trg_feedback_summary_func
--   AFTER INSERT OR UPDATE ON condition_diagnosis_feedback
--   Actualiza condition_diagnoses.feedback_status y
--   feedback_notes con los datos del feedback más reciente.
--   Mantiene las columnas resumen actualizadas sin lógica
--   de aplicación.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_feedback_summary_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.condition_diagnoses
  SET feedback_status = NEW.feedback_status,
      feedback_notes = CONCAT('Via feedback form: ', COALESCE(NEW.technician_observation, ''))
  WHERE id = NEW.diagnosis_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_feedback_summary_func()
  IS 'Trigger function: sincroniza feedback_status/notes en condition_diagnoses desde condition_diagnosis_feedback.';

DROP TRIGGER IF EXISTS trg_feedback_summary ON public.condition_diagnosis_feedback;
CREATE TRIGGER trg_feedback_summary
  AFTER INSERT OR UPDATE ON public.condition_diagnosis_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feedback_summary_func();

COMMENT ON TRIGGER trg_feedback_summary ON public.condition_diagnosis_feedback
  IS 'Trigger AFTER INSERT OR UPDATE: mantiene columnas resumen actualizadas en condition_diagnoses.';

-- ============================================================
-- 2. SEEDS: Políticas default de automatización
--   Dos políticas precargadas: conservadora (requiere revisión
--   humana) y permisiva (auto-confirmación si cumple criterios).
--   Idempotente: ON CONFLICT (policy_key, policy_version)
--   DO NOTHING.
-- ============================================================
INSERT INTO public.condition_automation_policies
  (policy_key, policy_version, policy_name, description,
   conditions, evaluation_order, is_active, created_by)
VALUES
  ('conservative', 1, 'Política Conservadora',
   'Requiere revisión humana a menos que confianza sea muy alta, sin contradicciones, con calidad G0/G1 y fuente activa.',
   '{"min_confidence": 0.85, "max_contradictory_count": 0, "min_completeness": 0.75,
     "min_quality_flag": "G1", "requires_approval": true,
     "allowed_wo_types": ["CBM", "INSPECTION"],
     "asset_criticality_allowed": [],
     "failure_mode_categories": ["asset"],
     "late_data_policy": "block",
     "requires_source_active": true,
     "requires_capability_active": false}',
   10, true, 'system'),

  ('permissive', 1, 'Política Permisiva',
   'Permite auto-confirmar si confianza >= 0.85, sin contradicciones, con calidad G0/G1.',
   '{"min_confidence": 0.85, "max_contradictory_count": 0, "min_completeness": 0.75,
     "min_quality_flag": "G1", "requires_approval": false,
     "allowed_wo_types": ["CBM", "CM"],
     "asset_criticality_allowed": ["A", "B"],
     "failure_mode_categories": ["asset"],
     "late_data_policy": "block",
     "requires_source_active": true,
     "requires_capability_active": false}',
   20, true, 'system')
ON CONFLICT (policy_key, policy_version) DO NOTHING;

-- ============================================================
-- 3. PG_CRON: Schedule diario de compute_daily_metrics
--   Ejecuta a las 00:05 UTC procesando el día anterior.
--   Wrapped en DO block para ser seguro si pg_cron no está
--   disponible (ej: entornos de desarrollo local).
-- ============================================================
DO $cron_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Eliminar schedule previo si existe (idempotente, tolera que no exista)
    BEGIN
      PERFORM cron.unschedule('compute-daily-metrics');
    EXCEPTION WHEN OTHERS THEN
      -- El job no existia, continuar
    END;
    -- Crear nuevo schedule
    PERFORM cron.schedule(
      'compute-daily-metrics',
      '5 0 * * *',
      $cron_job$SELECT compute_daily_metrics(CURRENT_DATE - INTERVAL '1 day')$cron_job$
    );
  END IF;
END;
$cron_block$;

-- ============================================================
-- FIN MIGRATION: sdd5_governance_triggers_seeds
-- ============================================================
