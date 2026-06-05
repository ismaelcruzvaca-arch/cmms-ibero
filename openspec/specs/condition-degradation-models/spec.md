# Spec: Condition Degradation Models
**Domain**: condition-degradation-models
**SDD**: 6 (condition-monitoring-performance-improvement)

## Requirements

### DGM-D6-001: Degradation model catalog table
- **Description**: CREATE TABLE condition_degradation_models: id UUID PK DEFAULT gen_random_uuid(), model_key TEXT UNIQUE NOT NULL, model_name TEXT NOT NULL, model_type TEXT NOT NULL CHECK (model_type IN ('linear','piecewise_linear','exponential','weibull','gamma','wiener','custom')), description TEXT, assumptions TEXT[], input_requirements TEXT[], min_data_readiness_level INT NOT NULL DEFAULT 0 CHECK (min_data_readiness_level BETWEEN 0 AND 6), validation_status TEXT NOT NULL DEFAULT 'draft' CHECK (validation_status IN ('draft','candidate','field_trial','active','deprecated','superseded')), version INT DEFAULT 1, parameters_schema JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
- **Rationale**: SDD 4 deferred model governance. Before adding more model types, we need a governed registry with lifecycle, DRL requirements, and parameter schemas.
- **Acceptance**: Table exists with all columns, UNIQUE on model_key, CHECK constraints enforce valid values

### DGM-D6-002: Seed models
- **Description**: INSERT 6 seed models: linear_extrapolation (active, DRL 2), piecewise_linear (candidate, DRL 4), exponential_degradation (candidate, DRL 4), weibull_rul (draft, DRL 6), gamma_process (draft, DRL 6), wiener_process (draft, DRL 6)
- **Rationale**: Linear is the only production-ready model from SDD 4. Others are registered at lower governance levels with their minimum DRL documented.
- **Acceptance**: 6 seeds exist, correct validation_status and min_data_readiness_level per seed

### DGM-D6-003: Model lifecycle enforcement
- **Description**: Model validation_status transitions follow: draft → candidate → field_trial → active → deprecated/superseded. Rejected is reachable from candidate or field_trial. Each transition logged to condition_audit_log via trigger.
- **Rationale**: No model activates without validation steps. Audit trail ensures governance transparency.
- **Acceptance**: CHECK or trigger enforces valid transitions, audit entries created on each transition

### DGM-D6-004: Model applicability matrix
- **Description**: CREATE TABLE condition_model_applicability: id UUID PK DEFAULT gen_random_uuid(), model_id UUID NOT NULL REFERENCES condition_degradation_models(id) ON DELETE CASCADE, failure_mode_key TEXT NOT NULL, asset_class TEXT NOT NULL, min_samples INT, min_r_squared NUMERIC, notes TEXT. UNIQUE(model_id, failure_mode_key, asset_class).
- **Rationale**: Not all models apply to all failure modes. Linear may work for wear but not for cavitation. Applicability matrix documents which model fits where.
- **Acceptance**: Table exists, FK valid, UNIQUE constraint works, applicability queryable by model or failure_mode

### DGM-D6-005: RLS
- **Description**: SELECT for all authenticated users. INSERT/UPDATE/DELETE restricted to PLANNER and ADMIN roles.
- **Rationale**: Model governance is an admin function; read access is transparent for all operators
- **Acceptance**: RLS policies exist, SELECT works for authenticated, mutation fails for non-PLANNER
