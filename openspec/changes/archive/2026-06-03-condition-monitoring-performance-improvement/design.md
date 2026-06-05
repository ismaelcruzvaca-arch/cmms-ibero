# Design: Model Registry + Change Control + Data Readiness Levels (SDD 6, PR 1)

## Technical Approach

**SQL-only governance layer extending SDD 5 patterns.** Three idempotent migrations add the model registry (`condition_degradation_models`), change control (`condition_change_proposals`), and DRL assessment infrastructure. All new tables follow SDD 5 conventions: `created_at` defaults, UUID PKs, Spanish COMMENTs, RLS by role, and idempotent DDL. The existing `condition_audit_log` (no CHECK constraint — action is free TEXT) receives new action types naturally without ALTER. DRL is enforced as a HARD GATE for production activation: a model cannot be promoted from field_trial to active unless the asset's DRL meets the model's `min_data_readiness_level`. Models can run in field_trial or simulation mode below DRL threshold, but never in active production mode. DRL is computed multi-level: per asset (overall), per feature_key, per failure_mode, and per model_key — a single asset may have DRL 4 for vibration.rms but DRL 2 for pressure.suction. Seeds register 6 models: linear_extrapolation (the only active production model from SDD 4), piecewise_linear and exponential_degradation as candidates, and Weibull/Gamma/Wiener as draft (DRL 6 required to promote).

No new Edge Functions, no frontend changes in this PR. All logic is database-resident. The rollback function (`rollback_change()`) restores `before_state` JSONB captured at proposal creation time, respecting that changes to thresholds, baselines, and policies store their full pre-change state.

## Architecture Decisions

### Decision: action column CHECK vs free TEXT in condition_audit_log

| Option | Tradeoff |
|--------|----------|
| ALTER to add `CHECK (action IN (...))` with new action types | +Enforces known actions at DB level; —Requires ALTER on existing SDD 5 table, forces migration of old audit rows if they contain unexpected values, adds coupling between extensions |
| Keep free TEXT (current state) and document conventions | +No migration risk, backward-compatible; —No DB-level guard against typos |
| **Decision** | **Keep free TEXT.** SDD 5 deliberately left action as TEXT without CHECK (future-proof). We document the new actions (`model_status_changed`, `change_proposed`, `change_approved`, `change_rejected`, `change_activated`, `change_rolled_back`) as conventions in this design. |

### Decision: Model lifecycle transitions — CHECK constraint vs trigger enforcement

| Option | Tradeoff |
|--------|----------|
| CHECK `validation_status IN (...)` only (no transition rules) | +Simple, matches SDD 5 pattern; —Any status-to-status allowed, no governance on lifecycle |
| Separate table of allowed transitions + FK | +Declarative, queryable; —Over-engineered for 6 statuses with 2 terminal states |
| Trigger that validates transition + logs audit | +Enforces lifecycle in one place, logs every transition; —Slightly more complex trigger logic |
| **Decision** | **Trigger-based.** One trigger function validates allowed transitions (draft→candidate→field_trial→active→deprecated/superseded; candidate/field_trial→rejected) AND logs to `condition_audit_log`. Same pattern as SDD 5's `trg_rec_status_audit`. |

### Decision: DRL granularity — asset-level vs multi-level

| Option | Tradeoff |
|--------|----------|
| Single DRL per asset (global) | +Simple; —Hides disparities (asset may have good vibration data but bad pressure data) |
| DRL per asset, per feature_key, per failure_mode, per model_key | +Accurate, prevents activating models on features without sufficient data; —More complex, more storage |
| **Decision** | **Multi-level DRL.** `condition_data_readiness` VIEW computes DRL at 4 levels: asset overall, asset+feature_key, asset+failure_mode, asset+model_key. Each level has its own evidence breakdown (sample_count, time_span_days, g0g1_ratio, baseline_status, event_count, feedback_count, confirmed_failure_count, missing_features). This prevents approving a bearing model for an asset that has good vibration data but no pressure data. The view exposes all levels so consumers can filter appropriately. |

### Decision: Rollback — version activation vs history rewrite

| Option | Tradeoff |
|--------|----------|
| Rewrite records to their before_state in-place | +Simple; —Destroys audit trail, historical predictions become confusing, OTs already created reference old state |
| Create a NEW active version based on before_state, keep old versions as history | +Auditable, preserves decision trail, OTs still reference the version under which they were created; —Slightly more complex (version column or effective_date) |
| **Decision** | **New version activation — history is NOT rewritten.** `rollback_change()` creates a new active version from the old before_state (UPDATE of the current row, or INSERT of a new version row). It does NOT delete or rewrite decisions already made (OTs already created, recommendations already generated). The rollback action is logged to `condition_audit_log`. Old versions remain queryable; historical predictions/recommendations are preserved. The rollback is itself a versioned change, not a deletion of history. |

### Decision: DRL enforcement — hard gate vs convention

| Option | Tradeoff |
|--------|----------|
| Trigger blocks promotion to `active` if asset DRL < model `min_data_readiness_level` | +Prevents premature activation at DB level; —Blocks dev with synthetic data if poorly implemented |
| Document DRL but allow any status regardless | +Flexible for development; —No real guard against activating Weibull with 10 data points |
| **Decision** | **Hard gate for `active` status; field_trial allowed below DRL.** A BEFORE UPDATE trigger on `condition_degradation_models` blocks promotion to `active` status if the model's `min_data_readiness_level` is not met by the asset(s) it targets. Models CAN run as `field_trial` or `candidate` below DRL threshold for evaluation. This permits testing/validation without compromising production. The `assess_data_readiness()` function returns evidence breakdown (not just a number) so users see WHY a level is not met. Tests use synthetic data with DRL 6 override flag to avoid blocking test suites. |

### Decision: Seed models — which status and DRL values

| Option | Tradeoff |
|--------|----------|
| All models `active` | +Maximum surface area; —Weibull/Gamma/Wiener have no validation, violates governance |
| Only linear_extrapolation active, others at lower statuses per their DRL readiness | +Truthful registry; requires manual promotion when DRL met |
| **Decision** | Per spec: linear_extrapolation→active (DRL 2), piecewise_linear+exponential_degradation→candidate (DRL 4), weibull+gamma+wiener→draft (DRL 6). Linear is the only model with production validation from SDD 4. |

## Migration Plan

### Migration 21: `20260604100021_sdd6_model_registry_change_control.sql` — Tables + Seeds

| Section | Content |
|---------|---------|
| Table | `condition_degradation_models` — model registry with lifecycle, DRL requirements, parameters_schema |
| Table | `condition_model_applicability` — which models apply to which FM/asset_class |
| Table | `condition_change_proposals` — change control with lifecycle, before/after state |
| Indexes | All PK, FK, search, and composite indexes per table |
| RLS | SELECT authenticated; INSERT/UPDATE/DELETE gated by role (PLANNER, ADMIN) |
| Seeds | 6 degradation models with correct status, DRL, assumptions, parameters_schema |
| Dependencies | All tables autonomous (no FK to existing SDD 1-5). `condition_change_proposals` references entity_type/entity_id as plain TEXT — no FK enforcement on external entities. |

### Migration 22: `20260604100022_sdd6_drl_functions_views.sql` — Functions + Views

| Section | Content |
|---------|---------|
| Function | `assess_data_readiness(p_asset_id TEXT)` — returns INT DRL 0-6 |
| Function | `compare_change_proposal(p_proposal_id UUID)` — returns JSONB diff |
| Function | `rollback_change(p_proposal_id UUID)` — re-applies before_state |
| View | `condition_data_readiness` — asset_id, asset_class, total_windows, g0g1_ratio, has_events, has_feedback, has_confirmed_outcomes, drl_level |

### Migration 23: `20260604100023_sdd6_audit_triggers.sql` — Audit Triggers

| Section | Content |
|---------|---------|
| Trigger function | `trg_model_status_audit_func()` — validates lifecycle transitions + logs audit |
| Trigger | `trg_model_status_audit` — AFTER UPDATE OF validation_status ON condition_degradation_models |
| Trigger function | `trg_proposal_status_audit_func()` — validates lifecycle + logs audit |
| Trigger | `trg_proposal_status_audit` — AFTER UPDATE OF status ON condition_change_proposals |

## Schema Design

### condition_degradation_models

```sql
CREATE TABLE IF NOT EXISTS public.condition_degradation_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_type TEXT NOT NULL
    CHECK (model_type IN ('linear','piecewise_linear','exponential','weibull','gamma','wiener','custom')),
  description TEXT,
  assumptions TEXT[],
  input_requirements TEXT[],
  min_data_readiness_level INT NOT NULL DEFAULT 0
    CHECK (min_data_readiness_level BETWEEN 0 AND 6),
  validation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (validation_status IN ('draft','candidate','field_trial','active','deprecated','superseded')),
  version INT NOT NULL DEFAULT 1,
  parameters_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_degradation_model_key UNIQUE (model_key)
);

COMMENT ON TABLE public.condition_degradation_models
  IS 'Catálogo gobernado de modelos de degradación. Cada modelo declara tipo, DRL mínimo requerido, y schema de parámetros. Lifecycle: draft→candidate→field_trial→active→deprecated/superseded.';
COMMENT ON COLUMN public.condition_degradation_models.model_key
  IS 'Identificador único del modelo (ej: linear_extrapolation, weibull_rul)';
COMMENT ON COLUMN public.condition_degradation_models.model_type
  IS 'Tipo de modelo: linear|piecewise_linear|exponential|weibull|gamma|wiener|custom';
COMMENT ON COLUMN public.condition_degradation_models.assumptions
  IS 'Array de supuestos del modelo (ej: ARRAY['monotonic_degradation','constant_load'])';
COMMENT ON COLUMN public.condition_degradation_models.input_requirements
  IS 'Array de features requeridas como input';
COMMENT ON COLUMN public.condition_degradation_models.min_data_readiness_level
  IS 'DRL mínimo requerido para promover el modelo a active. 0-6. Convención, no hard gate.';
COMMENT ON COLUMN public.condition_degradation_models.validation_status
  IS 'Estado en el lifecycle gobernado. Transiciones validadas por trigger.';
COMMENT ON COLUMN public.condition_degradation_models.parameters_schema
  IS 'JSONB describiendo el schema de parámetros del modelo (keys, tipos, defaults). NO almacena valores de parámetros.';

CREATE INDEX IF NOT EXISTS idx_degradation_models_type
  ON public.condition_degradation_models(model_type);
CREATE INDEX IF NOT EXISTS idx_degradation_models_status
  ON public.condition_degradation_models(validation_status);
CREATE INDEX IF NOT EXISTS idx_degradation_models_drl
  ON public.condition_degradation_models(min_data_readiness_level);

-- RLS: SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN
ALTER TABLE public.condition_degradation_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cdm_select ON public.condition_degradation_models;
CREATE POLICY cdm_select ON public.condition_degradation_models
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cdm_insert ON public.condition_degradation_models;
CREATE POLICY cdm_insert ON public.condition_degradation_models
  FOR INSERT TO authenticated WITH CHECK (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
  );

DROP POLICY IF EXISTS cdm_update ON public.condition_degradation_models;
CREATE POLICY cdm_update ON public.condition_degradation_models
  FOR UPDATE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
  );

DROP POLICY IF EXISTS cdm_delete ON public.condition_degradation_models;
CREATE POLICY cdm_delete ON public.condition_degradation_models
  FOR DELETE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('ADMIN')
  );
```

### condition_model_applicability

```sql
CREATE TABLE IF NOT EXISTS public.condition_model_applicability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.condition_degradation_models(id) ON DELETE CASCADE,
  failure_mode_key TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  min_samples INT,
  min_r_squared NUMERIC,
  notes TEXT,
  CONSTRAINT uq_model_applicability UNIQUE (model_id, failure_mode_key, asset_class)
);

COMMENT ON TABLE public.condition_model_applicability
  IS 'Matriz de aplicabilidad: qué modelos aplican a qué modos de falla y clase de asset. No todos los modelos sirven para todos los FMs.';
COMMENT ON COLUMN public.condition_model_applicability.min_samples
  IS 'Cantidad mínima de muestras históricas requeridas para aplicar este modelo';
COMMENT ON COLUMN public.condition_model_applicability.min_r_squared
  IS 'R² mínimo requerido para considerar el ajuste aceptable';

CREATE INDEX IF NOT EXISTS idx_model_applicability_model
  ON public.condition_model_applicability(model_id);
CREATE INDEX IF NOT EXISTS idx_model_applicability_fm
  ON public.condition_model_applicability(failure_mode_key);
CREATE INDEX IF NOT EXISTS idx_model_applicability_asset_class
  ON public.condition_model_applicability(asset_class);

-- RLS: SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN
ALTER TABLE public.condition_model_applicability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cma_select ON public.condition_model_applicability;
CREATE POLICY cma_select ON public.condition_model_applicability
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cma_insert ON public.condition_model_applicability;
CREATE POLICY cma_insert ON public.condition_model_applicability
  FOR INSERT TO authenticated WITH CHECK (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
  );

DROP POLICY IF EXISTS cma_update ON public.condition_model_applicability;
CREATE POLICY cma_update ON public.condition_model_applicability
  FOR UPDATE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
  );

DROP POLICY IF EXISTS cma_delete ON public.condition_model_applicability;
CREATE POLICY cma_delete ON public.condition_model_applicability
  FOR DELETE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('ADMIN')
  );
```

### condition_change_proposals

```sql
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  active_at TIMESTAMPTZ,
  CONSTRAINT uq_change_proposal_key UNIQUE (proposal_key)
);

COMMENT ON TABLE public.condition_change_proposals
  IS 'Propuestas de cambio controlado para thresholds, reglas, baselines, políticas HITL, métodos RUL y modelos de degradación. Lifecycle: draft→review→approved→active→rolled_back.';
COMMENT ON COLUMN public.condition_change_proposals.entity_type
  IS 'Tipo de entidad afectada: threshold, rule, diagnostic_pattern, baseline, hitl_policy, rul_method, degradation_model, source_capability, analysis_method, failure_mode, evidence_matrix, recommendation_mapping, pf_curve, hi_weight';
COMMENT ON COLUMN public.condition_change_proposals.entity_id
  IS 'ID textual de la entidad afectada (ej: threshold_key, rule_id, baseline_key)';
COMMENT ON COLUMN public.condition_change_proposals.before_state
  IS 'Estado completo de la entidad ANTES del cambio (para rollback). Capturado al crear la propuesta.';
COMMENT ON COLUMN public.condition_change_proposals.after_state
  IS 'Estado completo de la entidad DESPUÉS del cambio (para diff y aprobación).';
COMMENT ON COLUMN public.condition_change_proposals.status
  IS 'Estado actual en el lifecycle: draft|review|approved|rejected|active|rolled_back';

CREATE INDEX IF NOT EXISTS idx_change_proposals_status
  ON public.condition_change_proposals(status);
CREATE INDEX IF NOT EXISTS idx_change_proposals_entity
  ON public.condition_change_proposals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_proposals_created
  ON public.condition_change_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_proposals_proposed
  ON public.condition_change_proposals(proposed_by);

-- RLS: SELECT → authenticated; INSERT (draft only) → authenticated;
-- UPDATE status: PLANNER can set review→approved/rejected; ADMIN can set approved→active, active→rolled_back
-- Non-status fields locked after status != 'draft'
ALTER TABLE public.condition_change_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ccp_select ON public.condition_change_proposals;
CREATE POLICY ccp_select ON public.condition_change_proposals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ccp_insert ON public.condition_change_proposals;
CREATE POLICY ccp_insert ON public.condition_change_proposals
  FOR INSERT TO authenticated WITH CHECK (
    status = 'draft'
  );

-- UPDATE policy: status transitions gated by role, non-status fields locked post-draft
DROP POLICY IF EXISTS ccp_update ON public.condition_change_proposals;
CREATE POLICY ccp_update ON public.condition_change_proposals
  FOR UPDATE TO authenticated USING (
    -- Everyone can update draft proposals (edit content)
    (OLD.status = 'draft' AND NEW.status = 'draft')
    OR
    -- PLANNER can submit to review, approve, or reject
    (
      current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
      AND (
        (OLD.status = 'draft' AND NEW.status = 'review')
        OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected'))
      )
    )
    OR
    -- ADMIN can activate or rollback
    (
      current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN'
      AND (
        (OLD.status = 'approved' AND NEW.status = 'active')
        OR (OLD.status = 'active' AND NEW.status = 'rolled_back')
      )
    )
  );

DROP POLICY IF EXISTS ccp_delete ON public.condition_change_proposals;
CREATE POLICY ccp_delete ON public.condition_change_proposals
  FOR DELETE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('ADMIN')
    AND OLD.status = 'draft'
  );
```

## SQL Functions

### assess_data_readiness(p_asset_id TEXT)

```sql
CREATE OR REPLACE FUNCTION public.assess_data_readiness(
  p_asset_id TEXT
) RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_drl INT;
  v_total_windows INT;
  v_g0g1_ratio NUMERIC;
  v_has_events BOOLEAN;
  v_has_feedback BOOLEAN;
  v_has_confirmed_outcomes BOOLEAN;
  v_baseline_count INT;
BEGIN
  -- DRL 0: sin datos
  SELECT COUNT(*) INTO v_total_windows
  FROM public.condition_windows
  WHERE asset_id = p_asset_id;

  IF v_total_windows = 0 THEN
    RETURN 0;
  END IF;

  -- DRL 1: solo datos sintéticos/mock
  -- Asumimos que si no hay datos reales en windows, es sintético
  -- (detectado por source_type en condition_sources)
  IF NOT EXISTS (
    SELECT 1 FROM public.condition_windows w
    JOIN public.condition_sources s ON w.source_id = s.source_id
    WHERE w.asset_id = p_asset_id AND s.source_type != 'mock'
  ) THEN
    RETURN 1;
  END IF;

  -- DRL 2: datos reales, sin eventos confirmados
  IF v_total_windows > 0 THEN
    -- Calcular ratio G0/G1 vs total
    SELECT ROUND(
      COUNT(*) FILTER (WHERE cfv.quality_flag IN ('G0', 'G1'))::NUMERIC
      / NULLIF(COUNT(*), 0) * 100, 1
    ) INTO v_g0g1_ratio
    FROM public.condition_feature_values cfv
    JOIN public.condition_windows w ON cfv.window_id = w.id
    WHERE w.asset_id = p_asset_id;

    -- Tiene eventos de condición?
    SELECT EXISTS (
      SELECT 1 FROM public.condition_events
      WHERE asset_id = p_asset_id
    ) INTO v_has_events;

    IF NOT v_has_events THEN
      RETURN 2;
    END IF;
  END IF;

  -- DRL 3: datos reales con baseline estable
  SELECT COUNT(*) INTO v_baseline_count
  FROM public.condition_baselines
  WHERE asset_id = p_asset_id AND status = 'active';

  IF v_has_events AND v_baseline_count = 0 THEN
    RETURN 3;
  END IF;

  -- DRL 4: eventos + feedback técnico
  SELECT EXISTS (
    SELECT 1 FROM public.condition_diagnosis_feedback df
    JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
    WHERE d.asset_id = p_asset_id
  ) INTO v_has_feedback;

  IF v_baseline_count > 0 AND NOT v_has_feedback THEN
    RETURN 4;
  END IF;

  -- DRL 5: fallas confirmadas
  SELECT EXISTS (
    SELECT 1 FROM public.condition_diagnosis_feedback df
    JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
    WHERE d.asset_id = p_asset_id AND df.feedback_status = 'confirmed'
  ) INTO v_has_confirmed_outcomes;

  IF v_has_feedback AND NOT v_has_confirmed_outcomes THEN
    RETURN 5;
  END IF;

  -- DRL 6: datos suficientes para modelo estadístico validado
  IF v_has_confirmed_outcomes THEN
    -- Criterio: suficientes ventanas + calidad aceptable + fallas confirmadas
    IF v_total_windows >= 100 AND v_g0g1_ratio >= 80 THEN
      RETURN 6;
    ELSE
      RETURN 5;
    END IF;
  END IF;

  -- Fallback
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.assess_data_readiness(TEXT)
  IS 'Evalúa el Data Readiness Level (0-6) para un asset. Lógica progresiva: sin datos→0, mock→1, real→2, baseline→3, feedback→4, fallas→5, suficiente→6. Convención, no hard gate.';
```

### compare_change_proposal(p_proposal_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.compare_change_proposal(
  p_proposal_id UUID
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_before_keys TEXT[];
  v_after_keys TEXT[];
  v_changed_keys TEXT[];
  v_result JSONB;
BEGIN
  SELECT * INTO v_proposal
  FROM public.condition_change_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Extraer keys de ambos estados
  SELECT array_agg(DISTINCT key) INTO v_before_keys
  FROM jsonb_object_keys(COALESCE(v_proposal.before_state, '{}'::jsonb)) AS key;

  SELECT array_agg(DISTINCT key) INTO v_after_keys
  FROM jsonb_object_keys(COALESCE(v_proposal.after_state, '{}'::jsonb)) AS key;

  -- Encontrar keys que cambiaron (diferente valor o presentes en uno pero no en otro)
  WITH all_keys AS (
    SELECT UNNEST(v_before_keys) AS key
    UNION
    SELECT UNNEST(v_after_keys) AS key
  )
  SELECT array_agg(k.key ORDER BY k.key) INTO v_changed_keys
  FROM all_keys k
  WHERE (
    -- Key solo en before (fue eliminada)
    (v_proposal.before_state->>k.key IS NOT NULL AND v_proposal.after_state->>k.key IS NULL)
    OR
    -- Key solo en after (fue agregada)
    (v_proposal.before_state->>k.key IS NULL AND v_proposal.after_state->>k.key IS NOT NULL)
    OR
    -- Key en ambos pero con valor diferente (comparación textual para simplicidad)
    (v_proposal.before_state->>k.key IS DISTINCT FROM v_proposal.after_state->>k.key)
  );

  v_result := jsonb_build_object(
    'proposal_key', v_proposal.proposal_key,
    'entity_type', v_proposal.entity_type,
    'entity_id', v_proposal.entity_id,
    'change_type', v_proposal.change_type,
    'before', v_proposal.before_state,
    'after', v_proposal.after_state,
    'changed_keys', COALESCE(v_changed_keys, '{}'::TEXT[]),
    'total_before_fields', COALESCE(array_length(v_before_keys, 1), 0),
    'total_after_fields', COALESCE(array_length(v_after_keys, 1), 0),
    'total_changed_fields', COALESCE(array_length(v_changed_keys, 1), 0)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.compare_change_proposal(UUID)
  IS 'Retorna diff estructurado entre before_state y after_state de una propuesta de cambio. Incluye keys agregadas, eliminadas y modificadas con conteos.';
```

### rollback_change(p_proposal_id UUID)

```sql
CREATE OR REPLACE FUNCTION public.rollback_change(
  p_proposal_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_set_clause TEXT;
  v_sql TEXT;
  v_entity_table TEXT;
BEGIN
  SELECT * INTO v_proposal
  FROM public.condition_change_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found: %', p_proposal_id;
  END IF;

  IF v_proposal.status NOT IN ('active', 'approved') THEN
    RAISE EXCEPTION 'Cannot rollback proposal with status % (requires active or approved)', v_proposal.status;
  END IF;

  IF v_proposal.before_state IS NULL THEN
    RAISE EXCEPTION 'Proposal % has no before_state, cannot rollback', v_proposal.proposal_key;
  END IF;

  -- Mapear entity_type a tabla
  v_entity_table := CASE v_proposal.entity_type
    WHEN 'threshold' THEN 'public.condition_thresholds'
    WHEN 'rule' THEN 'public.condition_rules'
    WHEN 'baseline' THEN 'public.condition_baselines'
    WHEN 'hitl_policy' THEN 'public.condition_automation_policies'
    WHEN 'degradation_model' THEN 'public.condition_degradation_models'
    WHEN 'rul_method' THEN 'public.condition_analysis_methods'
    WHEN 'diagnostic_pattern' THEN 'public.condition_diagnostic_patterns'
    ELSE NULL
  END;

  IF v_entity_table IS NULL THEN
    RAISE EXCEPTION 'Unknown entity_type: %', v_proposal.entity_type;
  END IF;

  -- Construir SET dinámico desde before_state
  -- Seguridad: solo campos conocidos de before_state se aplican
  SELECT string_agg(
    format('%I = %L', key, v_proposal.before_state->>key),
    ', '
  ) INTO v_set_clause
  FROM jsonb_object_keys(v_proposal.before_state) AS key
  WHERE key NOT IN ('id', 'created_at', 'updated_at');  -- no restaurar IDs ni timestamps

  IF v_set_clause IS NULL THEN
    RAISE EXCEPTION 'No updatable fields in before_state for proposal %', v_proposal.proposal_key;
  END IF;

  -- Ejecutar UPDATE dinámico
  v_sql := format(
    'UPDATE %s SET %s WHERE id = %L::UUID',
    v_entity_table, v_set_clause, v_proposal.entity_id
  );
  EXECUTE v_sql;

  -- Actualizar estado de la propuesta
  UPDATE public.condition_change_proposals
  SET status = 'rolled_back'
  WHERE id = p_proposal_id;

  -- Nota: el trigger trg_proposal_status_audit registrará el rollback en audit log
END;
$$;

COMMENT ON FUNCTION public.rollback_change(UUID)
  IS 'Revierte un cambio activo re-aplicando before_state a la entidad afectada. Requiere status active o approved. Construye UPDATE dinámico desde JSONB. El trigger de auditoría registra el rollback.';
```

## Views

### condition_data_readiness

```sql
CREATE OR REPLACE VIEW public.condition_data_readiness
AS
WITH asset_windows AS (
  SELECT
    w.asset_id,
    COUNT(*) AS total_windows,
    COUNT(*) FILTER (WHERE s.source_type = 'mock') AS mock_windows,
    COUNT(*) FILTER (WHERE s.source_type != 'mock') AS real_windows
  FROM public.condition_windows w
  LEFT JOIN public.condition_sources s ON w.source_id = s.source_id
  GROUP BY w.asset_id
),
window_quality AS (
  SELECT
    w.asset_id,
    ROUND(
      COUNT(*) FILTER (WHERE cfv.quality_flag IN ('G0', 'G1'))::NUMERIC
      / NULLIF(COUNT(*), 0) * 100, 1
    ) AS g0g1_ratio
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows w ON cfv.window_id = w.id
  GROUP BY w.asset_id
),
asset_events AS (
  SELECT asset_id, TRUE AS has_events
  FROM public.condition_events
  GROUP BY asset_id
),
asset_feedback AS (
  SELECT DISTINCT d.asset_id, TRUE AS has_feedback
  FROM public.condition_diagnosis_feedback df
  JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
),
asset_outcomes AS (
  SELECT DISTINCT d.asset_id, TRUE AS has_confirmed_outcomes
  FROM public.condition_diagnosis_feedback df
  JOIN public.condition_diagnoses d ON df.diagnosis_id = d.id
  WHERE df.feedback_status = 'confirmed'
),
asset_baselines AS (
  SELECT asset_id, COUNT(*) AS baseline_count
  FROM public.condition_baselines
  WHERE status = 'active'
  GROUP BY asset_id
)
SELECT
  COALESCE(aw.asset_id, wq.asset_id) AS asset_id,
  -- asset_class se obtiene de la tabla assets (si existe)
  COALESCE(
    (SELECT asset_class FROM public.assets WHERE id = COALESCE(aw.asset_id, wq.asset_id) LIMIT 1),
    'unknown'
  ) AS asset_class,
  COALESCE(aw.total_windows, 0) AS total_windows,
  COALESCE(aw.real_windows, 0) AS real_windows,
  COALESCE(aw.mock_windows, 0) AS mock_windows,
  COALESCE(wq.g0g1_ratio, 0) AS g0g1_ratio,
  COALESCE(ae.has_events, FALSE) AS has_events,
  COALESCE(af.has_feedback, FALSE) AS has_feedback,
  COALESCE(ao.has_confirmed_outcomes, FALSE) AS has_confirmed_outcomes,
  COALESCE(ab.baseline_count, 0) AS active_baselines,
  CASE
    WHEN COALESCE(aw.total_windows, 0) = 0 THEN 0
    WHEN COALESCE(aw.real_windows, 0) = 0 THEN 1
    WHEN ae.has_events IS NULL THEN 2
    WHEN ab.baseline_count IS NULL OR ab.baseline_count = 0 THEN 3
    WHEN af.has_feedback IS NULL THEN 4
    WHEN ao.has_confirmed_outcomes IS NULL THEN 5
    WHEN aw.total_windows >= 100 AND COALESCE(wq.g0g1_ratio, 0) >= 80 THEN 6
    ELSE 5
  END AS drl_level
FROM asset_windows aw
FULL JOIN window_quality wq ON aw.asset_id = wq.asset_id
LEFT JOIN asset_events ae ON COALESCE(aw.asset_id, wq.asset_id) = ae.asset_id
LEFT JOIN asset_feedback af ON COALESCE(aw.asset_id, wq.asset_id) = af.asset_id
LEFT JOIN asset_outcomes ao ON COALESCE(aw.asset_id, wq.asset_id) = ao.asset_id
LEFT JOIN asset_baselines ab ON COALESCE(aw.asset_id, wq.asset_id) = ab.asset_id;

COMMENT ON VIEW public.condition_data_readiness
  IS 'Vista de Data Readiness Level por asset. Computa DRL 0-6 basado en ventanas, calidad, eventos, feedback y fallas confirmadas. DRL 0=sin datos, 1=sintético, 2=real, 3=baseline, 4=feedback, 5=fallas, 6=suficiente.';
```

## Triggers

### Model status audit

```sql
CREATE OR REPLACE FUNCTION public.trg_model_status_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_action TEXT;
BEGIN
  IF OLD.validation_status IS DISTINCT FROM NEW.validation_status THEN
    -- Validar transiciones permitidas
    IF NOT (
      (OLD.validation_status = 'draft' AND NEW.validation_status IN ('candidate', 'rejected'))
      OR (OLD.validation_status = 'candidate' AND NEW.validation_status IN ('field_trial', 'rejected'))
      OR (OLD.validation_status = 'field_trial' AND NEW.validation_status IN ('active', 'rejected'))
      OR (OLD.validation_status = 'active' AND NEW.validation_status IN ('deprecated', 'superseded'))
      OR (OLD.validation_status = 'deprecated' AND NEW.validation_status = 'superseded')
      -- Rollback interno permitido (admin override)
      OR (OLD.validation_status = 'rejected' AND NEW.validation_status = 'draft')
    ) THEN
      RAISE EXCEPTION 'Transición inválida de validation_status: % → %', OLD.validation_status, NEW.validation_status;
    END IF;

    v_changed_by := COALESCE(
      current_setting('request.jwt.claims', true)::json->>'email',
      current_setting('request.jwt.claims', true)::json->>'sub',
      'system'
    );

    v_action := CASE
      WHEN NEW.validation_status = 'active' THEN 'model_promoted'
      WHEN NEW.validation_status = 'deprecated' THEN 'model_deprecated'
      WHEN NEW.validation_status = 'superseded' THEN 'model_superseded'
      WHEN NEW.validation_status = 'rejected' THEN 'model_rejected'
      ELSE 'model_status_changed'
    END;

    INSERT INTO public.condition_audit_log (
      action, entity_type, entity_id,
      before_state, after_state, reason, changed_by
    ) VALUES (
      v_action,
      'condition_degradation_models',
      NEW.id::TEXT,
      jsonb_build_object('validation_status', OLD.validation_status, 'version', OLD.version),
      jsonb_build_object('validation_status', NEW.validation_status, 'version', NEW.version),
      'Modelo ' || NEW.model_key || ': ' || OLD.validation_status || ' → ' || NEW.validation_status,
      v_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_model_status_audit
  AFTER UPDATE OF validation_status ON public.condition_degradation_models
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_model_status_audit_func();
```

### Proposal status audit

```sql
CREATE OR REPLACE FUNCTION public.trg_proposal_status_audit_func()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by TEXT;
  v_action TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Validar transiciones permitidas
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'review')
      OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status = 'active')
      OR (OLD.status = 'active' AND NEW.status = 'rolled_back')
      -- Re-open desde rejected (admin override, casos excepcionales)
      OR (OLD.status = 'rejected' AND NEW.status = 'draft')
    ) THEN
      RAISE EXCEPTION 'Transición inválida de status: % → %', OLD.status, NEW.status;
    END IF;

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
      jsonb_build_object('status', OLD.status, 'entity_type', OLD.entity_type, 'entity_id', OLD.entity_id),
      jsonb_build_object('status', NEW.status, 'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id),
      'Propuesta ' || NEW.proposal_key || ': ' || OLD.status || ' → ' || NEW.status,
      v_changed_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_proposal_status_audit
  AFTER UPDATE OF status ON public.condition_change_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_proposal_status_audit_func();
```

## Seeds

### 6 degradation models

```sql
-- ============================================================
-- SEED: Modelos de degradación (SDD 6, PR 1)
-- ============================================================
-- 1. linear_extrapolation — activo, DRL 2 (producción desde SDD 4)
-- 2. piecewise_linear — candidato, DRL 4
-- 3. exponential_degradation — candidato, DRL 4
-- 4. weibull_rul — draft, DRL 6
-- 5. gamma_process — draft, DRL 6
-- 6. wiener_process — draft, DRL 6
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
```

## Testing Strategy

### pgTAP: `sdd6_model_registry_test.sql` (~55 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: condition_degradation_models | 8 | Table exists, all columns, UNIQUE model_key, CHECK model_type, CHECK validation_status, CHECK min_drl 0-6, indexes (3), RLS policies (4) |
| Schema: condition_model_applicability | 6 | Table exists, FK to models, UNIQUE constraint, indexes (3), RLS policies (4) |
| Schema: condition_change_proposals | 8 | Table exists, all columns, UNIQUE proposal_key, CHECK entity_type, CHECK change_type, CHECK status completeness, indexes (4), RLS policies (4) |
| Seeds | 6 | 6 rows exist; linear_extrapolation is active, DRL 2; piecewise_linear+exponential are candidate DRL 4; weibull+gamma+wiener are draft DRL 6 |
| assess_data_readiness | 5 | Returns 0 for unknown asset; returns correct DRL per scenario (mock→1, real no events→2, baseline→3, feedback→4, confirmed→5, sufficient→6) |
| compare_change_proposal | 4 | Returns structured diff; changed_keys identifies added/removed/modified; returns NULL for unknown ID; handles empty before/after state |
| rollback_change | 4 | Rejects non-active status; rejects NULL before_state; restores before_state correctly; updates status to rolled_back |
| condition_data_readiness VIEW | 4 | Returns correct columns; DRL 0 for no data; DRL 1 for mock-only; handles asset with full data correctly |
| Model audit trigger | 3 | Fires on validation_status change; rejects invalid transitions (draft→active); logs correct action type |
| Proposal audit trigger | 3 | Fires on status change; rejects invalid transitions (draft→active); logs correct action type (change_proposed, change_approved, etc.) |
| RLS behavioral | 4 | anon blocked from INSERT on all tables; authenticated can SELECT; INSERT on change_proposals requires draft status; non-PLANNER blocked from status transitions |

## Open Questions

- [ ] **`public.assets` table existence** — The `condition_data_readiness` VIEW references `public.assets` for `asset_class`. Confirm this table exists with `id` and `asset_class` columns. If not, replace with `condition_sources.asset_class` or hardcode as 'unknown'.
- [ ] **Entity tables for rollback mapping** — `rollback_change()` uses a static mapping of `entity_type`→table name. Confirm the exact table names for `diagnostic_pattern`, `rul_method`, and that all referenced tables have an `id` column of type UUID.
- [ ] **`request.jwt.claims` role field name** — RLS policies use `->>'role'`. Confirm the JWT claim key is exactly `role` (not `user_role`, `app_role`, etc.). Cross-check with existing SDD 5 RLS policies.
- [ ] **pgTAP setup hook for DRL tests** — `assess_data_readiness` tests need pre-seeded condition_windows, condition_feature_values, condition_events, condition_diagnoses, and condition_diagnosis_feedback. Ensure the test file includes sufficient setup data to exercise all 7 DRL levels.
- [ ] **Dependent table existence for PR 5** — `generate_improvement_proposals()` references tables from PR 2-4 (`condition_performance_metrics`, `condition_false_positive_review`, `condition_prediction_calibration`, `condition_source_registry`). Confirm these table names exactly at implementation time.

---

# Design: Outcomes, Performance Metrics & FP/FN Review (SDD 6, PR 2)

## Technical Approach

**SQL-only metrics layer extending SDD 5 governance patterns.** Two idempotent migrations add the outcome-tracking table (`condition_outcomes`), the performance metrics function (`compute_performance_metrics()`), FP/FN review views (`condition_false_positives`, `condition_missed_detections`, `condition_noisy_rules`), and performance breakdown views (by FM, by rule, by source). Same conventions as PR 1 and SDD 5: UUID PKs, Spanish COMMENTs, idempotent DDL with `IF NOT EXISTS`, RLS by `get_user_role()`, SECURITY DEFINER functions for controlled INSERT. Metrics use `NULLIF` denominator safety and `COALESCE(... , 0)` to return 0 on empty data — never errors, never NULLs. FP/FN views are advisory only: they flag for review but never auto-disable rules or diagnoses. The `compute_performance_metrics()` function integrates with `condition_daily_metrics` via the existing pg_cron schedule (00:10 UTC), extending `condition_daily_metrics` with outcome-derived columns.

## Architecture Decisions

### Decision: INSERT strategy for condition_outcomes

| Option | Tradeoff |
|--------|----------|
| Direct INSERT via RLS (TECHNICIAN/PLANNER) | +Simple; —Violates spec requirement that outcomes are POST-WO reviewed truth, not inline feedback |
| INSERT only via SECURITY DEFINER function (no RLS INSERT policy) | +Enforces lifecycle separation at DB level (same pattern as `condition_audit_log`); —Requires a dedicated `record_condition_outcome()` function |
| **Decision** | **No direct INSERT policy — SECURITY DEFINER function only.** The WO closure workflow calls `record_condition_outcome()` which inserts with SECURITY DEFINER bypass. Same pattern as `condition_audit_log` (SDD 5). ADMIN can UPDATE outcomes. No DELETE policy — outcomes are immutable once created. |

### Decision: Compute false positives — function vs view

| Option | Tradeoff |
|--------|----------|
| `compute_false_positives()` function returning TABLE | +Callable from applications with consistent interface; —Redundant with a view (same data) |
| `condition_false_positives` VIEW | +Queryable directly, composable, no function call overhead; —Matches FPN-001 spec exactly |
| **Decision** | **Both: VIEW `condition_false_positives` per spec + `compute_false_positives()` as a wrapper.** The view is the primary interface (adheres to FPN-001). The function wraps it as `SELECT * FROM condition_false_positives()` for application-layer convenience and consistency with `compute_performance_metrics()`. |

### Decision: Missed detection window — static view vs parameterized function

| Option | Tradeoff |
|--------|----------|
| Fixed 60-day window in the view definition | +Simple view; —Not configurable, violates FPN-002 |
| Function with `p_preceding_days INT DEFAULT 60` | +Configurable; —Not queryable via direct SELECT on a view |
| CROSS JOIN with VALUES (30),(60),(90) in the view | +Returns all three windows as separate rows, fully configurable; —Each WO appears 3×, consumers must filter by `preceding_days_setting` |
| **Decision** | **CROSS JOIN with VALUES (30, 60, 90).** Matches FPN-002 spec exactly. Consumers filter via `WHERE preceding_days_setting = 60`. No function call needed. The view is parameterized-in-data, not parameterized-in-function-signature. |

### Decision: condition_daily_metrics extension — ALTER vs separate table

| Option | Tradeoff |
|--------|----------|
| ALTER `condition_daily_metrics` + new columns for outcome counts | +Single source of truth for daily aggregates; —Requires ALTER on existing SDD 5 table |
| Separate `condition_performance_daily` table | +No migration risk on SDD 5 table; —Fragmented metrics, harder for dashboards |
| **Decision** | **ALTER `condition_daily_metrics` with 3 new columns:** `confirmed_outcomes INT DEFAULT 0`, `rejected_outcomes INT DEFAULT 0`, `partial_outcomes INT DEFAULT 0`. The existing `compute_daily_metrics()` function gets extended in the same migration to populate these from `condition_outcomes`. Same upsert pattern. |

## Migration Plan

### Migration 24: `20260604100024_sdd6_outcomes_table.sql` — Table + RLS

| Section | Content |
|---------|---------|
| Table | `condition_outcomes` — operational truth post-WO, FK to `condition_diagnoses` and `work_orders` |
| Indexes | `idx_out_diagnosis` (diagnosis_id), `idx_out_wo` (work_order_id) |
| RLS | SELECT → all authenticated; no INSERT policy (SECURITY DEFINER only); UPDATE → ADMIN only |
| Function | `record_condition_outcome()` — SECURITY DEFINER for controlled INSERT from WO closure workflow |

### Migration 25: `20260604100025_sdd6_performance_views_functions.sql` — Functions + Views

| Section | Content |
|---------|---------|
| Function | `compute_performance_metrics()` — returns TABLE with overall rates + FM/rule/source breakdown rows |
| Function | `compute_false_positives()` — returns TABLE of FP diagnoses with rejection_source |
| View | `condition_false_positives` — diagnoses where `feedback_status='rejected'` OR `outcome.confirmed_status='rejected'` |
| View | `condition_missed_detections` — CM WOs without prior diagnosis in 30/60/90d window |
| View | `condition_noisy_rules` — rules with FP rate > 50% OR confirmed rate < 10% |
| View | `condition_performance_by_fm` — per-failure-mode breakdown |
| View | `condition_performance_by_rule` — per-rule breakdown |
| View | `condition_performance_by_source` — per-source breakdown |
| ALTER | Extend `condition_daily_metrics` with 3 outcome columns + extend `compute_daily_metrics()` |

## Schema Design

### condition_outcomes

```sql
CREATE TABLE IF NOT EXISTS public.condition_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id UUID NOT NULL
    REFERENCES public.condition_diagnoses(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL
    REFERENCES public.work_orders(id) ON DELETE CASCADE,
  actual_failure_mode TEXT,
  actual_component TEXT,
  actual_cause TEXT,
  confirmed_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (confirmed_status IN ('confirmed', 'partial', 'rejected', 'unknown')),
  failure_date TIMESTAMPTZ,
  technician_notes TEXT,
  evidence_quality TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.condition_outcomes
  IS 'Verdad operacional post-OT: modo de falla real, componente, causa y estado de confirmación. Lifecycle separado de condition_diagnosis_feedback. Cierra el ciclo Monitor→Diagnosticar→Actuar→Verificar.';
COMMENT ON COLUMN public.condition_outcomes.diagnosis_id
  IS 'FK al diagnóstico de condición evaluado';
COMMENT ON COLUMN public.condition_outcomes.work_order_id
  IS 'FK a la work_order que generó el resultado';
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
  IS 'Calidad de la evidencia que respalda este outcome';
COMMENT ON COLUMN public.condition_outcomes.reviewed_by
  IS 'Email o user ID de quien revisó y confirmó el outcome';
COMMENT ON COLUMN public.condition_outcomes.reviewed_at
  IS 'Fecha de revisión del outcome';

CREATE INDEX IF NOT EXISTS idx_out_diagnosis
  ON public.condition_outcomes(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_out_wo
  ON public.condition_outcomes(work_order_id);

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
```

### record_condition_outcome() — SECURITY DEFINER function

```sql
CREATE OR REPLACE FUNCTION public.record_condition_outcome(
  p_diagnosis_id UUID,
  p_work_order_id UUID,
  p_actual_failure_mode TEXT DEFAULT NULL,
  p_actual_component TEXT DEFAULT NULL,
  p_actual_cause TEXT DEFAULT NULL,
  p_confirmed_status TEXT DEFAULT 'unknown',
  p_failure_date TIMESTAMPTZ DEFAULT NULL,
  p_technician_notes TEXT DEFAULT NULL,
  p_evidence_quality TEXT DEFAULT NULL,
  p_reviewed_by TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_outcome_id UUID;
BEGIN
  -- Validar confirmed_status
  IF p_confirmed_status NOT IN ('confirmed', 'partial', 'rejected', 'unknown') THEN
    RAISE EXCEPTION 'Invalid confirmed_status: % (must be confirmed/partial/rejected/unknown)', p_confirmed_status;
  END IF;

  INSERT INTO public.condition_outcomes (
    diagnosis_id, work_order_id,
    actual_failure_mode, actual_component, actual_cause,
    confirmed_status, failure_date,
    technician_notes, evidence_quality,
    reviewed_by, reviewed_at
  ) VALUES (
    p_diagnosis_id, p_work_order_id,
    p_actual_failure_mode, p_actual_component, p_actual_cause,
    p_confirmed_status, p_failure_date,
    p_technician_notes, p_evidence_quality,
    p_reviewed_by, NOW()
  )
  RETURNING id INTO v_outcome_id;

  RETURN v_outcome_id;
END;
$$;

COMMENT ON FUNCTION public.record_condition_outcome(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  IS 'Crea un outcome de condición desde el flujo de cierre de OT. SECURITY DEFINER — bypass RLS. Valida confirmed_status. Retorna el UUID del outcome creado.';
```

## SQL Functions

### compute_performance_metrics()

```sql
CREATE OR REPLACE FUNCTION public.compute_performance_metrics()
RETURNS TABLE (
  total_diagnoses INT,
  reviewed_count INT,
  confirmed_count INT,
  rejected_count INT,
  partial_count INT,
  confirmed_rate NUMERIC(5,4),
  rejection_rate NUMERIC(5,4),
  feedback_coverage NUMERIC(5,4),
  avg_confidence NUMERIC(5,4)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_reviewed INT;
  v_confirmed INT;
  v_rejected INT;
  v_partial INT;
  v_avg_conf NUMERIC;
BEGIN
  -- total_diagnoses: todos los diagnósticos
  SELECT COUNT(*)::INT INTO v_total
  FROM public.condition_diagnoses;

  -- reviewed: tiene feedback_status no NULL O tiene outcome
  SELECT COUNT(*)::INT INTO v_reviewed
  FROM public.condition_diagnoses cd
  WHERE cd.feedback_status IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.condition_outcomes co WHERE co.diagnosis_id = cd.id);

  -- confirmed: feedback_status='confirmed' OR outcome.confirmed_status='confirmed'
  SELECT COUNT(*)::INT INTO v_confirmed
  FROM public.condition_diagnoses cd
  WHERE cd.feedback_status = 'confirmed'
     OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'confirmed');

  -- rejected: feedback_status='rejected' OR outcome.confirmed_status='rejected'
  SELECT COUNT(*)::INT INTO v_rejected
  FROM public.condition_diagnoses cd
  WHERE cd.feedback_status = 'rejected'
     OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'rejected');

  -- partial: feedback_status='partial' OR outcome.confirmed_status='partial'
  SELECT COUNT(*)::INT INTO v_partial
  FROM public.condition_diagnoses cd
  WHERE cd.feedback_status = 'partial'
     OR EXISTS (SELECT 1 FROM public.condition_outcomes co
                WHERE co.diagnosis_id = cd.id AND co.confirmed_status = 'partial');

  -- avg_confidence: promedio de confianza de todos los diagnósticos
  SELECT COALESCE(AVG(confidence), 0)::NUMERIC(5,4) INTO v_avg_conf
  FROM public.condition_diagnoses;

  -- Asignar a RETURN NEXT con NULLIF denominator safety
  total_diagnoses := v_total;
  reviewed_count := v_reviewed;
  confirmed_count := v_confirmed;
  rejected_count := v_rejected;
  partial_count := v_partial;
  confirmed_rate := COALESCE(v_confirmed::NUMERIC / NULLIF(v_reviewed, 0), 0);
  rejection_rate := COALESCE(v_rejected::NUMERIC / NULLIF(v_reviewed, 0), 0);
  feedback_coverage := COALESCE(v_reviewed::NUMERIC / NULLIF(v_total, 0), 0);
  avg_confidence := COALESCE(v_avg_conf, 0);
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_performance_metrics()
  IS 'Métricas globales de rendimiento diagnóstico: confirmed_rate, rejection_rate, feedback_coverage, avg_confidence. NULLIF denominator safety — retorna 0s, no errores, en datos vacíos. STABLE — no modifica datos.';
```

### compute_false_positives() — function wrapper

```sql
CREATE OR REPLACE FUNCTION public.compute_false_positives()
RETURNS TABLE (
  diagnosis_id UUID,
  asset_id TEXT,
  failure_mode_key TEXT,
  rejection_source TEXT,
  feedback_status TEXT,
  confirmed_status TEXT,
  reviewed_by TEXT,
  rejected_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.condition_false_positives;
$$;

COMMENT ON FUNCTION public.compute_false_positives()
  IS 'Retorna todos los diagnósticos clasificados como falsos positivos. Wrapper sobre la VIEW condition_false_positives. STABLE — no modifica datos.';
```

## Views

### condition_false_positives

```sql
CREATE OR REPLACE VIEW public.condition_false_positives
AS
SELECT
  cd.id AS diagnosis_id,
  cd.asset_id,
  cfmc.failure_mode_key,
  CASE
    WHEN cdf.feedback_status = 'rejected' THEN 'feedback'
    WHEN co.confirmed_status = 'rejected' THEN 'outcome'
    ELSE 'unknown'
  END AS rejection_source,
  cdf.feedback_status,
  co.confirmed_status,
  COALESCE(cdf.reviewed_by, co.reviewed_by) AS reviewed_by,
  COALESCE(cdf.reviewed_at, co.reviewed_at, cd.created_at) AS rejected_at
FROM public.condition_diagnoses cd
LEFT JOIN public.condition_failure_mode_catalog cfmc
  ON cfmc.id = cd.failure_mode_id
LEFT JOIN public.condition_diagnosis_feedback cdf
  ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co
  ON co.diagnosis_id = cd.id
WHERE cdf.feedback_status = 'rejected'
   OR co.confirmed_status = 'rejected';

COMMENT ON VIEW public.condition_false_positives
  IS 'Diagnósticos clasificados como falsos positivos: feedback_status=rejected o outcome.confirmed_status=rejected. Incluye rejection_source (feedback|outcome) y metadatos de revisión. Advisory — no auto-deshabilita nada.';
```

### condition_missed_detections

```sql
CREATE OR REPLACE VIEW public.condition_missed_detections
AS
WITH window_settings(preceding_days) AS (
  VALUES (30), (60), (90)
),
cm_work_orders AS (
  SELECT
    wo.id AS work_order_id,
    wo.asset_id,
    wo.closed_at,
    wo.wo_type,
    cd.id AS diagnosis_id,
    cd.failure_mode_id,
    cd.created_at AS diagnosis_created_at
  FROM public.work_orders wo
  LEFT JOIN public.condition_diagnoses cd
    ON cd.linked_work_order_id = wo.id
  WHERE wo.wo_type IN ('CM', 'corrective')
    AND wo.closed_at IS NOT NULL
)
SELECT
  cm.asset_id,
  cm.work_order_id,
  cfmc.failure_mode_key,
  cm.closed_at AS wo_close_date,
  ws.preceding_days,
  (
    SELECT MAX(cd2.created_at)
    FROM public.condition_diagnoses cd2
    WHERE cd2.asset_id = cm.asset_id
      AND cd2.failure_mode_id = cm.failure_mode_id
      AND cd2.created_at < cm.closed_at
      AND cd2.created_at >= cm.closed_at - (ws.preceding_days || ' days')::INTERVAL
  ) AS last_diagnosis_date
FROM cm_work_orders cm
CROSS JOIN window_settings ws
LEFT JOIN public.condition_failure_mode_catalog cfmc
  ON cfmc.id = cm.failure_mode_id
WHERE (
  SELECT COUNT(*)
  FROM public.condition_diagnoses cd2
  WHERE cd2.asset_id = cm.asset_id
    AND cd2.failure_mode_id = cm.failure_mode_id
    AND cd2.created_at < cm.closed_at
    AND cd2.created_at >= cm.closed_at - (ws.preceding_days || ' days')::INTERVAL
) = 0;

COMMENT ON VIEW public.condition_missed_detections
  IS 'OTs correctivas (CM/corrective) sin diagnóstico de condición previo para el mismo asset+failure_mode en ventanas configurables de 30/60/90 días. Advisory — no auto-crea diagnósticos. last_diagnosis_date=NULL si nunca hubo diagnóstico.';
```

### condition_noisy_rules

```sql
CREATE OR REPLACE VIEW public.condition_noisy_rules
AS
WITH rule_stats AS (
  SELECT
    cr.id AS rule_id,
    cr.rule_name,
    COUNT(DISTINCT cd.id) AS total_diagnoses,
    COUNT(DISTINCT cd.id) FILTER (
      WHERE cdf.feedback_status = 'confirmed'
         OR co.confirmed_status = 'confirmed'
    ) AS confirmed_count,
    COUNT(DISTINCT cd.id) FILTER (
      WHERE cdf.feedback_status = 'rejected'
         OR co.confirmed_status = 'rejected'
    ) AS rejected_count
  FROM public.condition_rules cr
  LEFT JOIN public.condition_events ce ON ce.rule_id = cr.id
  LEFT JOIN public.condition_diagnoses cd ON cd.linked_event_id = ce.id
  LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
  LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
  GROUP BY cr.id, cr.rule_name
)
SELECT
  rs.rule_id,
  rs.rule_name,
  rs.total_diagnoses,
  rs.confirmed_count,
  rs.rejected_count,
  COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) AS false_positive_rate,
  COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) AS confirmed_rate,
  CASE
    WHEN rs.total_diagnoses = 0 THEN FALSE
    WHEN COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) > 0.50 THEN TRUE
    WHEN COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) < 0.10 THEN TRUE
    ELSE FALSE
  END AS flagged_for_review
FROM rule_stats rs
WHERE rs.total_diagnoses > 0
  AND (
    COALESCE(rs.rejected_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) > 0.50
    OR COALESCE(rs.confirmed_count::NUMERIC / NULLIF(rs.total_diagnoses, 0), 0) < 0.10
  );

COMMENT ON VIEW public.condition_noisy_rules
  IS 'Reglas ruidosas: FP rate > 50% o confirmed_rate < 10%. flagged_for_review=TRUE indica revisión humana necesaria. Reglas con 0 diagnósticos NO son marcadas. Advisory — no auto-deshabilita reglas.';
```

### condition_performance_by_fm

```sql
CREATE OR REPLACE VIEW public.condition_performance_by_fm
AS
SELECT
  cfmc.failure_mode_key,
  cfmc.name AS failure_mode_name,
  cfmc.asset_class,
  COUNT(DISTINCT cd.id) AS total_diagnoses,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  ) AS confirmed_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  ) AS rejected_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'partial'
       OR cdf.feedback_status = 'partial'
  ) AS partial_count,
  COALESCE(
    COUNT(DISTINCT cd.id) FILTER (
      WHERE co.confirmed_status = 'confirmed'
         OR cdf.feedback_status = 'confirmed'
    )::NUMERIC / NULLIF(
      COUNT(DISTINCT cd.id) FILTER (
        WHERE co.confirmed_status IS NOT NULL
           OR cdf.feedback_status IS NOT NULL
      ), 0
    ), 0
  ) AS confirmed_rate,
  AVG(cd.confidence)::NUMERIC(5,4) AS avg_confidence
FROM public.condition_failure_mode_catalog cfmc
LEFT JOIN public.condition_diagnoses cd ON cd.failure_mode_id = cfmc.id
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
GROUP BY cfmc.failure_mode_key, cfmc.name, cfmc.asset_class;

COMMENT ON VIEW public.condition_performance_by_fm
  IS 'Rendimiento diagnóstico desglosado por modo de falla. Incluye confirmed_rate, rejected_count, avg_confidence por failure_mode_key. Consume condition_diagnoses + feedback + outcomes.';
```

### condition_performance_by_rule

```sql
CREATE OR REPLACE VIEW public.condition_performance_by_rule
AS
SELECT
  cr.id AS rule_id,
  cr.rule_name,
  cr.evaluation_type,
  COUNT(DISTINCT cd.id) AS diagnoses_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  ) AS confirmed_count,
  COUNT(DISTINCT cd.id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  ) AS rejected_count,
  COALESCE(
    COUNT(DISTINCT cd.id) FILTER (
      WHERE co.confirmed_status = 'rejected'
         OR cdf.feedback_status = 'rejected'
    )::NUMERIC / NULLIF(COUNT(DISTINCT cd.id), 0), 0
  ) AS false_positive_rate,
  AVG(cd.confidence)::NUMERIC(5,4) AS avg_confidence
FROM public.condition_rules cr
LEFT JOIN public.condition_events ce ON ce.rule_id = cr.id
LEFT JOIN public.condition_diagnoses cd ON cd.linked_event_id = ce.id
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = cd.id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = cd.id
GROUP BY cr.id, cr.rule_name, cr.evaluation_type;

COMMENT ON VIEW public.condition_performance_by_rule
  IS 'Rendimiento diagnóstico desglosado por regla de condición. Lineage: condition_rules → condition_events → condition_diagnoses → feedback/outcomes. Incluye false_positive_rate y avg_confidence.';
```

### condition_performance_by_source

```sql
CREATE OR REPLACE VIEW public.condition_performance_by_source
AS
WITH diag_sources AS (
  SELECT
    cd.id AS diagnosis_id,
    cd.asset_id,
    w.source_id,
    w.source_type
  FROM public.condition_diagnoses cd
  CROSS JOIN LATERAL UNNEST(cd.source_window_ids) AS sw_id(uuid)
  JOIN public.condition_windows w ON w.id = sw_id.uuid
)
SELECT
  ds.source_id,
  ds.source_type,
  COUNT(DISTINCT ds.diagnosis_id) AS diagnoses_from_source,
  COUNT(DISTINCT ds.diagnosis_id) FILTER (
    WHERE co.confirmed_status = 'confirmed'
       OR cdf.feedback_status = 'confirmed'
  ) AS confirmed_count,
  COUNT(DISTINCT ds.diagnosis_id) FILTER (
    WHERE co.confirmed_status = 'rejected'
       OR cdf.feedback_status = 'rejected'
  ) AS rejected_count,
  COALESCE(
    COUNT(DISTINCT ds.diagnosis_id) FILTER (
      WHERE co.confirmed_status = 'confirmed'
         OR cdf.feedback_status = 'confirmed'
    )::NUMERIC / NULLIF(COUNT(DISTINCT ds.diagnosis_id), 0), 0
  ) AS confirmed_rate,
  COALESCE(
    COUNT(DISTINCT ds.diagnosis_id) FILTER (
      WHERE co.confirmed_status = 'rejected'
         OR cdf.feedback_status = 'rejected'
    )::NUMERIC / NULLIF(COUNT(DISTINCT ds.diagnosis_id), 0), 0
  ) AS rejection_rate
FROM diag_sources ds
LEFT JOIN public.condition_diagnosis_feedback cdf ON cdf.diagnosis_id = ds.diagnosis_id
LEFT JOIN public.condition_outcomes co ON co.diagnosis_id = ds.diagnosis_id
GROUP BY ds.source_id, ds.source_type;

COMMENT ON VIEW public.condition_performance_by_source
  IS 'Rendimiento diagnóstico desglosado por fuente de datos. Lineage: condition_diagnoses.source_window_ids → condition_windows → condition_sources. Diagnósticos multi-fuente aparecen en cada fuente contribuyente.';
```

## Extended DDL

### ALTER condition_daily_metrics + compute_daily_metrics()

```sql
-- Extender condition_daily_metrics con columnas de outcome
ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS confirmed_outcomes INT NOT NULL DEFAULT 0;

ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS rejected_outcomes INT NOT NULL DEFAULT 0;

ALTER TABLE public.condition_daily_metrics
  ADD COLUMN IF NOT EXISTS partial_outcomes INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.condition_daily_metrics.confirmed_outcomes
  IS 'Cantidad de outcomes con confirmed_status=confirmed en esta fecha (SDD 6)';
COMMENT ON COLUMN public.condition_daily_metrics.rejected_outcomes
  IS 'Cantidad de outcomes con confirmed_status=rejected en esta fecha (SDD 6)';
COMMENT ON COLUMN public.condition_daily_metrics.partial_outcomes
  IS 'Cantidad de outcomes con confirmed_status=partial en esta fecha (SDD 6)';

-- Extender compute_daily_metrics() — agregar al loop de assets existente
-- (Se modifica la función existente, agregando las subqueries de outcomes dentro del bucle FOR v_asset IN ... LOOP)
-- Los INSERT y ON CONFLICT DO UPDATE existentes se extienden con:
--   confirmed_outcomes = EXCLUDED.confirmed_outcomes,
--   rejected_outcomes = EXCLUDED.rejected_outcomes,
--   partial_outcomes = EXCLUDED.partial_outcomes
```

## Testing Strategy

### pgTAP: `sdd6_outcomes_test.sql` (~20 assertions) + `sdd6_performance_metrics_test.sql` (~20 assertions)

#### Outcomes test (~20 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: condition_outcomes | 6 | Table exists, all columns (13 total), CHECK confirmed_status, FK to condition_diagnoses, FK to work_orders, indexes (2) |
| RLS policies | 3 | SELECT authenticated, no INSERT policy (verify via anon/technician attempts), UPDATE only ADMIN |
| record_condition_outcome() | 4 | Function exists with correct params; inserts row with correct values; rejects invalid confirmed_status; returns UUID |
| Scenario: valid INSERT | 2 | Valid FK + confirmed_status='confirmed' → row created; optional fields NULL → allowed |
| Scenario: invalid status | 1 | confirmed_status='invalid_value' → CHECK violation |
| Scenario: multiple outcomes per diagnosis | 1 | Two outcomes for same diagnosis_id → both exist (1:N) |
| RLS behavioral | 3 | Authenticated SELECT returns rows; direct INSERT blocked for TECHNICIAN; ADMIN UPDATE succeeds |

#### Performance metrics test (~20 assertions)

| Area | Assertions | What |
|------|------------|------|
| Function: compute_performance_metrics | 6 | Exists; returns correct structure (9 columns); empty data → all rates 0.0000; with data → confirmed_rate=0.4000, rejection_rate=0.1500, feedback_coverage=0.6000; incorporates outcomes; avg_confidence computed |
| View: condition_false_positives | 3 | FP from feedback rejection → appears with source='feedback'; FP from outcome rejection → appears with source='outcome'; confirmed diagnosis NOT flagged |
| View: condition_missed_detections | 4 | CM WO without prior diagnosis → detected; CM WO within 30d of diagnosis → NOT flagged; same WO flagged at 30d but NOT at 90d (window configurable); PM WO excluded |
| View: condition_noisy_rules | 3 | FP rate > 50% → flagged; rule with 0 diagnoses → NOT flagged; healthy rule (confirmed > 80%) → NOT flagged |
| View: condition_performance_by_fm | 1 | Returns correct per-FM aggregates |
| View: condition_performance_by_rule | 1 | Returns correct per-rule breakdown with false_positive_rate |
| View: condition_performance_by_source | 1 | Returns correct per-source breakdown |
| ALTER condition_daily_metrics | 1 | New columns exist and populated by compute_daily_metrics() |

## Open Questions

- [ ] **work_orders.failure_mode mapping** — The `condition_missed_detections` view uses `condition_diagnoses.failure_mode_id` through `linked_work_order_id`. Confirm that CM WOs are reliably linked to `condition_diagnoses` via `linked_work_order_id`. If a CM WO is created manually (not from a diagnosis), diagnosis fields will be NULL and the view will have `failure_mode_key=NULL`. The view still works, but the FM-level granularity is lost for those rows.
- [ ] **source_window_ids population** — The `condition_performance_by_source` view depends on `condition_diagnoses.source_window_ids` being populated during diagnosis creation. Verify this column is populated in the existing diagnostic pipeline (SDD 4 `generate_diagnosis()` function in `20260602100017_sdd4_patch_prearchive.sql`). If not, the view will return 0 rows per source.
- [ ] **compute_daily_metrics() extension** — The ALTER adds columns to `condition_daily_metrics` and expects `compute_daily_metrics()` to be modified. The function exists in migration 00019 (SDD 5). Confirm whether we should create a `CREATE OR REPLACE` in migration 25 or use a separate migration. Preferred: extend in migration 25 with `CREATE OR REPLACE` of the full function (including existing logic + outcome subqueries).

---

## Summary (PR 2)

**Change**: condition-monitoring-performance-improvement (SDD 6, PR 2 — Outcomes, Performance Metrics & FP/FN Review)

### Migrations

| # | File | Content |
|---|------|---------|
| 00024 | `20260604100024_sdd6_outcomes_table.sql` | 1 table (`condition_outcomes`), 2 indexes, RLS, 1 SECURITY DEFINER function (`record_condition_outcome`) |
| 00025 | `20260604100025_sdd6_performance_views_functions.sql` | 2 functions (`compute_performance_metrics`, `compute_false_positives`), 6 views (`condition_false_positives`, `condition_missed_detections`, `condition_noisy_rules`, `condition_performance_by_fm`, `condition_performance_by_rule`, `condition_performance_by_source`), ALTER `condition_daily_metrics` + `compute_daily_metrics()` |

### Objects Created

| Type | Count | Details |
|------|-------|---------|
| Tables | 1 | `condition_outcomes` (13 columns, 2 indexes, CHECK confirmed_status, FK to condition_diagnoses + work_orders) |
| Functions | 2 | `record_condition_outcome(UUID, UUID, ...) → UUID`, `compute_performance_metrics() → TABLE (9 cols)`, `compute_false_positives() → TABLE (8 cols)` |
| Views | 6 | FP review, missed detections (30/60/90d), noisy rules, per-FM breakdown, per-rule breakdown, per-source breakdown |
| ALTERs | 1 | `condition_daily_metrics` +3 outcome columns (`confirmed_outcomes`, `rejected_outcomes`, `partial_outcomes`) |
| Extended function | 1 | `compute_daily_metrics()` — now populates outcome columns |

### Architecture Decisions

4 decisions documented: outcome INSERT strategy (SECURITY DEFINER only), FP review function vs view (both), missed detection window (CROSS JOIN VALUES), daily metrics extension (ALTER + extend existing function).

### Testing

~40 pgTAP assertions planned: 20 for outcomes table + function + RLS, 20 for performance metrics function, 6 views, and daily metrics extension.

### Key Patterns (SDD 5/PR 1 Alignment)

- Idempotent DDL with `IF NOT EXISTS` and `DROP POLICY IF EXISTS`
- Spanish COMMENTs on all new tables, columns, functions, and views
- RLS with `get_user_role()` for role-based access
- `NULLIF` denominator safety — metrics return 0, never error
- `COALESCE(... , 0)` for zero-row data — no NULLs in aggregate rates
- SECURITY DEFINER function for controlled INSERT (same as `condition_audit_log`)
- `ON CONFLICT DO UPDATE` for daily metrics idempotency
- Views are advisory-only — no auto-disable or auto-activation
- `STABLE` marker for functions that don't modify data

## Technical Approach

**Capstone consumer layer — SQL-only proposal generation for all 5 PR 2-4 metric sources.** Two idempotent migrations add the improvement proposals table (`condition_improvement_proposals`) and two functions (`generate_improvement_proposals()`, `assess_improvement_opportunities()`). Same SDD 5/PR 1 conventions: UUID PKs, Spanish COMMENTs, idempotent DDL, RLS by role. The table is structurally similar to `condition_change_proposals` (PR 1) but with a distinct lifecycle (draft→review→approved→implemented→superseded) and a tighter constraint: the system NEVER auto-implements. No trigger auto-advances past `review`. The `generate_improvement_proposals()` function scans 5 data sources, deduplicates by `proposal_key`, and creates draft proposals for human review. `assess_improvement_opportunities()` provides a preview mode that returns ALL detected opportunities without writing anything. When a proposal is implemented, it links to the change control workflow via `change_proposal_id` FK → `condition_change_proposals`.

## Architecture Decisions

### Decision: Improvement proposals lifecycle vs change proposals lifecycle

| Option | Tradeoff |
|--------|----------|
| Reuse `condition_change_proposals` with a subtype column | +Single table, —Different lifecycle transitions, different roles, RLS complexity, "change" semantic mismatch (improvements are proposals, not changes) |
| Separate table with distinct lifecycle, FK to change_proposals on implementation | +Clean separation of concerns, lifecycle fits domain, FK bridges the two workflows; —Additional table |
| **Decision** | **Separate `condition_improvement_proposals`.** Lifecycle: draft→review→approved→implemented→superseded (or rejected from review). FK `change_proposal_id` links to `condition_change_proposals` only when a proposal is promoted to `implemented`. The two workflows are related but not identical — an improvement proposal becomes a controlled change when implemented. |

### Decision: Dedup strategy — proposal_key vs content hash

| Option | Tradeoff |
|--------|----------|
| `proposal_key` UNIQUE + `status NOT IN ('rejected','superseded')` | +Simple, deterministic, human-readable; —Requires careful key generation per source |
| Content hash of current_state/proposed_state | +Catches near-duplicates with different keys; —More complex, slower, false positives on fields that naturally drift |
| **Decision** | **`proposal_key` with active-status exclusion.** Keys follow `<source_type>:<entity_id>` pattern (e.g., `rule_review:d873f...`, `threshold_adjustment:THR-042`). `ON CONFLICT (proposal_key) DO NOTHING` handles the INSERT, and a WHERE clause excludes rows with existing non-terminal proposals. Simpler, cheaper, and aligned with the spec. |

### Decision: No auto-implementation — enforcement strategy

| Option | Tradeoff |
|--------|----------|
| Trigger that blocks UPDATE to approved/implemented | +DB-level guard; —Same as change_proposals but must allow human UPDATE |
| Convention only (no trigger) | +Simple; —No safety net, a bug in generate_improvement_proposals() could accidentally advance status |
| **Decision** | **Trust the RLS + function gate.** `generate_improvement_proposals()` ALWAYS inserts with `status = 'draft'` (hardcoded, not parameterized). No trigger or scheduled function writes to status. RLS ensures only PLANNER/ADMIN can UPDATE status. No additional trigger needed — existing pattern (trigger on change_proposals validates lifecycle but doesn't auto-advance). The `SECURITY DEFINER` on the generation function limits INSERT to the function only. |

### Decision: Preview mode — separate function vs parameter flag

| Option | Tradeoff |
|--------|----------|
| `assess_improvement_opportunities(p_preview BOOLEAN DEFAULT TRUE)` | +Single function; —Two code paths in one function, mixed concerns |
| Separate `assess_improvement_opportunities()` for preview + `generate_improvement_proposals()` for actual | +Clear separation, preview never writes; —Two functions to maintain |
| **Decision** | **Two separate functions per spec.** `assess_improvement_opportunities(p_asset_id TEXT DEFAULT NULL)` returns TABLE of detected opportunities with all metadata but NEVER inserts. `generate_improvement_proposals()` scans the same sources AND inserts draft proposals, returning INT count. Clearer contract, safer separation. |

## Migration Plan

### Migration 28: `20260604100028_sdd6_improvement_proposals_table.sql` — Table + RLS

| Section | Content |
|---------|---------|
| Table | `condition_improvement_proposals` — proposal generation lifecycle |
| Indexes | status, proposal_type, source_analysis for query/filter |
| RLS | SELECT authenticated; INSERT via SECURITY DEFINER only; UPDATE gated by role (PLANNER, ADMIN) |
| Dependencies | FK `change_proposal_id` → `condition_change_proposals(id)` ON DELETE SET NULL |

### Migration 29: `20260604100029_sdd6_improvement_proposals_functions.sql` — Functions

| Section | Content |
|---------|---------|
| Function | `generate_improvement_proposals()` — scans 5 sources, dedup, inserts draft proposals, RETURNS INT |
| Function | `assess_improvement_opportunities(p_asset_id TEXT DEFAULT NULL)` — preview mode, RETURNS TABLE |

## Schema Design

### condition_improvement_proposals

```sql
CREATE TABLE IF NOT EXISTS public.condition_improvement_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN (
      'threshold_adjustment','rule_review','pattern_update',
      'baseline_recalibration','policy_change','model_switch','rul_method_change'
    )),
  source_analysis TEXT NOT NULL,
  current_state JSONB,
  proposed_state JSONB,
  expected_benefit TEXT,
  risk TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','approved','rejected','implemented','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  implemented_at TIMESTAMPTZ,
  change_proposal_id UUID REFERENCES public.condition_change_proposals(id)
    ON DELETE SET NULL,
  CONSTRAINT uq_improvement_proposal_key UNIQUE (proposal_key)
);

COMMENT ON TABLE public.condition_improvement_proposals
  IS 'Propuestas de mejora generadas por el sistema basadas en datos de rendimiento. Lifecycle: draft→review→approved→implemented→superseded. El sistema NUNCA auto-implementa.';
COMMENT ON COLUMN public.condition_improvement_proposals.proposal_key
  IS 'Clave única determinística por fuente (ej: rule_review:{rule_id}, threshold_adjustment:{key})';
COMMENT ON COLUMN public.condition_improvement_proposals.proposal_type
  IS 'Tipo de propuesta: threshold_adjustment|rule_review|pattern_update|baseline_recalibration|policy_change|model_switch|rul_method_change';
COMMENT ON COLUMN public.condition_improvement_proposals.source_analysis
  IS 'Fuente de datos que originó la propuesta (ej: condition_false_positive_review, condition_performance_metrics)';
COMMENT ON COLUMN public.condition_improvement_proposals.current_state
  IS 'Estado actual de la entidad que se propone modificar (capturado al generar la propuesta)';
COMMENT ON COLUMN public.condition_improvement_proposals.proposed_state
  IS 'Estado propuesto (cambio sugerido por el sistema)';
COMMENT ON COLUMN public.condition_improvement_proposals.change_proposal_id
  IS 'FK a condition_change_proposals cuando la propuesta es implementada. Vincula mejora propuesta → cambio controlado.';
COMMENT ON COLUMN public.condition_improvement_proposals.status
  IS 'Estado en el lifecycle: draft|review|approved|rejected|implemented|superseded';

CREATE INDEX IF NOT EXISTS idx_improvement_proposals_status
  ON public.condition_improvement_proposals(status);
CREATE INDEX IF NOT EXISTS idx_improvement_proposals_type
  ON public.condition_improvement_proposals(proposal_type);
CREATE INDEX IF NOT EXISTS idx_improvement_proposals_source
  ON public.condition_improvement_proposals(source_analysis);

-- RLS: SELECT → authenticated; INSERT solo desde SECURITY DEFINER function;
-- UPDATE status: PLANNER puede review→approved/rejected; ADMIN approved→implemented
-- Non-status fields locked after review
ALTER TABLE public.condition_improvement_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cip_select ON public.condition_improvement_proposals;
CREATE POLICY cip_select ON public.condition_improvement_proposals
  FOR SELECT TO authenticated USING (true);

-- INSERT: solo la SECURITY DEFINER function puede insertar (status='draft')
DROP POLICY IF EXISTS cip_insert ON public.condition_improvement_proposals;
CREATE POLICY cip_insert ON public.condition_improvement_proposals
  FOR INSERT TO authenticated WITH CHECK (
    status = 'draft'
    -- El caller debe ser la function SECURITY DEFINER, verificamos que el role
    -- no sea anon y que venga del context de la function
    AND current_setting('request.jwt.claims', true)::json->>'role' != 'anon'
  );

-- UPDATE policy: status transitions gated by role, non-status fields locked post-draft
DROP POLICY IF EXISTS cip_update ON public.condition_improvement_proposals;
CREATE POLICY cip_update ON public.condition_improvement_proposals
  FOR UPDATE TO authenticated USING (
    -- Todos pueden editar drafts (cambiar descripción, expected_benefit, etc.)
    (OLD.status = 'draft')
    OR
    -- PLANNER puede enviar a review, aprobar o rechazar
    (
      current_setting('request.jwt.claims', true)::json->>'role' IN ('PLANNER', 'ADMIN')
      AND (
        (OLD.status = 'draft' AND NEW.status = 'review')
        OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected'))
      )
    )
    OR
    -- ADMIN puede marcar como implementado (vinculando change_proposal_id)
    (
      current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN'
      AND OLD.status = 'approved'
      AND NEW.status = 'implemented'
      AND NEW.change_proposal_id IS NOT NULL
    )
    OR
    -- Superseded desde implemented (solo ADMIN)
    (
      current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN'
      AND OLD.status = 'implemented'
      AND NEW.status = 'superseded'
    )
  );

DROP POLICY IF EXISTS cip_delete ON public.condition_improvement_proposals;
CREATE POLICY cip_delete ON public.condition_improvement_proposals
  FOR DELETE TO authenticated USING (
    current_setting('request.jwt.claims', true)::json->>'role' IN ('ADMIN')
    AND OLD.status = 'draft'
  );
```

## SQL Functions

### generate_improvement_proposals()

```sql
CREATE OR REPLACE FUNCTION public.generate_improvement_proposals()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_proposal_key TEXT;
  v_title TEXT;
  v_description TEXT;
  v_proposal_type TEXT;
  v_source TEXT;
  v_current JSONB;
  v_proposed JSONB;
  v_benefit TEXT;
  v_risk TEXT;
BEGIN
  -- ===================================================================
  -- Source 1: Noisy rules — fp_rate > 0.5
  -- FUENTE: condition_false_positive_review (PR 3)
  -- ===================================================================
  FOR v_proposal_key, v_title, v_description, v_proposal_type, v_source,
      v_current, v_proposed, v_benefit, v_risk IN
    SELECT
      'rule_review:' || fpr.rule_id::TEXT,
      'Regla ruidosa: ' || COALESCE(r.rule_name, fpr.rule_id::TEXT),
      'FP rate ' || ROUND(fpr.fp_rate::NUMERIC, 2) || ' supera el umbral 0.5. '
        || COALESCE(fpr.total_false_positives, 0) || ' falsos positivos en '
        || COALESCE(fpr.total_evaluations, 0) || ' evaluaciones.',
      'rule_review',
      'condition_false_positive_review',
      jsonb_build_object(
        'rule_id', fpr.rule_id,
        'fp_rate', fpr.fp_rate,
        'total_false_positives', fpr.total_false_positives,
        'total_evaluations', fpr.total_evaluations,
        'last_evaluated', fpr.last_evaluated
      ),
      jsonb_build_object(
        'suggested_action', 'review_threshold_or_rule',
        'suggested_fp_rate_target', 0.3
      ),
      'Reducir falsos positivos en ' || COALESCE(fpr.total_false_positives, 0)
        || ' eventos. Mejorar precision diagnostica.',
      'Medio — revisar si la regla sigue siendo valida para el asset'
    FROM public.condition_false_positive_review fpr
    LEFT JOIN public.condition_rules r ON r.id = fpr.rule_id
    WHERE fpr.fp_rate > 0.5
      AND NOT EXISTS (
        SELECT 1 FROM public.condition_improvement_proposals cip
        WHERE cip.proposal_key = 'rule_review:' || fpr.rule_id::TEXT
          AND cip.status NOT IN ('rejected', 'superseded')
      )
  LOOP
    INSERT INTO public.condition_improvement_proposals
      (proposal_key, title, description, proposal_type, source_analysis,
       current_state, proposed_state, expected_benefit, risk, status)
    VALUES
      (v_proposal_key, v_title, v_description, v_proposal_type, v_source,
       v_current, v_proposed, v_benefit, v_risk, 'draft');
    v_count := v_count + 1;
  END LOOP;

  -- ===================================================================
  -- Source 2: Low performance — confirmed_rate < 0.30
  -- FUENTE: condition_performance_metrics (PR 2)
  -- ===================================================================
  FOR v_proposal_key, v_title, v_description, v_proposal_type, v_source,
      v_current, v_proposed, v_benefit, v_risk IN
    SELECT
      CASE
        WHEN pm.metric_key LIKE 'rule:%' THEN 'rule_review:' || SPLIT_PART(pm.metric_key, ':', 2)
        ELSE 'threshold_adjustment:' || pm.metric_key
      END,
      'Bajo rendimiento: ' || pm.metric_key || ' — confirmado ' || ROUND(pm.confirmed_rate::NUMERIC, 2),
      'Tasa de confirmacion ' || ROUND(pm.confirmed_rate::NUMERIC, 2)
        || ' por debajo del umbral 0.30 en ' || COALESCE(pm.total_evaluations, 0) || ' evaluaciones.',
      CASE
        WHEN pm.metric_key LIKE 'rule:%' THEN 'rule_review'
        ELSE 'threshold_adjustment'
      END,
      'condition_performance_metrics',
      jsonb_build_object(
        'metric_key', pm.metric_key,
        'confirmed_rate', pm.confirmed_rate,
        'total_evaluations', pm.total_evaluations,
        'period_start', pm.period_start,
        'period_end', pm.period_end
      ),
      jsonb_build_object(
        'suggested_action', 'review_and_adjust',
        'target_confirmed_rate', 0.50
      ),
      'Mejorar tasa de confirmacion de '
        || ROUND(pm.confirmed_rate::NUMERIC * 100, 0)
        || '% a ≥50%. Reducir diagnosticos incorrectos.',
      'Bajo — cambio basado en datos confirmados'
    FROM public.condition_performance_metrics pm
    WHERE pm.confirmed_rate < 0.30
      AND pm.metric_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.condition_improvement_proposals cip
        WHERE cip.proposal_key = CASE
              WHEN pm.metric_key LIKE 'rule:%' THEN 'rule_review:' || SPLIT_PART(pm.metric_key, ':', 2)
              ELSE 'threshold_adjustment:' || pm.metric_key
            END
          AND cip.status NOT IN ('rejected', 'superseded')
      )
  LOOP
    INSERT INTO public.condition_improvement_proposals
      (proposal_key, title, description, proposal_type, source_analysis,
       current_state, proposed_state, expected_benefit, risk, status)
    VALUES
      (v_proposal_key, v_title, v_description, v_proposal_type, v_source,
       v_current, v_proposed, v_benefit, v_risk, 'draft');
    v_count := v_count + 1;
  END LOOP;

  -- ===================================================================
  -- Source 3: RUL bias — ABS(bias) > 0.20
  -- FUENTE: condition_prediction_calibration (PR 4)
  -- ===================================================================
  FOR v_proposal_key, v_title, v_description, v_proposal_type, v_source,
      v_current, v_proposed, v_benefit, v_risk IN
    SELECT
      'rul_method_change:' || pc.asset_id,
      'Sesgo RUL detectado: ' || ROUND(pc.bias::NUMERIC, 3)
        || ' en asset ' || pc.asset_id,
      'El sesgo absoluto ' || ROUND(ABS(pc.bias)::NUMERIC, 3)
        || ' supera el umbral 0.20. '
        || CASE WHEN pc.bias > 0 THEN 'Sobreestima' ELSE 'Subestima' END
        || ' la vida util remanente en ' || COALESCE(pc.total_predictions, 0) || ' predicciones.',
      CASE
        WHEN ABS(pc.bias) > 0.30 THEN 'rul_method_change'
        ELSE 'baseline_recalibration'
      END,
      'condition_prediction_calibration',
      jsonb_build_object(
        'asset_id', pc.asset_id,
        'bias', pc.bias,
        'underestimate_rate', pc.underestimate_rate,
        'overestimate_rate', pc.overestimate_rate,
        'total_predictions', pc.total_predictions,
        'last_calibration', pc.last_calibration
      ),
      jsonb_build_object(
        'suggested_action',
        CASE WHEN ABS(pc.bias) > 0.30 THEN 'review_rul_method' ELSE 'recalibrate_baseline' END,
        'target_max_bias', 0.10
      ),
      'Mejorar precision RUL en ' || pc.asset_id || '. Reducir sesgo de '
        || ROUND(pc.bias::NUMERIC * 100, 0) || '% a <10%.',
      'Medio-Alto — cambiar metodo RUL afecta predicciones activas'
    FROM public.condition_prediction_calibration pc
    WHERE ABS(pc.bias) > 0.20
      AND NOT EXISTS (
        SELECT 1 FROM public.condition_improvement_proposals cip
        WHERE cip.proposal_key IN (
              'rul_method_change:' || pc.asset_id,
              'baseline_recalibration:' || pc.asset_id
            )
          AND cip.status NOT IN ('rejected', 'superseded')
      )
  LOOP
    INSERT INTO public.condition_improvement_proposals
      (proposal_key, title, description, proposal_type, source_analysis,
       current_state, proposed_state, expected_benefit, risk, status)
    VALUES
      (v_proposal_key, v_title, v_description, v_proposal_type, v_source,
       v_current, v_proposed, v_benefit, v_risk, 'draft');
    v_count := v_count + 1;
  END LOOP;

  -- ===================================================================
  -- Source 4: Low data quality — quality='G3' for >7 consecutive days
  -- FUENTE: condition_source_registry (PR 1 extended)
  -- ===================================================================
  FOR v_proposal_key, v_title, v_description, v_proposal_type, v_source,
      v_current, v_proposed, v_benefit, v_risk IN
    SELECT
      'pattern_update:' || sr.source_id,
      'Calidad de datos baja: ' || sr.source_name || ' — G3 por >7 dias',
      'La fuente ' || sr.source_name || ' (' || sr.source_id
        || ') mantiene calidad G3 por ' || COALESCE(sr.consecutive_g3_days, 0)
        || ' dias consecutivos.',
      'pattern_update',
      'condition_source_registry',
      jsonb_build_object(
        'source_id', sr.source_id,
        'source_name', sr.source_name,
        'current_quality', sr.current_quality,
        'consecutive_g3_days', sr.consecutive_g3_days
      ),
      jsonb_build_object(
        'suggested_action', 'review_source_or_pattern',
        'recommended_quality_target', 'G2'
      ),
      'Restaurar calidad de datos a G2 o mejor. Evitar diagnosticos basados en datos degradados.',
      'Bajo — solo actualiza patron de calidad, no afecta reglas activas'
    FROM public.condition_source_registry sr
    WHERE sr.current_quality = 'G3'
      AND COALESCE(sr.consecutive_g3_days, 0) > 7
      AND NOT EXISTS (
        SELECT 1 FROM public.condition_improvement_proposals cip
        WHERE cip.proposal_key = 'pattern_update:' || sr.source_id
          AND cip.status NOT IN ('rejected', 'superseded')
      )
  LOOP
    INSERT INTO public.condition_improvement_proposals
      (proposal_key, title, description, proposal_type, source_analysis,
       current_state, proposed_state, expected_benefit, risk, status)
    VALUES
      (v_proposal_key, v_title, v_description, v_proposal_type, v_source,
       v_current, v_proposed, v_benefit, v_risk, 'draft');
    v_count := v_count + 1;
  END LOOP;

  -- ===================================================================
  -- Source 5: DRL increase & available candidate model
  -- FUENTE: condition_data_readiness VIEW (PR 1) + condition_degradation_models
  -- ===================================================================
  FOR v_proposal_key, v_title, v_description, v_proposal_type, v_source,
      v_current, v_proposed, v_benefit, v_risk IN
    SELECT DISTINCT
      'model_switch:' || dr.asset_id || ':' || dm.model_key,
      'Modelo disponible: ' || dm.model_name || ' para asset ' || dr.asset_id,
      'DRL actual ' || dr.drl_level || ' en asset ' || dr.asset_id
        || ' permite activar ' || dm.model_name || ' (min DRL ' || dm.min_data_readiness_level || ').'
        || ' Modelo actual: ' || COALESCE(dm_old.model_name, 'ninguno'),
      'model_switch',
      'condition_data_readiness + condition_degradation_models',
      jsonb_build_object(
        'asset_id', dr.asset_id,
        'current_drl', dr.drl_level,
        'current_model', dm_old.model_key,
        'candidate_model', dm.model_key
      ),
      jsonb_build_object(
        'suggested_action', 'evaluate_and_promote',
        'min_drl_met', true
      ),
      'Modelo ' || dm.model_name || ' puede mejorar precision vs '
        || COALESCE(dm_old.model_name, 'modelo actual')
        || ' en asset con DRL ' || dr.drl_level || '.',
      'Alto — cambiar modelo de degradacion afecta todas las predicciones RUL del asset'
    FROM public.condition_data_readiness dr
    JOIN public.condition_degradation_models dm
      ON dm.validation_status IN ('candidate', 'field_trial')
      AND dm.min_data_readiness_level <= dr.drl_level
    LEFT JOIN LATERAL (
      SELECT m.model_key, m.model_name
      FROM public.condition_model_applicability ma
      JOIN public.condition_degradation_models m ON m.id = ma.model_id
      WHERE ma.failure_mode_key = 'default'
        AND ma.asset_class = dr.asset_class
        AND m.validation_status = 'active'
      LIMIT 1
    ) dm_old ON true
    WHERE dr.drl_level >= 3  -- Solo assets con datos significativos
      AND NOT EXISTS (
        SELECT 1 FROM public.condition_improvement_proposals cip
        WHERE cip.proposal_key = 'model_switch:' || dr.asset_id || ':' || dm.model_key
          AND cip.status NOT IN ('rejected', 'superseded')
      )
  LOOP
    INSERT INTO public.condition_improvement_proposals
      (proposal_key, title, description, proposal_type, source_analysis,
       current_state, proposed_state, expected_benefit, risk, status)
    VALUES
      (v_proposal_key, v_title, v_description, v_proposal_type, v_source,
       v_current, v_proposed, v_benefit, v_risk, 'draft');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.generate_improvement_proposals()
  IS 'Escanea 5 fuentes de datos (ruido de reglas, bajo rendimiento, sesgo RUL, calidad baja, DRL incrementado) y crea propuestas de mejora en estado draft. Deduplica por proposal_key. Nunca auto-avanza mas alla de draft. Retorna cantidad de propuestas creadas.';
```

### assess_improvement_opportunities(p_asset_id TEXT DEFAULT NULL)

```sql
CREATE OR REPLACE FUNCTION public.assess_improvement_opportunities(
  p_asset_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  source_type TEXT,
  asset_id TEXT,
  reference_id TEXT,
  proposal_type TEXT,
  title TEXT,
  description TEXT,
  current_state JSONB,
  proposed_state JSONB,
  expected_benefit TEXT,
  risk TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Source 1: Noisy rules
  RETURN QUERY
  SELECT
    'noisy_rule'::TEXT AS source_type,
    r.asset_id::TEXT,
    fpr.rule_id::TEXT,
    'rule_review'::TEXT,
    'Regla ruidosa: FP rate ' || ROUND(fpr.fp_rate::NUMERIC, 2) AS title,
    'FP rate ' || ROUND(fpr.fp_rate::NUMERIC, 2) || ' supera 0.5' AS description,
    jsonb_build_object('rule_id', fpr.rule_id, 'fp_rate', fpr.fp_rate) AS current_state,
    jsonb_build_object('suggested_action', 'review_threshold_or_rule') AS proposed_state,
    'Reducir falsos positivos' AS expected_benefit,
    'Medio' AS risk
  FROM public.condition_false_positive_review fpr
  LEFT JOIN public.condition_rules r ON r.id = fpr.rule_id
  WHERE fpr.fp_rate > 0.5
    AND (p_asset_id IS NULL OR r.asset_id = p_asset_id);

  -- Source 2: Low performance
  RETURN QUERY
  SELECT
    'low_performance'::TEXT,
    pm.asset_id::TEXT,
    pm.metric_key,
    CASE WHEN pm.metric_key LIKE 'rule:%' THEN 'rule_review' ELSE 'threshold_adjustment' END,
    'Bajo rendimiento: ' || pm.metric_key || ' — ' || ROUND(pm.confirmed_rate::NUMERIC, 2),
    'Confirmed rate ' || ROUND(pm.confirmed_rate::NUMERIC, 2) || ' < 0.30',
    jsonb_build_object('metric_key', pm.metric_key, 'confirmed_rate', pm.confirmed_rate),
    jsonb_build_object('target_confirmed_rate', 0.50),
    'Mejorar precision diagnostica',
    'Bajo'
  FROM public.condition_performance_metrics pm
  WHERE pm.confirmed_rate < 0.30
    AND (p_asset_id IS NULL OR pm.asset_id = p_asset_id);

  -- Source 3: RUL bias
  RETURN QUERY
  SELECT
    'rul_bias'::TEXT,
    pc.asset_id,
    pc.asset_id,
    CASE WHEN ABS(pc.bias) > 0.30 THEN 'rul_method_change' ELSE 'baseline_recalibration' END,
    'Sesgo RUL: ' || ROUND(pc.bias::NUMERIC, 3),
    'ABS(bias) = ' || ROUND(ABS(pc.bias)::NUMERIC, 3) || ' > 0.20',
    jsonb_build_object('asset_id', pc.asset_id, 'bias', pc.bias),
    jsonb_build_object('target_max_bias', 0.10),
    'Mejorar precision RUL',
    'Medio-Alto'
  FROM public.condition_prediction_calibration pc
  WHERE ABS(pc.bias) > 0.20
    AND (p_asset_id IS NULL OR pc.asset_id = p_asset_id);

  -- Source 4: Low quality
  RETURN QUERY
  SELECT
    'low_quality'::TEXT,
    sr.asset_id::TEXT,
    sr.source_id,
    'pattern_update'::TEXT,
    'Calidad G3 por >7 dias: ' || sr.source_name,
    'Calidad G3 por ' || COALESCE(sr.consecutive_g3_days, 0) || ' dias',
    jsonb_build_object('source_id', sr.source_id, 'current_quality', sr.current_quality),
    jsonb_build_object('recommended_quality_target', 'G2'),
    'Restaurar calidad de datos',
    'Bajo'
  FROM public.condition_source_registry sr
  WHERE sr.current_quality = 'G3'
    AND COALESCE(sr.consecutive_g3_days, 0) > 7
    AND (p_asset_id IS NULL OR sr.asset_id = p_asset_id);

  -- Source 5: DRL increase
  RETURN QUERY
  SELECT DISTINCT
    'drl_increase'::TEXT,
    dr.asset_id,
    dm.model_key,
    'model_switch'::TEXT,
    'Modelo disponible: ' || dm.model_name || ' (DRL ' || dr.drl_level || ')',
    'DRL actual ' || dr.drl_level || ' >= min DRL ' || dm.min_data_readiness_level || ' del modelo',
    jsonb_build_object('asset_id', dr.asset_id, 'current_drl', dr.drl_level),
    jsonb_build_object('suggested_action', 'evaluate_and_promote'),
    'Modelo ' || dm.model_name || ' puede mejorar precision',
    'Alto'
  FROM public.condition_data_readiness dr
  JOIN public.condition_degradation_models dm
    ON dm.validation_status IN ('candidate', 'field_trial')
    AND dm.min_data_readiness_level <= dr.drl_level
  WHERE (p_asset_id IS NULL OR dr.asset_id = p_asset_id);
END;
$$;

COMMENT ON FUNCTION public.assess_improvement_opportunities(TEXT)
  IS 'Modo preview: retorna todas las oportunidades de mejora detectadas SIN crear propuestas. Same 5 fuentes que generate_improvement_proposals(). Filtra por asset_id si se provee. STABLE — no modifica datos.';
```

## Testing Strategy

### pgTAP: `sdd6_improvement_proposals_test.sql` (~16 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: condition_improvement_proposals | 6 | Table exists, all columns present (13 total), UNIQUE proposal_key, CHECK proposal_type, CHECK status completeness, indexes (3) |
| Functions | 2 | `generate_improvement_proposals()` exists with no params, `assess_improvement_opportunities(TEXT)` exists with one optional param |
| RLS policies | 4 | cip_select exists (authenticated can SELECT), cip_insert exists (draft-only), cip_update exists (role-gated transitions), cip_delete exists (ADMIN draft-only) |
| No auto-advance | 1 | `generate_improvement_proposals()` inserts with status='draft' only — verify no path to set status > 'draft' |
| Dedup | 2 | Same proposal_key with active status → skipped; same proposal_key with 'rejected' → new proposal created |
| Preview mode | 1 | `assess_improvement_opportunities()` returns TABLE without side effects (no rows inserted in condition_improvement_proposals) |

---

## Summary (PR 5)

**Change**: condition-monitoring-performance-improvement (SDD 6, PR 5 — Improvement Proposal Engine)

### Migrations

| # | File | Content |
|---|------|---------|
| 00028 | `20260604100028_sdd6_improvement_proposals_table.sql` | 1 table (`condition_improvement_proposals`), indexes, RLS |
| 00029 | `20260604100029_sdd6_improvement_proposals_functions.sql` | 2 functions (`generate_improvement_proposals`, `assess_improvement_opportunities`) |

### Objects Created

| Type | Count | Details |
|------|-------|---------|
| Tables | 1 | `condition_improvement_proposals` (13 columns, 3 indexes, UNIQUE on proposal_key, CHECK on proposal_type and status, FK to condition_change_proposals) |
| Functions | 2 | `generate_improvement_proposals()` → INT, `assess_improvement_opportunities(TEXT DEFAULT NULL)` → TABLE (10 columns) |
| Migrations | 2 | 00028 (DDL+RLS), 00029 (functions) |

### Architecture Decisions

3 decisions documented: separate improvement lifecycle, proposal_key dedup strategy, no-auto-implement enforcement via RLS + function gate.

### Testing

~16 pgTAP assertions across schema, functions, RLS, no-auto-advance, dedup, and preview mode.

### Key Patterns (SDD 5/PR 1 Alignment)

- Idempotent DDL with `IF NOT EXISTS` and `DROP POLICY IF EXISTS`
- Spanish COMMENTs on all columns
- RLS with deterministic role check via `request.jwt.claims`
- SECURITY DEFINER functions for controlled INSERT
- `ON CONFLICT (proposal_key) DO NOTHING` — idempotent re-runs
- STABLE marker for preview function (assess)
- All proposals created at `'draft'` — never auto-advanced past `review`

---

## PR 4 — RUL Calibration

### Technical Approach

**Snapshot-based calibration infrastructure.** Three migrations add a dedicated snapshots table that captures each RUL prediction at compute time, a calibration metrics function that compares predictions against confirmed outcomes, an outcome linking function, and a modification to `compute_rul_linear()` to auto-populate snapshots. All calibration is retrospective: snapshots are created when RUL is computed (inline in the SECURITY DEFINER function), outcomes are linked via `link_rul_outcomes()` after operational confirmation, and `compute_rul_calibration()` aggregates bias/MAPE/rates on linked data. On empty data, all functions return NULLs with zero rows — no exceptions, no errors.

### Architecture Decisions

#### Decision: Snapshot INSERT timing — inline in compute_rul_linear vs batch processor

| Option | Tradeoff |
|--------|----------|
| Separate batch process reads `condition_analysis_results` and creates snapshots | +Decoupled; —Snapshots delayed, misses prediction-time metadata (diagnosis_id, model_version, threshold) |
| INSERT inside `compute_rul_linear()` as same transaction | +Atomic, captures exact prediction state; —Couples snapshot creation to one function |
| **Decision** | **Inline INSERT in `compute_rul_linear()`.** The snapshot captures prediction-time context otherwise unavailable retroactively (which diagnosis triggered it, which threshold was used, which model version). Other prediction methods (piecewise_linear, exponential) add their own INSERTs when promoted. |

#### Decision: Link strategy — per-diagnosis FK vs asset_id+failure_mode_key batch

| Option | Tradeoff |
|--------|----------|
| Link by `diagnosis_id` FK (exact match) | +Precise FK; —Misses snapshots created before diagnosis existed (diagnosis_id=NULL) |
| Batch match by `asset_id` + `failure_mode_key` | +Catches all snapshots including pre-diagnosis; —May over-link if multiple outcomes exist for same asset+FM |
| **Decision** | **Try diagnosis_id first, fall back to asset+FM.** `link_rul_outcomes(p_outcome_id UUID)` queries the outcome's diagnosis chain: if a `condition_diagnoses` row maps to the outcome's asset+FM, link by `diagnosis_id` (precise). Otherwise link by `asset_id+failure_mode_key` (broader). This handles both cases without the caller needing to know the diagnosis_id. |

#### Decision: Calibration granularity — per-asset vs global aggregation

| Option | Tradeoff |
|--------|----------|
| Always aggregate all assets | +More data points per call; —Hides asset-level bias (good on pump A, bad on pump B) |
| Per-asset with optional FM + time window filter | +Actionable calibration per asset/FM; —Fewer data points per slice |
| **Decision** | **Three-axis filter.** `compute_rul_calibration(p_asset_id TEXT DEFAULT NULL, p_failure_mode_key TEXT DEFAULT NULL, p_days INT DEFAULT 365)`. NULL asset_id = aggregate all. Callers slice by asset or FM by passing parameters. The function returns 5 metrics plus a `total_predictions` count so consumers know the sample size. |

### Migration Plan

#### Migration 27: `20260604100027_sdd6_rul_calibration_table.sql` — condition_prediction_snapshots

```sql
CREATE TABLE IF NOT EXISTS public.condition_prediction_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  diagnosis_id UUID REFERENCES public.condition_diagnoses(id) ON DELETE SET NULL,
  failure_mode_key TEXT NOT NULL,
  prediction_type TEXT NOT NULL
    CHECK (prediction_type IN ('rul_estimate','failure_probability','state_estimate')),
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rul_low NUMERIC,
  rul_mid NUMERIC,
  rul_high NUMERIC,
  unit TEXT NOT NULL DEFAULT 'hours',
  confidence NUMERIC,
  method_key TEXT,
  method_version TEXT,
  model_key TEXT REFERENCES public.condition_degradation_models(model_key)
    ON DELETE RESTRICT,
  model_version INT,
  threshold_id TEXT,
  input_analysis_result_ids UUID[],
  actual_outcome_id UUID REFERENCES public.condition_outcomes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.condition_prediction_snapshots
  IS 'Instantáneas de predicciones de RUL para calibración. Cada fila captura una predicción en el momento del cómputo. actual_outcome_id se vincula después via link_rul_outcomes(). Append-only.';
COMMENT ON COLUMN public.condition_prediction_snapshots.prediction_type
  IS 'Tipo: rul_estimate|failure_probability|state_estimate';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_low
  IS 'Límite inferior del intervalo de confianza (horas)';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_mid
  IS 'Valor estimado medio de RUL (horas)';
COMMENT ON COLUMN public.condition_prediction_snapshots.rul_high
  IS 'Límite superior del intervalo de confianza (horas)';
COMMENT ON COLUMN public.condition_prediction_snapshots.method_key
  IS 'Clave del método (ej: linear_extrapolation)';
COMMENT ON COLUMN public.condition_prediction_snapshots.model_key
  IS 'FK a condition_degradation_models(model_key)';
COMMENT ON COLUMN public.condition_prediction_snapshots.input_analysis_result_ids
  IS 'UUIDs de condition_analysis_results que sirvieron como input de esta predicción';
COMMENT ON COLUMN public.condition_prediction_snapshots.actual_outcome_id
  IS 'FK a condition_outcomes. Se vincula post-confirmación operativa via link_rul_outcomes().';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cps_asset_predicted
  ON public.condition_prediction_snapshots(asset_id, predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_cps_diagnosis
  ON public.condition_prediction_snapshots(diagnosis_id);
CREATE INDEX IF NOT EXISTS idx_cps_fm_predicted
  ON public.condition_prediction_snapshots(failure_mode_key, predicted_at DESC);

-- RLS
ALTER TABLE public.condition_prediction_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cps_select ON public.condition_prediction_snapshots;
CREATE POLICY cps_select ON public.condition_prediction_snapshots
  FOR SELECT TO authenticated USING (true);

-- No direct INSERT — only SECURITY DEFINER functions (compute_rul_linear)
DROP POLICY IF EXISTS cps_insert ON public.condition_prediction_snapshots;
CREATE POLICY cps_insert ON public.condition_prediction_snapshots
  FOR INSERT TO authenticated WITH CHECK (false);

-- Only ADMIN can UPDATE (to set actual_outcome_id)
DROP POLICY IF EXISTS cps_update ON public.condition_prediction_snapshots;
CREATE POLICY cps_update ON public.condition_prediction_snapshots
  FOR UPDATE TO authenticated
  USING (current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN')
  WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'ADMIN');
```

#### Migration 28: `20260604100028_sdd6_rul_calibration_functions.sql` — calibration + linking

```sql
-- ============================================================
-- compute_rul_calibration: métricas de calibración de RUL
-- Compara predicciones vs outcomes confirmados.
-- Retorna NULLs sin error cuando no hay datos linkeados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_rul_calibration(
  p_asset_id TEXT DEFAULT NULL,
  p_failure_mode_key TEXT DEFAULT NULL,
  p_days INT DEFAULT 365
) RETURNS TABLE(
  asset_id TEXT,
  failure_mode_key TEXT,
  total_predictions BIGINT,
  bias NUMERIC,
  mape NUMERIC,
  underestimate_rate NUMERIC,
  overestimate_rate NUMERIC,
  confidence_calibration NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH calibration_data AS (
    SELECT
      s.asset_id,
      s.failure_mode_key,
      s.rul_mid,
      s.rul_low,
      s.rul_high,
      -- Actual RUL: hours between prediction time and outcome failure_date
      EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600 AS actual_hours,
      -- Error = predicted - actual (positive → overestimate, negative → underestimate)
      s.rul_mid - EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600 AS error,
      -- Absolute percentage error
      CASE
        WHEN EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600 > 0
        THEN ABS(s.rul_mid - EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600)
             / (EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600) * 100
      END AS abs_pct_error,
      -- 1 if underestimate (predicted < actual → model said "less time" than reality)
      CASE WHEN s.rul_mid < EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600
           THEN 1 ELSE 0 END AS is_under,
      -- 1 if overestimate (predicted > actual → model said "more time" than reality)
      CASE WHEN s.rul_mid > EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600
           THEN 1 ELSE 0 END AS is_over,
      -- 1 if actual fell inside [rul_low, rul_high] confidence interval
      CASE WHEN EXTRACT(EPOCH FROM (o.failure_date - s.predicted_at)) / 3600
                 BETWEEN s.rul_low AND s.rul_high
           THEN 1 ELSE 0 END AS in_interval
    FROM public.condition_prediction_snapshots s
    JOIN public.condition_outcomes o ON s.actual_outcome_id = o.id
    WHERE (p_asset_id IS NULL OR s.asset_id = p_asset_id)
      AND (p_failure_mode_key IS NULL OR s.failure_mode_key = p_failure_mode_key)
      AND s.predicted_at >= NOW() - (p_days || ' days')::INTERVAL
      AND s.actual_outcome_id IS NOT NULL
      AND o.confirmed_status IN ('confirmed', 'functional_failure')
  )
  SELECT
    cd.asset_id,
    cd.failure_mode_key,
    COUNT(*)::BIGINT AS total_predictions,
    AVG(cd.error) AS bias,
    AVG(cd.abs_pct_error) AS mape,
    SUM(cd.is_under)::NUMERIC / NULLIF(COUNT(*), 0) AS underestimate_rate,
    SUM(cd.is_over)::NUMERIC / NULLIF(COUNT(*), 0) AS overestimate_rate,
    SUM(cd.in_interval)::NUMERIC / NULLIF(COUNT(*), 0) AS confidence_calibration
  FROM calibration_data cd
  GROUP BY cd.asset_id, cd.failure_mode_key;
END;
$$;

COMMENT ON FUNCTION public.compute_rul_calibration(TEXT, TEXT, INT)
  IS 'Calcula métricas de calibración de RUL por asset+failure_mode: bias (error medio), MAPE (error porcentual absoluto medio), underestimate_rate (proporción subestimaciones), overestimate_rate (proporción sobrestimaciones), confidence_calibration (proporción dentro del IC). Filtra por asset, FM y ventana de días. Retorna 0 filas sin error si no hay datos linkeados.';


-- ============================================================
-- link_rul_outcomes: vincula snapshots con un outcome confirmado
-- Estrategia: primero intenta link por diagnosis_id (FK preciso);
-- si no hay diagnosis directa, linkea por asset_id + failure_mode_key.
-- Retorna cantidad de snapshots actualizados.
-- ============================================================
CREATE OR REPLACE FUNCTION public.link_rul_outcomes(
  p_outcome_id UUID
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_asset_id TEXT;
  v_failure_mode_key TEXT;
  v_linked INT;
  v_diagnosis_id UUID;
BEGIN
  -- Look up outcome's asset, failure mode, and candidate diagnosis
  SELECT
    o.asset_id,
    o.actual_failure_mode,
    d.id AS diagnosis_id
  INTO v_asset_id, v_failure_mode_key, v_diagnosis_id
  FROM public.condition_outcomes o
  LEFT JOIN public.condition_failure_mode_catalog fm
    ON fm.failure_mode_key = o.actual_failure_mode
  LEFT JOIN public.condition_diagnoses d
    ON d.asset_id = o.asset_id
   AND d.failure_mode_id = fm.id
   AND d.diagnosis_status IN ('active', 'field_trial', 'closed')
  WHERE o.id = p_outcome_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Link by diagnosis_id (precise FK match)
  IF v_diagnosis_id IS NOT NULL THEN
    UPDATE public.condition_prediction_snapshots
    SET actual_outcome_id = p_outcome_id
    WHERE diagnosis_id = v_diagnosis_id
      AND actual_outcome_id IS NULL;
  ELSE
    -- Fallback: link by asset + FM (catches pre-diagnosis snapshots)
    UPDATE public.condition_prediction_snapshots
    SET actual_outcome_id = p_outcome_id
    WHERE asset_id = v_asset_id
      AND failure_mode_key = v_failure_mode_key
      AND actual_outcome_id IS NULL;
  END IF;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  RETURN v_linked;
END;
$$;

COMMENT ON FUNCTION public.link_rul_outcomes(UUID)
  IS 'Vincula snapshots de RUL a un outcome confirmado. Primero intenta match por diagnosis_id (preciso); fallback a asset_id+failure_mode_key (amplio). Retorna nro de snapshots actualizados.';
```

#### Migration 28b: `20260604100028b_sdd6_rul_calibration_insert_snapshot.sql` — ALTER compute_rul_linear

```sql
-- ============================================================
-- CREATE OR REPLACE: compute_rul_linear() con INSERT en snapshots
-- Cambios vs SDD 4 original:
--   1. Captura v_diag_id desde condition_diagnoses
--   2. Captura v_ar_id desde INSERT analysis_results (RETURNING id)
--   3. INSERT en condition_prediction_snapshots al final
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_rul_linear(
  p_asset_id TEXT,
  p_feature_key TEXT,
  p_failure_mode_key TEXT
) RETURNS TABLE(
  rul_hours NUMERIC,
  confidence NUMERIC,
  uncertainty_low NUMERIC,
  uncertainty_high NUMERIC,
  assumptions TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_fd_id UUID;
  v_trend RECORD;
  v_threshold RECORD;
  v_rul NUMERIC;
  v_rul_low NUMERIC;
  v_rul_high NUMERIC;
  v_confidence NUMERIC;
  v_diag_id UUID;              -- NEW: para snapshot FK
  v_diag_confidence NUMERIC;
  v_current_value NUMERIC;
  v_slope_per_day NUMERIC;
  v_unit TEXT;
  v_quality_ok BOOLEAN;
  v_fm_id UUID;
  v_assumptions TEXT[] := '{}';
  v_ar_id UUID;                -- NEW: para input_analysis_result_ids
  v_model_version INT;          -- NEW: desde condition_degradation_models
BEGIN
  -- Resolver feature_definition_id
  SELECT id, unit INTO v_fd_id, v_unit
  FROM public.condition_feature_definitions
  WHERE feature_key = p_feature_key;

  IF v_fd_id IS NULL THEN
    assumptions := ARRAY['feature_key_not_found:' || p_feature_key];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 1: latest trend_slope con R² ≥ 0.5
  SELECT result_value, r_squared, confidence,
         (parameters->>'sample_count')::INT AS sample_count,
         window_end
  INTO v_trend
  FROM public.condition_analysis_results
  WHERE asset_id = p_asset_id
    AND feature_definition_id = v_fd_id
    AND analysis_type = 'trend_slope'
    AND method_key = 'linear_regression'
    AND r_squared >= 0.5
    AND result_value IS NOT NULL
  ORDER BY window_end DESC
  LIMIT 1;

  IF NOT FOUND THEN
    assumptions := ARRAY['r2_below_threshold:no_trend_found'];
    RETURN NEXT; RETURN;
  END IF;

  v_slope_per_day := v_trend.result_value;

  -- Gate 2: samples ≥ 10
  IF v_trend.sample_count IS NULL OR v_trend.sample_count < 10 THEN
    assumptions := ARRAY['insufficient_samples:' ||
      COALESCE(v_trend.sample_count::TEXT, 'NULL')];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 3: slope > 0 (degradación activa creciente)
  IF v_slope_per_day <= 0 THEN
    assumptions := ARRAY['slope_not_positive:' ||
      ROUND(v_slope_per_day::NUMERIC, 6)::TEXT];
    RETURN NEXT; RETURN;
  END IF;

  -- Gate 4: calidad de datos G0/G1 en el último feature_value
  SELECT EXISTS (
    SELECT 1 FROM public.condition_feature_values cfv
    JOIN public.condition_windows cw ON cfv.window_id = cw.id
    WHERE cw.asset_id = p_asset_id
      AND cfv.feature_definition_id = v_fd_id
      AND cfv.quality_flag IN ('G0', 'G1')
    ORDER BY cw.window_end DESC
    LIMIT 1
  ) INTO v_quality_ok;

  IF NOT v_quality_ok THEN
    assumptions := ARRAY['quality_too_low:latest_not_G0_or_G1'];
    RETURN NEXT; RETURN;
  END IF;

  -- Obtener último feature_value (current state)
  SELECT cfv.value INTO v_current_value
  FROM public.condition_feature_values cfv
  JOIN public.condition_windows cw ON cfv.window_id = cw.id
  WHERE cw.asset_id = p_asset_id
    AND cfv.feature_definition_id = v_fd_id
  ORDER BY cw.window_end DESC
  LIMIT 1;

  IF v_current_value IS NULL THEN
    assumptions := ARRAY['no_current_value'];
    RETURN NEXT; RETURN;
  END IF;

  -- Obtener threshold (zone_c_max) via get_applicable_thresholds
  SELECT zone_c_max INTO v_threshold
  FROM public.get_applicable_thresholds(
    p_asset_id, v_fd_id,
    'rms_velocity_window',
    (SELECT operational_context->>'regime'
     FROM public.condition_windows
     WHERE asset_id = p_asset_id
     ORDER BY window_end DESC LIMIT 1)
  );

  IF v_threshold.zone_c_max IS NULL OR v_threshold.zone_c_max <= v_current_value THEN
    v_rul := 0;
    v_assumptions := v_assumptions || ARRAY['threshold_reached_or_exceeded'];
  ELSE
    v_rul := (v_threshold.zone_c_max - v_current_value) / v_slope_per_day * 24;
    v_assumptions := v_assumptions || ARRAY['degradation_is_linear',
      'operating_regime_constant',
      'threshold_represents_functional_failure'];
  END IF;

  -- Resolver failure_mode_id + capture diagnosis_id (NEW: capture v_diag_id)
  SELECT id INTO v_fm_id
  FROM public.condition_failure_mode_catalog
  WHERE failure_mode_key = p_failure_mode_key;

  SELECT id, confidence INTO v_diag_id, v_diag_confidence
  FROM public.condition_diagnoses
  WHERE asset_id = p_asset_id
    AND failure_mode_id = v_fm_id
    AND diagnosis_status IN ('active', 'field_trial')
  ORDER BY created_at DESC
  LIMIT 1;

  v_diag_confidence := COALESCE(v_diag_confidence, 0.5);

  -- Confidence = MIN(trend_r2, diagnosis_confidence)
  v_confidence := LEAST(COALESCE(v_trend.r_squared, 0),
                        COALESCE(v_diag_confidence, 0));

  -- Uncertainty: ±20%
  v_rul_low := GREATEST(0, v_rul * 0.8);
  v_rul_high := v_rul * 1.2;

  -- Resolver model_version (NEW)
  SELECT version INTO v_model_version
  FROM public.condition_degradation_models
  WHERE model_key = 'linear_extrapolation';

  v_model_version := COALESCE(v_model_version, 1);

  -- Almacenar en condition_analysis_results (MODIFIED: capture v_ar_id)
  INSERT INTO public.condition_analysis_results (
    asset_id, feature_definition_id,
    analysis_type, method_key, method_version,
    result_value, result_unit, confidence,
    r_squared,
    parameters,
    window_end, validation_status
  ) VALUES (
    p_asset_id, v_fd_id,
    'rul_estimate', 'linear_extrapolation', '1.0',
    v_rul, 'hours', v_confidence,
    v_trend.r_squared,
    jsonb_build_object(
      'method', 'linear_extrapolation',
      'current_value', v_current_value,
      'threshold_value', v_threshold.zone_c_max,
      'slope_per_day', v_slope_per_day,
      'rul_hours', v_rul,
      'rul_low_estimate', v_rul_low,
      'rul_high_estimate', v_rul_high,
      'uncertainty_range_pct', 20,
      'diagnosis_confidence_used', v_diag_confidence,
      'failure_mode_key', p_failure_mode_key,
      'trend_r_squared', v_trend.r_squared,
      'trend_window_end', v_trend.window_end,
      'assumptions', to_jsonb(v_assumptions)
    ),
    NOW(), 'active'
  )
  RETURNING id INTO v_ar_id;

  -- NEW: INSERT snapshot for calibration
  INSERT INTO public.condition_prediction_snapshots (
    asset_id, diagnosis_id, failure_mode_key,
    prediction_type, predicted_at,
    rul_low, rul_mid, rul_high, unit,
    confidence, method_key, method_version,
    model_key, model_version,
    threshold_id, input_analysis_result_ids,
    actual_outcome_id
  ) VALUES (
    p_asset_id, v_diag_id, p_failure_mode_key,
    'rul_estimate', NOW(),
    v_rul_low, v_rul, v_rul_high, v_unit,
    v_confidence, 'linear_extrapolation', '1.0',
    'linear_extrapolation', v_model_version,
    v_threshold.zone_c_max::TEXT, ARRAY[v_ar_id],
    NULL
  );

  -- Retornar resultados
  rul_hours := v_rul;
  confidence := v_confidence;
  uncertainty_low := v_rul_low;
  uncertainty_high := v_rul_high;
  assumptions := v_assumptions;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.compute_rul_linear(TEXT, TEXT, TEXT)
  IS 'Estima RUL por extrapolación lineal con gates. MODIFICADO SDD 6: ahora también inserta snapshot en condition_prediction_snapshots para calibración.';
```

### View: condition_prediction_calibration (consumed by PR 5)

```sql
-- ============================================================
-- VIEW para consumo de PR 5 (Improvement Proposal Engine)
-- Expone calibración por asset como filas planas.
-- ============================================================
CREATE OR REPLACE VIEW public.condition_prediction_calibration
AS
SELECT
  COALESCE(c.asset_id, s.asset_id) AS asset_id,
  c.failure_mode_key,
  c.total_predictions,
  c.bias,
  c.mape,
  c.underestimate_rate,
  c.overestimate_rate,
  c.confidence_calibration,
  NOW() AS last_calibration
FROM public.compute_rul_calibration(NULL, NULL, 365) c
FULL JOIN (
  SELECT DISTINCT asset_id FROM public.condition_prediction_snapshots
) s ON c.asset_id = s.asset_id;

COMMENT ON VIEW public.condition_prediction_calibration
  IS 'Vista de calibración RUL por asset. Consumida por PR 5 (Improvement Proposal Engine) para detectar sesgos >20%. Envuelve compute_rul_calibration(). Assets sin datos linkeados no aparecen.';
```

### Testing Strategy

#### pgTAP: `sdd6_rul_calibration_test.sql` (~24 assertions)

| Area | Assertions | What |
|------|------------|------|
| Schema: condition_prediction_snapshots | 8 | Table exists; column count (19); CHECK prediction_type; FK diagnosis_id → condition_diagnoses; FK model_key → condition_degradation_models; FK actual_outcome_id → condition_outcomes; indexes (0=asset_predicted, 1=diagnosis, 2=fm_predicted); RLS policies (3: select, insert, update) |
| compute_rul_calibration | 6 | Function exists with 3 params + TABLE return; 0 rows when no data (no error); bias calculated correctly; mape calculated correctly; underestimate + overestimate rates sum to 1.0; confidence_calibration reflects interval coverage |
| link_rul_outcomes | 4 | Function exists (UUID → INT); links by diagnosis_id; falls back to asset+FM when no diagnosis; 0 linked for unknown outcome_id (no error) |
| compute_rul_linear snapshot INSERT | 3 | Successful RUL inserts 1 snapshot row with matching values; gate failure (R² < 0.5) inserts 0 snapshot rows; snapshot has correct prediction_type='rul_estimate', method_key='linear_extrapolation' |
| condition_prediction_calibration VIEW | 2 | View exists; returns correct columns (asset_id, bias, mape, rates, total_predictions) |
| RLS behavioral | 3 | authenticated can SELECT; direct INSERT blocked for all roles (including ADMIN); only ADMIN can UPDATE actual_outcome_id |

### Open Questions

- [ ] **Migration number collision with PR 5** — The existing design uses migration `00028` for PR 5's improvement_proposals table. PR 4 RUL calibration uses `00027`/`00028`/`00028b`. When combining all PRs, renumber: PR 2 → 24-25, PR 3 → 26, PR 4 → 27-28-28b, PR 5 → 29-30. Confirm ordering with team.
- [ ] **`condition_outcomes` table schema** — The FK `actual_outcome_id` references `condition_outcomes(id)`. Confirm the PR 2 table has column `failure_date TIMESTAMPTZ` (used by `compute_rul_calibration` for actual RUL computation) and `confirmed_status TEXT` for filtering.
- [ ] **`condition_prediction_calibration` VIEW** — PR 5's `generate_improvement_proposals()` references `public.condition_prediction_calibration` as a data source. This PR creates that VIEW wrapping `compute_rul_calibration()`. Confirm the column names match what PR 5 expects (`asset_id`, `bias`, `underestimate_rate`, `overestimate_rate`, `total_predictions`, `last_calibration`).
- [ ] **`compute_rul_linear` testing** — The snapshot INSERT tests require pre-seeded `condition_feature_definitions`, `condition_analysis_results` (trend_slope), `condition_diagnoses`, `condition_degradation_models`. Ensure the test setup script includes synthetic data for `linear_extrapolation` model and at least one active diagnosis.

---

## Summary (PR 4)

**Change**: condition-monitoring-performance-improvement (SDD 6, PR 4 — RUL Calibration)

### Migrations

| # | File | Content |
|---|------|---------|
| 00027 | `20260604100027_sdd6_rul_calibration_table.sql` | 1 table (`condition_prediction_snapshots`), 3 indexes, 3 RLS policies |
| 00028 | `20260604100028_sdd6_rul_calibration_functions.sql` | 2 functions (`compute_rul_calibration`, `link_rul_outcomes`), 1 view (`condition_prediction_calibration`) |
| 00028b | `20260604100028b_sdd6_rul_calibration_insert_snapshot.sql` | 1 function modified (`compute_rul_linear` — CREATE OR REPLACE with snapshot INSERT) |

### Objects Created / Modified

| Type | Count | Details |
|------|-------|---------|
| Tables (new) | 1 | `condition_prediction_snapshots` (19 columns, 3 indexes, 3 FKs, CHECK prediction_type) |
| Functions (new) | 2 | `compute_rul_calibration(TEXT,TEXT,INT) → TABLE`, `link_rul_outcomes(UUID) → INT` |
| Functions (modified) | 1 | `compute_rul_linear(TEXT,TEXT,TEXT)` — added snapshot INSERT + diagnosis_id capture |
| Views (new) | 1 | `condition_prediction_calibration` (wraps `compute_rul_calibration`, consumed by PR 5) |

### Architecture Decisions

3 decisions documented: inline snapshot INSERT timing, dual link strategy (diagnosis_id → asset+FM fallback), three-axis calibration filter.

### Testing

~24 pgTAP assertions across schema (8), compute_rul_calibration (6), link_rul_outcomes (4), compute_rul_linear snapshot INSERT (3), calibration VIEW (2), and RLS behavioral (3).

### Key Patterns (SDD 5/PR 1 Alignment)

- Idempotent DDL with `IF NOT EXISTS` and `DROP POLICY IF EXISTS`
- Spanish COMMENTs on all columns
- RLS with deterministic role check via `request.jwt.claims`
- SECURITY DEFINER functions for controlled INSERT (RLS blocks direct inserts with `CHECK (false)`)
- STABLE marker for read-only calibration function
- View wrapping function to expose computed data as queryable rows (for PR 5 consumption)
