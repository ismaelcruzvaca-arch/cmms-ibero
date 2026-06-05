# Spec: Condition Automation Policies
**Domain**: condition-automation-policies
**SDD**: 5 (condition-monitoring-operations-governance)

## Requirements

### POL-D5-001: Automation policies table
- **Description**: CREATE TABLE condition_automation_policies: id UUID PK, policy_key TEXT UNIQUE, policy_name TEXT, description TEXT, conditions JSONB, evaluation_order INT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
- **Rationale**: HITL logic must be configurable, not hardcoded in PL/pgSQL
- **Acceptance**: Table exists, UNIQUE on policy_key, CHECK on is_active

### POL-D5-002: Conditions JSONB schema
- **Description**: conditions JSONB supports: min_confidence NUMERIC, max_contradictory_count INT, min_completeness NUMERIC, min_quality_flag TEXT, required_roles TEXT[], requires_approval BOOLEAN, allowed_wo_types TEXT[], asset_criticality_allowed TEXT[], failure_mode_categories TEXT[], late_data_policy TEXT, requires_source_active BOOLEAN, requires_capability_active BOOLEAN
- **Rationale**: Policy conditions must be expressive enough to cover real operational scenarios
- **Acceptance**: JSONB stores all fields, function reads them correctly

### POL-D5-003: Seed 2 defaults
- **Description**: INSERT conservative policy (review required unless high confidence + complete + no contradictions) and permissive policy (allows auto-confirm at confidence >= 0.85 with quality G0/G1)
- **Rationale**: System must work out of the box with sensible defaults
- **Acceptance**: 2 rows exist with policy_key 'conservative' and 'permissive'

### POL-D5-004: generate_recommendation_v2() reads policies
- **Description**: New function reads active policies ordered by evaluation_order, applies first matching one. Fallback: if no policy matches or table is empty, conservative hardcoded logic.
- **Rationale**: Policy evaluation replaces hardcoded logic at the function level
- **Acceptance**: Function exists, returns recommendation based on policy, logs which policy was used

### POL-D5-005: Fallback to conservative
- **Description**: If no policy matches conditions or policies table is empty, requires_confirmation = true
- **Rationale**: Fail safe: if configuration is missing, human must review
- **Acceptance**: Fallback triggers when no policy matches

### POL-D5-006: CRUD via PolicyManagementPanel
- **Description**: UI panel for PLANNER/ADMIN to list, create, edit, and deactivate policies
- **Rationale**: Policies must be manageable without direct SQL access
- **Acceptance**: Panel renders, CRUD operations work, RLS enforced

### POL-D5-007: Policy evaluated at confirmation time too
- **Description**: Policies are checked both at recommendation generation AND at user confirmation/conversion attempt
- **Rationale**: A diagnosis may change confidence/status between generation and confirmation
- **Acceptance**: evaluate_automation_policy() can be called independently at any time

### POL-D5-008: Asset criticality and FM category filters
- **Description**: Policy conditions asset_criticality_allowed and failure_mode_categories restrict which assets/failure modes the policy applies to
- **Rationale**: Critical assets need stricter policies than non-critical
- **Acceptance**: Filter works, empty array means applies to all
