# Spec Delta: maintenance-recommendations
**Change**: condition-monitoring-operations-governance (SDD 5)
**Source**: proposal.md

## ADDED Requirements

### REC-D5-004: Filterable recommendation list

**Priority**: MUST

The system MUST provide a UI list of recommendations filterable by status and priority. Operators SHALL find specific recommendations quickly without scanning all records.

#### Scenario: Filter by status shows matching subset
- **GIVEN** recommendations with mixed statuses (suggested, approved, dismissed)
- **WHEN** operator selects status filter = `approved`
- **THEN** only recommendations with status=`approved` are displayed

#### Scenario: Empty state when no matches
- **GIVEN** no recommendations match the selected filter
- **WHEN** filter is applied
- **THEN** empty state message renders with a clear call-to-action

### REC-D5-005: PLANNER/ADMIN can approve

**Priority**: MUST

PLANNER and ADMIN roles MUST be able to set recommendation status to `approved`. TECHNICIAN MUST NOT be able to approve.

#### Scenario: PLANNER approves recommendation
- **GIVEN** authenticated user with role PLANNER
- **WHEN** they UPDATE status = `approved` on a recommendation
- **THEN** the update succeeds, status changes to `approved`

#### Scenario: TECHNICIAN approval denied
- **GIVEN** authenticated user with role TECHNICIAN
- **WHEN** they attempt to UPDATE status = `approved`
- **THEN** RLS denies the operation

### REC-D5-006: ADMIN can dismiss

**Priority**: MUST

ADMIN MUST be able to set status to `dismissed`. The update MUST fail if `dismissed_reason` is NULL. RLS MUST restrict this action to ADMIN only.

#### Scenario: ADMIN dismisses with reason
- **GIVEN** authenticated user with role ADMIN
- **WHEN** they UPDATE status = `dismissed` AND dismissed_reason = `"No aplica, inspección visual confirmó operación normal"`
- **THEN** the update succeeds, status changes to `dismissed`

#### Scenario: Dismissal fails without reason
- **GIVEN** authenticated user with role ADMIN
- **WHEN** they UPDATE status = `dismissed` with dismissed_reason IS NULL
- **THEN** the update fails with a constraint violation

#### Scenario: Non-ADMIN cannot dismiss
- **GIVEN** authenticated user with role PLANNER or TECHNICIAN
- **WHEN** they attempt to UPDATE status = `dismissed`
- **THEN** RLS denies the operation

### REC-D5-007: ADMIN can convert to WO

**Priority**: MUST

A function `convert_recommendation_to_wo()` MUST exist. ADMIN can call it on an approved recommendation to: INSERT a work_order (type from recommendation's work_order_type), SET the recommendation status to `converted_to_wo`, and LINK work_order_id. The function MUST return the new WO id.

#### Scenario: Convert approved recommendation to work order
- **GIVEN** recommendation with status=`approved`, work_order_type=`predictive`
- **WHEN** ADMIN calls `convert_recommendation_to_wo(rec_id)`
- **THEN** a new work_order of type `predictive` is created, recommendation status becomes `converted_to_wo`, work_order_id is populated, and the WO id is returned

#### Scenario: Cannot convert non-approved recommendation
- **GIVEN** recommendation with status=`suggested`
- **WHEN** ADMIN calls `convert_recommendation_to_wo(rec_id)`
- **THEN** the function raises an error, no WO is created

### REC-D5-008: ADMIN can supersede

**Priority**: SHOULD

ADMIN MUST be able to set status to `superseded`, linking `superseded_by` to a new recommendation UUID. The FK chain MUST remain traceable.

#### Scenario: Supersede with valid FK
- **GIVEN** recommendation A status=`approved` and a new recommendation B exists
- **WHEN** ADMIN UPDATEs A.status = `superseded`, A.superseded_by = B.id
- **THEN** A.status becomes `superseded`, FK from A.superseded_by references B.id

#### Scenario: Supersede with invalid target fails
- **GIVEN** recommendation A
- **WHEN** ADMIN attempts to SET superseded_by = non-existent UUID
- **THEN** FK constraint violation, update fails

### REC-D5-009: Auto-expiration

**Priority**: SHOULD

A function `expire_stale_recommendations()` MUST SET status = `expired` for recommendations where `due_window_days` have passed AND status IN (`suggested`, `review_required`). The function SHALL be callable manually or via pg_cron.

#### Scenario: Stale recommendation expires
- **GIVEN** recommendation with due_window_days=14, created_at = 30 days ago, status=`suggested`
- **WHEN** `expire_stale_recommendations()` is executed
- **THEN** status changes to `expired`

#### Scenario: Active recommendation not expired
- **GIVEN** recommendation with status=`approved`, due_window_days passed
- **WHEN** `expire_stale_recommendations()` is executed
- **THEN** status remains `approved` (only suggested/review_required are affected)

### REC-D5-010: Repeat dismissal gate

**Priority**: MUST

If a recommendation with the same `failure_mode_key` diagnosis was dismissed or rejected in the last 30 days, new recommendations MUST default to status `review_required` instead of `suggested`.

#### Scenario: Repeated diagnosis after dismissal
- **GIVEN** a dismissed recommendation for failure_mode_key=`pump.cavitation` from 10 days ago
- **WHEN** a new recommendation is generated for the same failure_mode_key
- **THEN** the new recommendation status defaults to `review_required`

#### Scenario: New diagnosis after dismissal window
- **GIVEN** a dismissed recommendation for failure_mode_key=`pump.cavitation` from 45 days ago
- **WHEN** a new recommendation is generated for the same failure_mode_key
- **THEN** the new recommendation status defaults to `suggested` (normal path)

## MODIFIED Requirements

### REC-002: Tabla de recomendaciones

**Priority**: MUST

La tabla `maintenance_recommendations` DEBE almacenar: id (UUID PK), diagnosis_id (FK → condition_diagnoses), recommended_action (TEXT NOT NULL), status (TEXT CHECK: suggested, review_required, approved, dismissed, converted_to_wo, expired DEFAULT 'suggested'), priority (TEXT CHECK: low, medium, high, critical), due_window_days (INTEGER), work_order_type (TEXT — ej. corrective, preventive, predictive), required_parts (JSONB nullable), required_skills (TEXT[] nullable), requires_confirmation (BOOLEAN DEFAULT true), reviewed_by (TEXT nullable), reviewed_at (TIMESTAMPTZ nullable), dismissed_reason (TEXT nullable), superseded_by (UUID nullable FK → maintenance_recommendations(id)), work_order_id (UUID nullable FK → work_orders(id) ON DELETE SET NULL), created_at (TIMESTAMPTZ DEFAULT NOW()).
(Previously: table without status, audit columns, WO FK)

#### Scenario: Recomendación almacenada con prioridad
- **GIVEN** diagnóstico con severity_default=`critical`, confidence=0.85
- **WHEN** se genera la recomendación
- **THEN** priority=`high`, work_order_type=`predictive`, status=`suggested`

#### Scenario: Partes requeridas documentadas
- **GIVEN** pump.cavitation requiere mechanical_seal y bearing
- **WHEN** se genera recommendación
- **THEN** required_parts contiene `{"seal_mechanical": 1, "bearing_6205": 2}`

#### Scenario: Work order FK set NULL on WO delete
- **GIVEN** recommendation linked to work_order_id=`wo-123`
- **WHEN** the referenced work_order is deleted
- **THEN** work_order_id becomes NULL (SET NULL behavior)

#### Scenario: Superseded recommendation FK chain
- **GIVEN** recommendation A linked via superseded_by to recommendation B
- **WHEN** reading both recommendations
- **THEN** the FK chain A.superseded_by → B.id is valid and traceable
