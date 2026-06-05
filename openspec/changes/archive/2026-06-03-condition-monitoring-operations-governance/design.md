# Design: Operations, Governance & Continuous Improvement (SDD 5)

## Technical Approach

**SQL-only governance layer + React dashboard.** All new governance logic lives in PL/pgSQL across 3 idempotent migrations. SDD 4's `generate_recommendation()` is deprecated in favor of `generate_recommendation_v2()` that reads from `condition_automation_policies` (configurable HITL rules replacing hardcoded confidence ≥ 0.7 gates). A dedicated `evaluate_automation_policy()` function returns the matching policy for any diagnosis at generation OR confirmation time. Audit logging is trigger-based (never bypassed). Daily metrics are computed via `pg_cron` into `condition_daily_metrics`, seeding SDD 6's analytics baselines. Data quality stats come from a reusable `compute_source_quality_stats()` function consumed by both the dashboard and SourceManagementPanel.

No new Edge Functions. Frontend adds Dashboard (tab 0), RecommendationList, FeedbackForm (embedded in DiagnosisPanel), PolicyManagementPanel, and extends SourceManagementPanel with quality indicators. Three new hooks: `useDashboardMetrics`, `useRecommendationList`, `useDiagnosisFeedback`.

## Architecture Decisions

### Decision: New `evaluate_automation_policy()` vs inline policy logic in v2

| Option | Tradeoff |
|--------|----------|
| Inline in `generate_recommendation_v2()` | +Fewer functions; —Cannot be called independently at confirmation time (POL-D5-007) |
| Separate `evaluate_automation_policy()` + v2 calls it | +Reusable at any point in the lifecycle; —Extra function call overhead (negligible) |
| **Decision** | `evaluate_automation_policy(p_diagnosis_id)` returns policy metadata. Called by v2 at generation AND by frontend before `convert_recommendation_to_wo()`. |

### Decision: Audit triggers vs application-level logging

| Option | Tradeoff |
|--------|----------|
| Application code calls `log_audit_entry()` on every mutation | +Explicit; —Bypassable, forgettable, breaks if API path changes |
| BEFORE/AFTER triggers on governed tables | +Always fires, never skipped, captures old+new state atomically; —Slightly harder to debug |
| **Decision** | Triggers on `maintenance_recommendations` (BEFORE UPDATE status), `condition_automation_policies` (AFTER INSERT/UPDATE/DELETE), `condition_diagnosis_feedback` (AFTER INSERT). Manual `log_audit_entry()` function for ADMIN overrides. |

### Decision: Feedback table vs inline columns (already answered in proposal, confirmed here)

| Option | Tradeoff |
|--------|----------|
| Inline columns in `condition_diagnoses` | +Simple queries; —No versioning, no WO association, no partial/confirmed/rejected per work order |
| `condition_diagnosis_feedback` table | +Normalized, versioned, traceable per WO; —Requires trigger to sync summary back |
| **Decision** | Separate `condition_diagnosis_feedback` with FK to both `condition_diagnoses` and `work_orders`. Summary columns on `condition_diagnoses` (`feedback_status`, `feedback_notes`) kept via trigger. |

### Decision: `convert_recommendation_to_wo()` as SQL function vs frontend logic

| Option | Tradeoff |
|--------|----------|
| Frontend inserts WO directly + updates recommendation | +Flexible; —Atomicity risk (WO created but status not updated), bypasses audit |
| SQL function that does both in a transaction | +Atomic, auditable, returns WO id; —Frontend must call RPC |
| **Decision** | `convert_recommendation_to_wo(p_recommendation_id)` — single SQL function. BEGIN → INSERT work_order → UPDATE recommendation status+work_order_id → INSERT audit → COMMIT. Returns new WO id. |

### Decision: `condition_daily_metrics` upsert vs INSERT-only

| Option | Tradeoff |
|--------|----------|
| INSERT-only with UNIQUE constraint | +Append-only history; —Re-running on same day fails |
| INSERT ... ON CONFLICT DO UPDATE | +Idempotent, safe for cron; —Slightly more complex SQL |
| **Decision** | `INSERT ... ON CONFLICT (metric_date, asset_id) DO UPDATE` for idempotent cron execution. Re-running on the same day updates the row with fresh counts. |

### Decision: Repeat dismissal gate at function level vs policy condition

| Option | Tradeoff |
|--------|----------|
| In `evaluate_automation_policy()` as a hardcoded check | +Always enforced, cannot be misconfigured; —Not configurable via policy |
| As a `late_data_policy` condition in JSONB | +Configurable window per policy; —Complexity in policy evaluation |
| **Decision** | Hardcoded in `evaluate_automation_policy()`: if diagnosis with same `failure_mode_key` was dismissed/rejected in last 30d → forces `review_required`. This is a safety gate, not a policy knob. Window configurable later if needed. |

## Migration Plan

### Migration 1: `20260603100018_sdd5_governance_tables.sql`

| Section | Content |
|---------|---------|
| Schema | `condition_automation_policies`, `condition_diagnosis_feedback`, `condition_audit_log`, `condition_daily_metrics` |
| ALTER | `maintenance_recommendations`: +status 'expired', +`reviewed_by` TEXT, +`reviewed_at` TIMESTAMPTZ, +`dismissed_reason` TEXT, +`superseded_by` UUID FK self, +`work_order_id` UUID FK `work_orders(id)` ON DELETE SET NULL, extend status CHECK |
| Indexes | All new tables: PK, FK, search, composite |
| RLS | All new tables per role (TECHNICIAN: SELECT+INSERT feedback; PLANNER: full CRUD policies; ADMIN: full CRUD everything) |

### Migration 2: `20260603100019_sdd5_governance_functions.sql`

| Section | Content |
|---------|---------|
| Function | `evaluate_automation_policy(p_diagnosis_id UUID)` — returns policy match |
| Function | `generate_recommendation_v2(p_diagnosis_id UUID)` — uses policies |
| Function | `compute_source_quality_stats()` — quality per source |
| Function | `compute_daily_metrics(p_date DATE DEFAULT CURRENT_DATE)` — idempotent upsert |
| Function | `convert_recommendation_to_wo(p_recommendation_id UUID)` — atomic WO creation |
| Function | `expire_stale_recommendations()` — batch expire |
| Function | `log_audit_entry(...)` — manual audit |
| Deprecate | Comment `generate_recommendation()` as `@deprecated use generate_recommendation_v2` |

### Migration 3: `20260603100020_sdd5_governance_triggers_seeds.sql`

| Section | Content |
|---------|---------|
| Trigger | `trg_rec_status_audit` — BEFORE UPDATE on `maintenance_recommendations.status` |
| Trigger | `trg_policy_audit` — AFTER INSERT/UPDATE/DELETE on `condition_automation_policies` |
| Trigger | `trg_feedback_audit` — AFTER INSERT on `condition_diagnosis_feedback` |
| Trigger | `trg_feedback_summary` — AFTER INSERT on `condition_diagnosis_feedback` → UPDATE `condition_diagnoses.feedback_status + feedback_notes` |
| Seed | Conservative + permissive policies |
| Cron | `SELECT cron.schedule('compute-daily-metrics', '5 0 * * *', 'SELECT compute_daily_metrics()');` |

## Schema Design

### condition_automation_policies

```sql
CREATE TABLE IF NOT EXISTS public.condition_automation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL DEFAULT '{}',
  evaluation_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_automation_policy_key UNIQUE (policy_key),
  CONSTRAINT ck_automation_policy_eval_order CHECK (evaluation_order >= 0)
);

COMMENT ON TABLE public.condition_automation_policies
  IS 'Políticas configurables de automatización HITL. Reemplazan la lógica hardcodeada confidence≥0.7. Evaluadas en orden por evaluation_order.';

COMMENT ON COLUMN public.condition_automation_policies.conditions
  IS 'JSONB schema: {min_confidence NUMERIC, max_contradictory_count INT, min_completeness NUMERIC, min_quality_flag TEXT, required_roles TEXT[], requires_approval BOOLEAN, allowed_wo_types TEXT[], asset_criticality_allowed TEXT[], failure_mode_categories TEXT[], late_data_policy TEXT, requires_source_active BOOLEAN, requires_capability_active BOOLEAN}';

CREATE INDEX IF NOT EXISTS idx_automation_policy_active_order
  ON public.condition_automation_policies(is_active, evaluation_order);

-- RLS: SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN
```

### condition_diagnosis_feedback

```sql
CREATE TABLE IF NOT EXISTS public.condition_diagnosis_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID NOT NULL REFERENCES public.condition_diagnoses(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  feedback_status TEXT NOT NULL
    CHECK (feedback_status IN ('confirmed', 'partial', 'rejected')),
  actual_failure_mode TEXT,
  actual_component TEXT,
  actual_cause TEXT,
  technician_observation TEXT,
  was_recommendation_useful BOOLEAN,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.condition_diagnosis_feedback
  IS 'Feedback técnico sobre diagnósticos de condición. Cada fila representa una evaluación de un diagnóstico vinculado a una OT.';

CREATE INDEX IF NOT EXISTS idx_diag_feedback_diagnosis
  ON public.condition_diagnosis_feedback(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_diag_feedback_wo
  ON public.condition_diagnosis_feedback(work_order_id);
CREATE INDEX IF NOT EXISTS idx_diag_feedback_status
  ON public.condition_diagnosis_feedback(feedback_status);

-- RLS: TECHNICIAN INSERT; PLANNER/ADMIN UPDATE; authenticated SELECT
```

### condition_audit_log

```sql
CREATE TABLE IF NOT EXISTS public.condition_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL
    CHECK (action IN ('policy_changed', 'rec_status_changed', 'diagnosis_feedback',
                      'rec_dismissed', 'rec_converted_to_wo', 'policy_override')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.condition_audit_log
  IS 'Auditoría INMUTABLE de acciones de governance. INSERT-only — no existe UPDATE/DELETE policy.';

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON public.condition_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON public.condition_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at
  ON public.condition_audit_log(changed_at DESC);

-- RLS: SELECT → authenticated; INSERT → solo ADMIN via log_audit_entry(); NO UPDATE/DELETE policies exist
```

### condition_daily_metrics

```sql
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_daily_metrics_date_asset UNIQUE (metric_date, asset_id)
);

COMMENT ON TABLE public.condition_daily_metrics
  IS 'Métricas diarias agregadas por asset. Infraestructura de datos para SDD 6. Poblada por cron vía compute_daily_metrics().';

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date
  ON public.condition_daily_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_asset
  ON public.condition_daily_metrics(asset_id);

-- RLS: SELECT → authenticated; INSERT/UPDATE → solo via function (SECURITY DEFINER)
```

### ALTER maintenance_recommendations

```sql
-- Extend status CHECK to include 'expired'
ALTER TABLE public.maintenance_recommendations
  DROP CONSTRAINT IF EXISTS maintenance_recommendations_status_check;

ALTER TABLE public.maintenance_recommendations
  ADD CONSTRAINT maintenance_recommendations_status_check
    CHECK (status IN ('suggested', 'review_required', 'approved',
                      'dismissed', 'converted_to_wo', 'expired'));

-- New columns
ALTER TABLE public.maintenance_recommendations
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by UUID
    REFERENCES public.maintenance_recommendations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_order_id UUID
    REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mr_status ON public.maintenance_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_mr_superseded ON public.maintenance_recommendations(superseded_by);
CREATE INDEX IF NOT EXISTS idx_mr_wo ON public.maintenance_recommendations(work_order_id);

COMMENT ON COLUMN public.maintenance_recommendations.status
  IS 'suggested|review_required|approved|dismissed|converted_to_wo|expired';
COMMENT ON COLUMN public.maintenance_recommendations.superseded_by
  IS 'Auto-referencia FK: si esta recomendación fue reemplazada por otra mejor';
COMMENT ON COLUMN public.maintenance_recommendations.work_order_id
  IS 'FK a work_orders: la OT que se generó desde esta recomendación';
```

### Composite indexes for dashboard performance

```sql
CREATE INDEX IF NOT EXISTS idx_diag_asset_status_created
  ON public.condition_diagnoses(asset_id, diagnosis_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_asset_type_window
  ON public.condition_analysis_results(asset_id, analysis_type, window_end DESC);
```

## SQL Functions

### evaluate_automation_policy(p_diagnosis_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.evaluate_automation_policy(
  p_diagnosis_id UUID
) RETURNS TABLE(
  policy_key TEXT,
  policy_name TEXT,
  requires_confirmation BOOLEAN,
  policy_metadata JSONB
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_diag RECORD;
  v_fm RECORD;
  v_policy RECORD;
  v_conditions JSONB;
  v_prev_dismissed BOOLEAN;
BEGIN
  -- 1. Read diagnosis + failure mode
  SELECT d.*, fm.failure_mode_key, fm.severity_default
  INTO v_diag, v_fm
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    RETURN; -- empty result = no policy matched
  END IF;

  -- 2. Repeat dismissal gate: same failure_mode_key dismissed/rejected in last 30d?
  SELECT EXISTS (
    SELECT 1 FROM public.maintenance_recommendations mr
    JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
    JOIN public.condition_failure_mode_catalog fm ON cd.failure_mode_id = fm.id
    WHERE fm.failure_mode_key = v_fm.failure_mode_key
      AND mr.status IN ('dismissed', 'converted_to_wo')
      AND mr.created_at >= NOW() - INTERVAL '30 days'
  ) INTO v_prev_dismissed;

  IF v_prev_dismissed THEN
    RETURN QUERY SELECT
      'repeat_dismissal_gate'::TEXT AS policy_key,
      'Repetición post-dismissal'::TEXT AS policy_name,
      true::BOOLEAN AS requires_confirmation,
      jsonb_build_object(
        'reason', 'repeat_dismissal',
        'message', 'Diagnóstico previo mismo FM fue descartado en últimos 30d'
      ) AS policy_metadata;
    RETURN;
  END IF;

  -- 3. Find first matching active policy ordered by evaluation_order
  FOR v_policy IN
    SELECT *
    FROM public.condition_automation_policies
    WHERE is_active = true
    ORDER BY evaluation_order ASC
  LOOP
    v_conditions := v_policy.conditions;

    -- Check min_confidence
    IF (v_conditions->>'min_confidence')::NUMERIC IS NOT NULL
       AND COALESCE(v_diag.confidence, 0) < (v_conditions->>'min_confidence')::NUMERIC
    THEN
      CONTINUE;
    END IF;

    -- Check failure_mode_categories (empty = applies to all)
    IF v_conditions->>'failure_mode_categories' IS NOT NULL
       AND jsonb_typeof(v_conditions->'failure_mode_categories') = 'array'
       AND jsonb_array_length(v_conditions->'failure_mode_categories') > 0
       AND NOT (v_conditions->'failure_mode_categories') ? v_fm.failure_mode_key
    THEN
      CONTINUE;
    END IF;

    -- Check asset_criticality_allowed (empty = applies to all)
    IF v_conditions->>'asset_criticality_allowed' IS NOT NULL
       AND jsonb_typeof(v_conditions->'asset_criticality_allowed') = 'array'
       AND jsonb_array_length(v_conditions->'asset_criticality_allowed') > 0
       AND NOT (v_conditions->'asset_criticality_allowed') ? v_fm.severity_default
    THEN
      CONTINUE;
    END IF;

    -- First matching policy wins
    RETURN QUERY SELECT
      v_policy.policy_key,
      v_policy.policy_name,
      COALESCE((v_conditions->>'requires_approval')::BOOLEAN, true) AS requires_confirmation,
      jsonb_build_object(
        'policy_id', v_policy.id,
        'evaluation_order', v_policy.evaluation_order,
        'conditions_applied', v_conditions
      ) AS policy_metadata;
    RETURN;
  END LOOP;

  -- 4. Fallback: no policy matched → requires confirmation (fail safe)
  RETURN QUERY SELECT
    'fallback_conservative'::TEXT,
    'Fallback conservador (sin política)'::TEXT,
    true::BOOLEAN,
    jsonb_build_object('reason', 'no_matching_policy');
END;
$$;

COMMENT ON FUNCTION public.evaluate_automation_policy(UUID)
  IS 'Evalúa políticas HITL para un diagnóstico. Retorna la primera política que matchea o fallback. Chequea repeat_dismissal_gate de últimos 30d.';
```

### generate_recommendation_v2(p_diagnosis_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.generate_recommendation_v2(
  p_diagnosis_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_diag RECORD;
  v_fm RECORD;
  v_policy RECORD;
  v_action TEXT;
  v_priority TEXT;
  v_due_days INT;
  v_wo_type TEXT;
  v_confirm BOOLEAN;
  v_recommendation_id UUID;
  v_policy_metadata JSONB;
BEGIN
  -- 1. Read diagnosis + failure_mode
  SELECT d.*, fm.severity_default, fm.failure_mode_key, fm.typical_effects
  INTO v_diag, v_fm
  FROM public.condition_diagnoses d
  JOIN public.condition_failure_mode_catalog fm ON d.failure_mode_id = fm.id
  WHERE d.id = p_diagnosis_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 2. Evaluate policy
  SELECT p.policy_key, p.requires_confirmation, p.policy_metadata
  INTO v_policy
  FROM public.evaluate_automation_policy(p_diagnosis_id) p;

  v_confirm := v_policy.requires_confirmation;
  v_policy_metadata := v_policy.policy_metadata;

  -- 3. Determine action text (same as v1)
  v_action := 'Inspeccionar ' || v_fm.failure_mode_key || ' — '
              || COALESCE(v_fm.typical_effects::TEXT, 'posible degradación');

  -- 4. Priority (same as v1 — severity + confidence)
  v_priority := CASE
    WHEN v_diag.confidence >= 0.85 AND v_fm.severity_default IN ('critical', 'high')
      THEN 'critical'
    WHEN v_diag.confidence >= 0.7 AND v_fm.severity_default IN ('high', 'medium')
      THEN 'high'
    WHEN v_diag.confidence >= 0.5 THEN 'medium'
    ELSE 'low'
  END;

  -- 5. Due window (from PF-curve or RUL)
  v_due_days := COALESCE(
    (SELECT intervention_window_days FROM public.condition_pf_curves
     WHERE failure_mode_key = v_fm.failure_mode_key LIMIT 1),
    LEAST(CEIL(COALESCE(
      (SELECT result_value FROM public.condition_analysis_results
       WHERE asset_id = v_diag.asset_id
         AND analysis_type = 'rul_estimate'
       ORDER BY window_end DESC LIMIT 1), 30
    )), 90)::INT
  );

  -- 6. WO type (from policy or default)
  v_wo_type := CASE
    WHEN v_priority = 'critical' THEN 'CM'
    WHEN v_priority = 'high' THEN 'CBM'
    ELSE 'INSPECTION'
  END;

  -- 7. Insert recommendation with status from policy
  INSERT INTO public.maintenance_recommendations (
    diagnosis_id, recommended_action, priority,
    due_window_days, work_order_type, requires_confirmation,
    status
  ) VALUES (
    p_diagnosis_id, v_action, v_priority,
    v_due_days, v_wo_type, v_confirm,
    CASE WHEN v_confirm THEN 'review_required' ELSE 'suggested' END
  ) RETURNING id INTO v_recommendation_id;

  -- 8. Log which policy was used (in recommendation or audit)
  -- The policy_key is stored for traceability; audit trigger on INSERT could log this
  -- but we store it inline in a comment or via a lightweight audit entry
  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id, after_state, reason, changed_by
  ) VALUES (
    'rec_status_changed', 'maintenance_recommendations',
    v_recommendation_id::TEXT,
    jsonb_build_object(
      'policy_key', v_policy.policy_key,
      'policy_metadata', v_policy_metadata,
      'diagnosis_id', p_diagnosis_id,
      'status', CASE WHEN v_confirm THEN 'review_required' ELSE 'suggested' END
    ),
    'Recomendación generada vía política: ' || COALESCE(v_policy.policy_key, 'fallback'),
    'system'
  );

  RETURN v_recommendation_id;
END;
$$;

COMMENT ON FUNCTION public.generate_recommendation_v2(UUID)
  IS 'v2 de generate_recommendation(). Lee políticas HITL desde condition_automation_policies vía evaluate_automation_policy(). Fallback conservador si no hay política.';
```

### compute_source_quality_stats()

```sql
CREATE OR REPLACE FUNCTION public.compute_source_quality_stats()
RETURNS TABLE(
  source_id TEXT,
  source_name TEXT,
  total_values BIGINT,
  g0_pct NUMERIC,
  g1_pct NUMERIC,
  g2_pct NUMERIC,
  g3_pct NUMERIC,
  last_data_at TIMESTAMPTZ,
  dead_letter_count BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH quality_counts AS (
    SELECT
      cs.source_id,
      cs.name AS source_name,
      COUNT(cfv.id) AS total_values,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G0') AS g0_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G1') AS g1_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G2') AS g2_count,
      COUNT(cfv.id) FILTER (WHERE cfv.quality_flag = 'G3') AS g3_count,
      MAX(cw.window_end) AS last_data_at
    FROM public.condition_sources cs
    LEFT JOIN public.condition_source_capabilities csc ON cs.source_id = csc.source_id
    LEFT JOIN public.condition_feature_definitions cfd ON csc.can_produce = cfd.feature_key
    LEFT JOIN public.condition_feature_values cfv ON cfv.feature_definition_id = cfd.id
    LEFT JOIN public.condition_windows cw ON cfv.window_id = cw.id AND cw.source_id = cs.source_id
    GROUP BY cs.source_id, cs.name
  ),
  dead_letter_counts AS (
    SELECT source_id, COUNT(*) AS dl_count
    FROM public.condition_ingest_failures
    GROUP BY source_id
  )
  SELECT
    qc.source_id,
    qc.source_name,
    qc.total_values,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g0_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g1_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g2_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    CASE WHEN qc.total_values > 0
      THEN ROUND((qc.g3_count::NUMERIC / qc.total_values) * 100, 1) ELSE 0 END,
    qc.last_data_at,
    COALESCE(dlc.dl_count, 0)
  FROM quality_counts qc
  LEFT JOIN dead_letter_counts dlc ON qc.source_id = dlc.source_id
  ORDER BY qc.source_name;
END;
$$;

COMMENT ON FUNCTION public.compute_source_quality_stats()
  IS 'Calcula distribución de calidad G0-G3 por fuente, última fecha de dato, y conteo de dead-letter. Usada por dashboard y SourceManagementPanel.';
```

### compute_daily_metrics(p_date DATE DEFAULT CURRENT_DATE)

```sql
CREATE OR REPLACE FUNCTION public.compute_daily_metrics(
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_count INT := 0;
BEGIN
  FOR v_asset IN
    SELECT DISTINCT asset_id FROM public.condition_diagnoses
    WHERE created_at::DATE <= p_date
    UNION
    SELECT DISTINCT asset_id FROM public.maintenance_recommendations mr
    JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
    WHERE mr.created_at::DATE <= p_date
  LOOP
    INSERT INTO public.condition_daily_metrics AS m (
      metric_date, asset_id,
      diagnoses_created, diagnoses_confirmed, diagnoses_rejected,
      recommendations_created, recommendations_approved,
      recommendations_dismissed, recommendations_converted_to_wo,
      cbm_wo_created, cbm_wo_closed,
      feedback_pending_count
    ) VALUES (
      p_date, v_asset.asset_id,

      -- diagnoses_created: count of diagnoses created on this date for this asset
      (SELECT COUNT(*) FROM public.condition_diagnoses
       WHERE asset_id = v_asset.asset_id AND created_at::DATE = p_date),

      -- diagnoses_confirmed: count of feedback with status=confirmed for this asset's diagnoses
      (SELECT COUNT(*) FROM public.condition_diagnosis_feedback df
       JOIN public.condition_diagnoses cd ON df.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND df.feedback_status = 'confirmed'
         AND df.created_at::DATE = p_date),

      -- diagnoses_rejected: same for rejected
      (SELECT COUNT(*) FROM public.condition_diagnosis_feedback df
       JOIN public.condition_diagnoses cd ON df.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND df.feedback_status = 'rejected'
         AND df.created_at::DATE = p_date),

      -- recommendations_created
      (SELECT COUNT(*) FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id AND mr.created_at::DATE = p_date),

      -- recommendations_approved
      (SELECT COUNT(*) FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'approved'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- recommendations_dismissed
      (SELECT COUNT(*) FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'dismissed'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- recommendations_converted_to_wo
      (SELECT COUNT(*) FROM public.maintenance_recommendations mr
       JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
       WHERE cd.asset_id = v_asset.asset_id
         AND mr.status = 'converted_to_wo'
         AND COALESCE(mr.reviewed_at, mr.created_at)::DATE = p_date),

      -- cbm_wo_created: work_orders with wo_type matching CBM patterns
      (SELECT COUNT(*) FROM public.work_orders
       WHERE asset_id = v_asset.asset_id
         AND (wo_type IN ('CBM', 'CM') OR wo_type ILIKE '%CBM%')
         AND created_at::DATE = p_date),

      -- cbm_wo_closed
      (SELECT COUNT(*) FROM public.work_orders
       WHERE asset_id = v_asset.asset_id
         AND (wo_type IN ('CBM', 'CM') OR wo_type ILIKE '%CBM%')
         AND status = 'closed'
         AND COALESCE(completed_at, updated_at)::DATE = p_date),

      -- feedback_pending_count: diagnoses with feedback_status = NULL on condition_diagnoses
      (SELECT COUNT(*) FROM public.condition_diagnoses
       WHERE asset_id = v_asset.asset_id
         AND feedback_status IS NULL
         AND diagnosis_status IN ('active', 'confirmed'))
    )
    ON CONFLICT (metric_date, asset_id) DO UPDATE SET
      diagnoses_created = EXCLUDED.diagnoses_created,
      diagnoses_confirmed = EXCLUDED.diagnoses_confirmed,
      diagnoses_rejected = EXCLUDED.diagnoses_rejected,
      recommendations_created = EXCLUDED.recommendations_created,
      recommendations_approved = EXCLUDED.recommendations_approved,
      recommendations_dismissed = EXCLUDED.recommendations_dismissed,
      recommendations_converted_to_wo = EXCLUDED.recommendations_converted_to_wo,
      cbm_wo_created = EXCLUDED.cbm_wo_created,
      cbm_wo_closed = EXCLUDED.cbm_wo_closed,
      feedback_pending_count = EXCLUDED.feedback_pending_count;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.compute_daily_metrics(DATE)
  IS 'Agrega métricas diarias por asset a condition_daily_metrics. Idempotente: ON CONFLICT DO UPDATE. Retorna cantidad de assets procesados.';
```

### convert_recommendation_to_wo(p_recommendation_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.convert_recommendation_to_wo(
  p_recommendation_id UUID
) RETURNS UUID  -- returns work_order_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_wo_id UUID;
  v_diag RECORD;
  v_audit_before JSONB;
BEGIN
  -- 1. Read recommendation with diagnosis
  SELECT mr.*, cd.asset_id
  INTO v_rec
  FROM public.maintenance_recommendations mr
  JOIN public.condition_diagnoses cd ON mr.diagnosis_id = cd.id
  WHERE mr.id = p_recommendation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recommendation not found: %', p_recommendation_id;
  END IF;

  -- 2. Gate: only approved recommendations can be converted
  IF v_rec.status NOT IN ('approved', 'suggested') THEN
    RAISE EXCEPTION 'Cannot convert recommendation with status % (requires approved)', v_rec.status;
  END IF;

  v_audit_before := jsonb_build_object('status', v_rec.status, 'work_order_id', v_rec.work_order_id);

  -- 3. Create work_order
  INSERT INTO public.work_orders (
    asset_id, title, description, wo_type,
    priority, status, created_by
  ) VALUES (
    v_rec.asset_id,
    v_rec.recommended_action,
    'Generado desde recomendación de condición: ' || v_rec.id::TEXT,
    COALESCE(v_rec.work_order_type, 'CBM'),
    v_rec.priority,
    'open',
    'system'
  ) RETURNING id INTO v_wo_id;

  -- 4. Update recommendation
  UPDATE public.maintenance_recommendations
  SET status = 'converted_to_wo',
      work_order_id = v_wo_id,
      reviewed_by = current_setting('request.jwt.claims', true)::json->>'email',
      reviewed_at = NOW()
  WHERE id = p_recommendation_id;

  -- 5. Audit is handled by trigger trg_rec_status_audit

  RETURN v_wo_id;
END;
$$;

COMMENT ON FUNCTION public.convert_recommendation_to_wo(UUID)
  IS 'Convierte una recomendación aprobada en OT. Crea work_order, actualiza status y link.';
```

### expire_stale_recommendations()

```sql
CREATE OR REPLACE FUNCTION public.expire_stale_recommendations()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.maintenance_recommendations
  SET status = 'expired'
  WHERE status IN ('suggested', 'review_required')
    AND due_window_days IS NOT NULL
    AND created_at + (due_window_days || ' days')::INTERVAL < NOW()
  RETURNING 1 INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.expire_stale_recommendations()
  IS 'Marca como expired recomendaciones cuyo due_window_days pasó y siguen suggested/review_required.';
```

### log_audit_entry()

```sql
CREATE OR REPLACE FUNCTION public.log_audit_entry(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_before_state JSONB DEFAULT NULL,
  p_after_state JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_id UUID;
BEGIN
  v_changed_by := COALESCE(
    current_setting('request.jwt.claims', true)::json->>'email',
    current_setting('request.jwt.claims', true)::json->>'sub',
    'unknown'
  );

  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id,
    before_state, after_state, reason, changed_by
  ) VALUES (
    p_action, p_entity_type, p_entity_id,
    p_before_state, p_after_state, p_reason, v_changed_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_audit_entry(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT)
  IS 'Inserta entrada manual en audit log. Solo ADMIN puede llamar (RLS en la función).';
```

## Triggers

### Audit: maintenance_recommendations status change

```sql
CREATE OR REPLACE FUNCTION public.trg_rec_status_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_changed_by := COALESCE(
      current_setting('request.jwt.claims', true)::json->>'email',
      current_setting('request.jwt.claims', true)::json->>'sub',
      'system'
    );

    INSERT INTO public.condition_audit_log (
      action, entity_type, entity_id,
      before_state, after_state, reason, changed_by
    ) VALUES (
      CASE
        WHEN NEW.status = 'dismissed' THEN 'rec_dismissed'
        WHEN NEW.status = 'converted_to_wo' THEN 'rec_converted_to_wo'
        ELSE 'rec_status_changed'
      END,
      'maintenance_recommendations',
      NEW.id::TEXT,
      jsonb_build_object('status', OLD.status, 'dismissed_reason', OLD.dismissed_reason),
      jsonb_build_object('status', NEW.status, 'dismissed_reason', NEW.dismissed_reason,
                         'work_order_id', NEW.work_order_id, 'superseded_by', NEW.superseded_by),
      CASE WHEN NEW.status = 'dismissed' THEN NEW.dismissed_reason ELSE NULL END,
      v_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_rec_status_audit
  BEFORE UPDATE OF status ON public.maintenance_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_rec_status_audit_func();
```

### Audit: condition_automation_policies changes

```sql
CREATE OR REPLACE FUNCTION public.trg_policy_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_action TEXT;
  v_old_json JSONB;
  v_new_json JSONB;
BEGIN
  v_changed_by := COALESCE(
    current_setting('request.jwt.claims', true)::json->>'email',
    current_setting('request.jwt.claims', true)::json->>'sub',
    'system'
  );

  IF TG_OP = 'INSERT' THEN
    v_action := 'policy_changed';
    v_new_json := to_jsonb(NEW);
    INSERT INTO public.condition_audit_log
      (action, entity_type, entity_id, after_state, reason, changed_by)
    VALUES
      (v_action, 'condition_automation_policies', NEW.id::TEXT,
       v_new_json, 'Política creada: ' || NEW.policy_key, v_changed_by);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'policy_changed';
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    INSERT INTO public.condition_audit_log
      (action, entity_type, entity_id, before_state, after_state, reason, changed_by)
    VALUES
      (v_action, 'condition_automation_policies', NEW.id::TEXT,
       v_old_json, v_new_json, 'Política actualizada: ' || NEW.policy_key, v_changed_by);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'policy_changed';
    INSERT INTO public.condition_audit_log
      (action, entity_type, entity_id, before_state, reason, changed_by)
    VALUES
      (v_action, 'condition_automation_policies', OLD.id::TEXT,
       to_jsonb(OLD), 'Política eliminada: ' || OLD.policy_key, v_changed_by);
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE TRIGGER trg_policy_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.condition_automation_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_policy_audit_func();
```

### Audit: diagnosis_feedback INSERT

```sql
CREATE OR REPLACE FUNCTION public.trg_feedback_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.condition_audit_log (
    action, entity_type, entity_id, after_state, reason, changed_by
  ) VALUES (
    'diagnosis_feedback',
    'condition_diagnosis_feedback',
    NEW.id::TEXT,
    jsonb_build_object(
      'diagnosis_id', NEW.diagnosis_id,
      'feedback_status', NEW.feedback_status,
      'work_order_id', NEW.work_order_id,
      'was_recommendation_useful', NEW.was_recommendation_useful
    ),
    'Feedback ' || NEW.feedback_status || ' para diagnóstico ' || NEW.diagnosis_id,
    NEW.reviewed_by
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_feedback_audit
  AFTER INSERT ON public.condition_diagnosis_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feedback_audit_func();
```

### Summary: feedback → condition_diagnoses

```sql
CREATE OR REPLACE FUNCTION public.trg_feedback_summary_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.condition_diagnoses
  SET feedback_status = NEW.feedback_status,
      feedback_notes = CONCAT(
        'Técnico: ', NEW.technician_observation,
        ' | Modo real: ', COALESCE(NEW.actual_failure_mode, 'N/A'),
        ' | Componente: ', COALESCE(NEW.actual_component, 'N/A')
      )
  WHERE id = NEW.diagnosis_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_feedback_summary
  AFTER INSERT ON public.condition_diagnosis_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_feedback_summary_func();
```

## Seeds

### 2 default automation policies

```sql
INSERT INTO public.condition_automation_policies (
  policy_key, policy_name, description,
  conditions, evaluation_order, is_active
) VALUES
(
  'conservative',
  'Conservadora (revisión requerida)',
  'Política predeterminada: toda recomendación requiere revisión humana a menos que tenga confianza muy alta, completez completa y cero contradicciones.',
  '{
    "min_confidence": 0.7,
    "max_contradictory_count": 0,
    "min_completeness": 0.8,
    "requires_approval": true,
    "failure_mode_categories": [],
    "asset_criticality_allowed": []
  }'::JSONB,
  10,
  true
),
(
  'permissive',
  'Permisiva (auto-confianza alta)',
  'Permite auto-confirmación para diagnósticos con confianza ≥ 0.85, calidad G0/G1. Aplica a modos de falla no críticos.',
  '{
    "min_confidence": 0.85,
    "max_contradictory_count": 1,
    "min_completeness": 0.6,
    "min_quality_flag": "G1",
    "requires_approval": false,
    "failure_mode_categories": [],
    "asset_criticality_allowed": ["low", "medium"]
  }'::JSONB,
  20,
  true
) ON CONFLICT (policy_key) DO NOTHING;
```

## Frontend Design

### App.jsx — Dashboard as tab 0

The Condition Monitoring section adds Dashboard as **sub-tab 0** (before Captura). The existing sub-tab indexes shift by 1:

```jsx
// New sub-tab order for PLANNER/ADMIN:
// Dashboard=0, Captura=1, CSV=2, Fuentes=3, Dead-Letter=4, Tendencias=5, Diagnóstico=6
<Tabs value={conditionSubTab} onChange={(e, v) => setConditionSubTab(v)}>
  <Tab label="Dashboard" />
  <Tab label="Captura" />
  {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="CSV" />}
  <Tab label="Fuentes" />
  {(userRole === 'PLANNER' || userRole === 'ADMIN') && <Tab label="Dead-Letter" />}
  <Tab label="Tendencias" />
  <Tab label="Diagnóstico" />
</Tabs>
```

Dashboard renders tiles at sub-tab 0. Clicking a tile sets `conditionSubTab` to the target index (e.g., Diagnóstico for critical assets).

### Component hierarchy

```
App.jsx
 └─ Condition Dashboard (tab 0, sub-tab 0)
     ├─ MetricTile (asset count — reusable)
     ├─ MetricTile (open diagnoses by FM)
     ├─ MetricTile (top 5 RUL)
     ├─ MetricTile (pending recs by priority)
     ├─ MetricTile (quality % by source)
     └─ MetricTile (stale sources)
 └─ DiagnosisPanel (existing, modified)
     └─ FeedbackForm (NEW — expandable row)
 └─ RecommendationList (NEW — tab or standalone)
     ├─ FilterBar (status, priority)
     └─ RecommendationRow (approve, dismiss, supersede, convert)
 └─ SourceManagementPanel (extended)
     └─ QualityBadge (NEW — per source)
 └─ PolicyManagementPanel (NEW — PLANNER/ADMIN only)
     ├─ PolicyList (table)
     └─ PolicyEditor (form)
```

### Component specifications

**Dashboard** (`src/components/condition/Dashboard.jsx`)
- **Props**: `onNavigate` (callback → sets sub-tab index + optional filters)
- **Data**: aggregated via `useDashboardMetrics`
- **Tiles**: 7 tiles using MUI Paper + Grid
  - Active assets with critical diagnoses → count, clickable → DiagnosisPanel
  - Open diagnoses by FM → stacked bar, clickable by FM
  - Top 5 RUL → sorted list, red highlight < 7d
  - Pending recommendations → counts by priority, clickable → RecommendationList filtered
  - Quality G0-G3 by source → per-source breakdown
  - Stale sources → list with time since last data
  - Dead-letter count → clickable → DeadLetterPanel

**RecommendationList** (`src/components/condition/RecommendationList.jsx`)
- **Props**: `initialFilter` (optional {status, priority})
- **Data**: `useRecommendationList({ status, priority })`
- **Features**:
  - Filter bar: status dropdown (suggested, review_required, approved, dismissed, expired) + priority chips
  - Table with columns: asset_id, failure_mode, recommended_action, priority chip, status badge, due_window, created_at, actions
  - Actions per row (RLS-gated):
    - "Aprobar" (PLANNER/ADMIN) → calls UPDATE status='approved'
    - "Descartar" (ADMIN) → opens dialog for dismissed_reason
    - "Superseder" (ADMIN) → opens recommendation selector
    - "Convertir a OT" (ADMIN) → calls `convert_recommendation_to_wo()` RPC
  - Empty state: "Sin recomendaciones" with filter reset CTA

**FeedbackForm** (`src/components/condition/FeedbackForm.jsx`)
- **Props**: `diagnosisId`, `diagnosisStatus`, `assetId`, `onSubmit`
- **Renders**: expandable form inside DiagnosisPanel row detail
- **Fields**: feedback_status (radio: confirmed/partial/rejected), actual_failure_mode, actual_component, actual_cause, technician_observation (textarea), was_recommendation_useful (switch), work_order selector
- **Validation**: feedback_status required; at least one of actual_failure_mode/component/cause
- **Submit**: INSERT into `condition_diagnosis_feedback` via `useDiagnosisFeedback`
- **RLS**: TECHNICIAN can INSERT; PLANNER/ADMIN can UPDATE

**PolicyManagementPanel** (`src/components/condition/PolicyManagementPanel.jsx`)
- **Props**: none (role-gated internally)
- **Data**: direct Supabase query on `condition_automation_policies`
- **Features**:
  - Table: policy_key, policy_name, evaluation_order, is_active chip, created_at
  - "Nueva política" button → opens PolicyEditor dialog
  - Row actions: Edit (opens PolicyEditor), Toggle active/inactive, Delete (ADMIN only)
- **PolicyEditor** (inline dialog):
  - policy_key (text, read-only on edit), policy_name, description
  - Conditions editor: JSONB fields with MUI inputs for each key
  - evaluation_order, is_active toggle
  - Save → INSERT or UPDATE

**SourceManagementPanel** (extended)
- **New columns**: Quality badge (G0-G3 dominant %, color-coded), last_data_at, dead-letter count badge
- **Quality badge** uses `compute_source_quality_stats()` via a new sub-hook or direct RPC call
- Stale sources get a warning icon next to name

### Existing component modifications

**DiagnosisPanel** — two changes:
1. Existing table columns unchanged
2. In the expandable evidence row (Collapse), add FeedbackForm at the bottom for diagnoses with status `active` or `confirmed`
3. The "Generar OT" button calls `generate_recommendation_v2()` instead of the deprecated v1

**RecommendationCard** — deprecated in favor of RecommendationList. Kept for backward compatibility with a deprecation comment; can show the first pending recommendation for the selected asset.

### Hooks

**useDashboardMetrics()**
```js
// Parallel queries:
// 1. Active assets with critical diagnoses
//    SELECT COUNT(DISTINCT asset_id) FROM condition_diagnoses
//    WHERE diagnosis_status='active' AND confidence >= 0.7
// 2. Open diagnoses grouped by FM
//    SELECT fm.failure_mode_key, COUNT(*) ...
// 3. Top 5 lowest RUL
//    SELECT asset_id, result_value FROM condition_analysis_results
//    WHERE analysis_type='rul_estimate' ORDER BY result_value LIMIT 5
// 4. Pending recommendations
//    SELECT priority, COUNT(*) FROM maintenance_recommendations
//    WHERE status IN ('suggested','review_required') GROUP BY priority
// 5. Quality stats → compute_source_quality_stats() RPC
// 6. Stale sources → SELECT * FROM condition_sources WHERE last_seen_at < NOW() - INTERVAL '24h'
// 7. Dead-letter count → SELECT source_id, COUNT(*) FROM condition_ingest_failures GROUP BY source_id
```

**useRecommendationList({ status, priority })**
```js
// SELECT mr.*, cd.asset_id, fm.failure_mode_key, fm.name AS failure_mode_name
// FROM maintenance_recommendations mr
// JOIN condition_diagnoses cd ON mr.diagnosis_id = cd.id
// JOIN condition_failure_mode_catalog fm ON cd.failure_mode_id = fm.id
// WHERE ($1 IS NULL OR mr.status = $1)
//   AND ($2 IS NULL OR mr.priority = $2)
// ORDER BY mr.created_at DESC
```

**useDiagnosisFeedback({ diagnosisId })**
```js
// INSERT via supabase.from('condition_diagnosis_feedback').insert({...})
// Also exposes:
// - fetchFeedback(diagnosisId) → SELECT * FROM condition_diagnosis_feedback WHERE diagnosis_id = $1
// - submitFeedback(data) → INSERT + return new row
```

## Data Flow

```
                      ┌─────────────────────────────┐
                      │   compute_source_quality    │
                      │   _stats()                  │
                      │   (reusable RPC)            │
                      └──────────┬──────────────────┘
                                 │
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                    ▼
   Dashboard (tab 0)    SourceManagementPanel    DeadLetterPanel
   (7 aggregated tiles)  (extended with badges)

                      ┌─────────────────────────────┐
                      │   condition_automation      │
                      │   _policies                 │
                      │   (seeded ×2, CRUD via UI)  │
                      └──────────┬──────────────────┘
                                 │
                                 ▼
                      evaluate_automation_policy()
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
     generate_recommendation_v2()      convert_recommendation_to_wo()
                    │                         │
                    ▼                         ▼
         maintenance_recommendations     work_orders
                    │
                    ├──→ trg_rec_status_audit ──→ condition_audit_log
                    │
                    ▼
         RecommendationList (UI)
                    │
              ┌─────┴─────┐
              ▼           ▼
         Approve      Dismiss/Supersede

  condition_diagnosis_feedback
      ▲        │
      │        └──→ trg_feedback_audit ──→ condition_audit_log
      │             trg_feedback_summary ──→ condition_diagnoses (summary)
      │
  FeedbackForm (in DiagnosisPanel)

  pg_cron (00:05 daily)
      │
      ▼
  compute_daily_metrics()
      │
      ▼
  condition_daily_metrics ←── SDD 6 consumer
```

## Testing Strategy

### pgTAP: `sdd5_governance_test.sql` (~50 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: policies | 6 | Table exists, UNIQUE policy_key, CHECK is_active, indexes, RLS, seed rows |
| Schema: feedback | 6 | Table exists, FK to diagnoses + work_orders, CHECK feedback_status, indexes, RLS |
| Schema: audit_log | 5 | Table exists, action CHECK, 3 indexes, INSERT-only (no UPDATE/DELETE policies), SELECT RLS |
| Schema: daily_metrics | 4 | Table exists, UNIQUE(metric_date,asset_id), defaults, index |
| ALTER maintenance_recommendations | 6 | status CHECK includes expired, 5 new columns exist, 2 FK (self + work_orders) |
| evaluate_automation_policy | 6 | Matching policy returns correct key; no match → fallback; repeat dismissal gate forces review_required; asset_criticality filter works; FM category filter works |
| generate_recommendation_v2 | 4 | Uses policy requires_approval for status; fallback when no policies; logs audit entry; deprecated v1 still works |
| compute_source_quality_stats | 3 | Returns correct structure; percentages sum to 100; dead-letter count works |
| compute_daily_metrics | 4 | Idempotent (run twice same result); returns asset count; ON CONFLICT updates correctly; pg_cron schedule exists |
| convert_recommendation_to_wo | 4 | Creates WO, sets status, returns WO id; rejects non-approved status; audit is logged |
| expire_stale_recommendations | 3 | Expires stale suggested/review_required; does not expire approved; returns count |
| Audit triggers | 4 | trg_rec_status_audit fires on status change; trg_policy_audit fires on INSERT/UPDATE/DELETE; trg_feedback_audit fires on INSERT; before/after states captured correctly |
| Feedback summary trigger | 2 | condition_diagnoses.feedback_status updated; feedback_notes populated |
| log_audit_entry | 1 | Manual insert works |

### Vitest (frontend) — ~12 tests

| Test | What |
|------|------|
| Dashboard renders all 7 tiles | MetricTile components visible, counts render |
| Dashboard clickable tile navigates | onNavigate called with correct sub-tab index |
| Dashboard loading state | Skeleton or spinner |
| RecommendationList filters by status | Only matching rows visible |
| RecommendationList empty state | "Sin recomendaciones" with filter reset |
| RecommendationList approve action | PLANNER/ADMIN sees button, TECHNICIAN does not |
| FeedbackForm validation | Blocks submit when feedback_status missing |
| FeedbackForm submit | Calls INSERT, success notification |
| PolicyManagementPanel CRUD | List renders, create/edit dialog works |
| SourceManagementPanel quality badge | Shows G0-G3 dominant, stale indicator |
| RLS gating on approve button | Button hidden for TECHNICIAN |
| Dashboard performance | Loads <2s with mock data (composite indexes) |

## Open Questions

- [ ] **`compute_source_quality_stats()` performance** — JOIN chain from sources → capabilities → feature_definitions → feature_values → windows is 4-level. The `condition_feature_values` table can be large. Verify with EXPLAIN ANALYZE; if slow, add a materialized view refreshed by pg_cron.
- [ ] **`work_orders.wo_type` values** — The proposal mentions `'CBM'` type but existing code may use different values. `convert_recommendation_to_wo()` uses `COALESCE(mr.work_order_type, 'CBM')`; confirm the exact `wo_type` strings used in the system.
- [ ] **RLS for `log_audit_entry()`** — The function is `SECURITY DEFINER` which bypasses RLS. The restriction must be at the application level (who can call the RPC) or via a role check inside the function. Verify current RPC permission pattern.
- [ ] **pg_cron extension availability** — Confirm `pg_cron` is installed in the Supabase project. If not, the `compute_daily_metrics()` cron schedule section must be documented as optional with `-- requires pg_cron extension` guard.
