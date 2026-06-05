# Spec Delta: condition-diagnoses
**Change**: condition-monitoring-operations-governance (SDD 5)
**Source**: proposal.md

## ADDED Requirements

### CDG-D5-001: condition_diagnosis_feedback table

**Priority**: MUST

The system MUST create a table `condition_diagnosis_feedback` with: id (UUID PK), diagnosis_id (UUID FK → condition_diagnoses(id)), work_order_id (UUID FK → work_orders(id)), feedback_status (TEXT CHECK: confirmed, partial, rejected), actual_failure_mode (TEXT), actual_component (TEXT), actual_cause (TEXT), technician_observation (TEXT), was_recommendation_useful (BOOLEAN), reviewed_by (TEXT), reviewed_at (TIMESTAMPTZ), created_at (TIMESTAMPTZ DEFAULT NOW()). Indexes on (diagnosis_id) and (work_order_id) MUST exist.

#### Scenario: Feedback row inserted with valid FK
- **GIVEN** diagnosis_id exists in condition_diagnoses, work_order_id exists in work_orders
- **WHEN** INSERT with feedback_status=`confirmed`, actual_failure_mode=`pump.cavitation`
- **THEN** row is created, all columns populated, FK references valid

#### Scenario: Invalid feedback_status rejected
- **GIVEN** valid diagnosis_id and work_order_id
- **WHEN** INSERT with feedback_status=`invalid_value`
- **THEN** CHECK constraint violation, insert fails

### CDG-D5-002: RLS by role

**Priority**: MUST

TECHNICIAN MUST be able to INSERT into condition_diagnosis_feedback. PLANNER and ADMIN MUST be able to UPDATE. SELECT MUST be allowed for all authenticated users.

#### Scenario: TECHNICIAN inserts feedback
- **GIVEN** authenticated user with role TECHNICIAN
- **WHEN** they INSERT into condition_diagnosis_feedback
- **THEN** insert succeeds

#### Scenario: PLANNER updates feedback
- **GIVEN** authenticated user with role PLANNER
- **WHEN** they UPDATE existing feedback row
- **THEN** update succeeds

#### Scenario: TECHNICIAN cannot update
- **GIVEN** authenticated user with role TECHNICIAN
- **WHEN** they attempt to UPDATE existing feedback
- **THEN** RLS denies the operation

### CDG-D5-003: Feedback form in DiagnosisPanel

**Priority**: MUST

The DiagnosisPanel MUST show an expandable feedback form for diagnoses with status `active` or `confirmed`. The form SHALL validate inputs and submit to the `condition_diagnosis_feedback` table.

#### Scenario: Feedback form renders for active diagnosis
- **GIVEN** diagnosis with status=`active`
- **WHEN** operator expands the feedback section
- **THEN** the feedback form renders with all required fields

#### Scenario: Form submission succeeds
- **GIVEN** all required fields populated with valid data
- **WHEN** operator submits the form
- **THEN** data is INSERTed into condition_diagnosis_feedback, success notification shown

#### Scenario: Form validation blocks incomplete submission
- **GIVEN** required field `feedback_status` is empty
- **WHEN** operator attempts to submit
- **THEN** validation error is shown, no insert occurs

### CDG-D5-004: Work order link

**Priority**: MUST

The `work_order_id` FK on `condition_diagnosis_feedback` MUST reference `work_orders(id)`. The UI SHALL allow selecting a work_order from the diagnosis's linked work orders.

#### Scenario: Feedback linked to existing work order
- **GIVEN** work_order `wo-456` exists and is linked to the diagnosis
- **WHEN** technician selects `wo-456` in the feedback form
- **THEN** work_order_id is stored and FK is valid

#### Scenario: Invalid work_order_id rejected
- **GIVEN** work_order_id = non-existent UUID
- **WHEN** INSERT into condition_diagnosis_feedback
- **THEN** FK violation, insert fails

### CDG-D5-005: Summary columns kept

**Priority**: MUST

The existing `feedback_status` and `feedback_notes` columns on `condition_diagnoses` MUST remain. They SHALL be populated via trigger from INSERT on `condition_diagnosis_feedback` as summary/denormalized fields.

#### Scenario: Trigger populates summary on feedback insert
- **GIVEN** condition_diagnosis with id=`diag-001`, existing feedback_status is NULL
- **WHEN** feedback is INSERTed into condition_diagnosis_feedback with feedback_status=`confirmed`
- **THEN** condition_diagnoses.feedback_status for `diag-001` is updated to `confirmed`

#### Scenario: Summary columns still readable directly
- **GIVEN** diagnosis `diag-001` has feedback
- **WHEN** querying condition_diagnoses directly (no JOIN)
- **THEN** feedback_status and feedback_notes are populated and readable
