# Spec: Condition Outcomes
**Domain**: condition-outcomes
**SDD**: 6 (condition-monitoring-performance-improvement)

## Purpose

Operational truth captured post-work-order: actual failure mode, component, cause, and confirmation status. Separate from `condition_diagnosis_feedback` (inline technician opinion during WO closure) because outcomes have a different lifecycle — they are reviewed, validated, and consumed by metrics computation. Outcomes close the Monitor→Diagnose→Act→Verify cycle.

## Requirements

### OUT-001: condition_outcomes table

**Priority**: MUST

The system MUST create a table `condition_outcomes` with: id (UUID PK), diagnosis_id (UUID FK → condition_diagnoses(id)), work_order_id (UUID FK → work_orders(id)), actual_failure_mode (TEXT), actual_component (TEXT), actual_cause (TEXT), confirmed_status (TEXT CHECK: confirmed, partial, rejected, unknown), failure_date (TIMESTAMPTZ), technician_notes (TEXT), evidence_quality (TEXT), reviewed_by (TEXT), reviewed_at (TIMESTAMPTZ), created_at (TIMESTAMPTZ DEFAULT NOW()). Indexes on (diagnosis_id) and (work_order_id) MUST exist.

#### Scenario: Outcome inserted with valid FKs
- **GIVEN** existing diagnosis_id in condition_diagnoses and work_order_id in work_orders
- **WHEN** INSERT with confirmed_status=`confirmed`, actual_failure_mode=`pump.cavitation`
- **THEN** row is created, all columns populated, FK references valid

#### Scenario: Invalid confirmed_status rejected
- **GIVEN** valid diagnosis_id and work_order_id
- **WHEN** INSERT with confirmed_status=`invalid_value`
- **THEN** CHECK constraint violation, insert fails

#### Scenario: Missing optional fields
- **GIVEN** valid diagnosis_id and work_order_id
- **WHEN** INSERT with only required fields (diagnosis_id, work_order_id, confirmed_status)
- **THEN** row is created, optional fields (technician_notes, evidence_quality, failure_date) are NULL

### OUT-002: Relationship to condition_diagnosis_feedback

**Priority**: MUST

`condition_outcomes` MUST be a separate table from `condition_diagnosis_feedback`. outcome.confirmed_status SHALL be populated from WO closure + technician review, NOT from inline feedback. Both tables SHALL coexist and be JOINable via diagnosis_id.

#### Scenario: Both tables coexist
- **GIVEN** diagnosis_id=`diag-001` has a row in condition_diagnosis_feedback and a row in condition_outcomes
- **WHEN** SELECT with JOIN ON diagnosis_id
- **THEN** both rows returned, feedback_status and confirmed_status may differ

#### Scenario: Outcome populated from WO closure
- **GIVEN** work_order `wo-001` is closed with failure_mode_key=`pump.cavitation`
- **WHEN** the WO closure workflow inserts into condition_outcomes
- **THEN** condition_diagnosis_feedback is NOT modified by the same operation

### OUT-003: RLS

**Priority**: MUST

SELECT MUST be allowed for all authenticated users. INSERT MUST be restricted to function invocation (via WO closure workflow). UPDATE MUST be restricted to ADMIN role.

#### Scenario: Authenticated user selects outcomes
- **GIVEN** authenticated user with any role
- **WHEN** SELECT from condition_outcomes
- **THEN** all rows returned

#### Scenario: Direct INSERT blocked
- **GIVEN** authenticated user with TECHNICIAN role
- **WHEN** INSERT into condition_outcomes directly
- **THEN** RLS denies the operation

#### Scenario: ADMIN updates outcome
- **GIVEN** authenticated user with ADMIN role
- **WHEN** UPDATE on existing outcome row
- **THEN** update succeeds

#### Scenario: Non-ADMIN cannot update
- **GIVEN** authenticated user with PLANNER role
- **WHEN** UPDATE on existing outcome row
- **THEN** RLS denies the operation

### OUT-004: Outcome ≠ diagnosis feedback lifecycle

**Priority**: SHOULD

condition_outcomes SHOULD be created as part of the work_order closure flow, not from the diagnosis panel. This enforces the separation: feedback is immediate technician input during closure; outcomes are the reviewed operational truth.

#### Scenario: Outcome created from WO closure process
- **GIVEN** work_order is being closed in the system
- **WHEN** closure function creates outcome record with reviewed_by set to the reviewing authority
- **THEN** outcome created_at is set to closure timestamp, reviewed_at may be later

#### Scenario: Multiple outcomes per diagnosis
- **GIVEN** diagnosis_id=`diag-001` with an existing outcome
- **WHEN** a second WO referencing the same diagnosis is closed
- **THEN** a second outcome row is created (1:N relationship: diagnosis → outcomes)
