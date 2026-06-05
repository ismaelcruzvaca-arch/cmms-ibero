# Preventive & Condition-Based Maintenance — Core Schema & CBM Automation

## Purpose

Database foundation and automation layer for PM/CBM module. Defines job plan templates, scheduling rules (time/meter-driven), asset condition monitoring via meters with threshold-based alerting, and CBM alert trigger that evaluates meter readings against thresholds and conditionally generates work orders.

## Requirements

### Requirement: job_plans Table

The system MUST create a `job_plans` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | UNIQUE NOT NULL |
| description | TEXT | nullable |
| intervention_type | TEXT | NOT NULL, CHECK (IN: 'INSPECTION','LUBRICATION','MINOR_SERVICE','OVERHAUL') |
| estimated_hours | NUMERIC | DEFAULT 0 |
| asset_type_id | TEXT | nullable, FK → asset_types(id) |
| is_active | BOOLEAN | DEFAULT true |
| updated_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

#### Scenario: Create a job plan

- GIVEN a valid intervention_type and unique code
- WHEN a planner inserts a job plan
- THEN the row is created with generated UUID, default timestamps, is_active=true, and asset_type_id=NULL

#### Scenario: Duplicate code rejected

- GIVEN a job plan with code 'PM-001' exists
- WHEN inserting another with the same code
- THEN the INSERT MUST fail with unique constraint violation

#### Scenario: Asset type filtering

- GIVEN job plans with asset_type_id='PUMP' and asset_type_id=NULL (generic)
- WHEN querying plans applicable to a 'PUMP' asset
- THEN both the type-specific plan (asset_type_id='PUMP') and generic plans (asset_type_id=NULL) are returned

#### Scenario: Updated_at set on update

- GIVEN a job plan exists
- WHEN the planner updates the description
- THEN updated_at SHALL be set to the current timestamp

### Requirement: job_plan_tasks Table

The system MUST create a `job_plan_tasks` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| step_sequence | INT | NOT NULL |
| task_description | TEXT | NOT NULL |
| | | UNIQUE(job_plan_id, step_sequence) |

#### Scenario: Add sequenced tasks to a job plan

- GIVEN a job plan exists
- WHEN tasks with sequential step numbers are inserted
- THEN all tasks are persisted in order

#### Scenario: Cascade delete

- GIVEN a job plan with associated tasks
- WHEN the job plan is deleted
- THEN all its tasks are deleted

#### Scenario: Duplicate step sequence

- GIVEN step_sequence 10 is assigned for a job plan
- WHEN inserting another step_sequence 10 for the same job plan
- THEN the INSERT MUST fail with unique constraint violation

### Requirement: job_plan_materials Table

The system MUST create a `job_plan_materials` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| part_num | TEXT | nullable, references spare_parts optionally |
| planned_qty | NUMERIC | NOT NULL, CHECK (> 0) |

#### Scenario: Add materials to a job plan

- GIVEN a job plan exists
- WHEN material rows with planned_qty > 0 are inserted
- THEN materials are linked to the job plan

#### Scenario: Zero quantity rejected

- GIVEN a job plan exists
- WHEN inserting a material with planned_qty = 0
- THEN the INSERT MUST fail with CHECK constraint violation

### Requirement: checklist_templates.job_plan_task_id

The system MUST ADD a `job_plan_task_id` column to `checklist_templates`:

| Column | Type | Constraints |
|--------|------|-------------|
| job_plan_task_id | UUID | nullable, FK → job_plan_tasks(id) |

When NULL, the checklist applies to the entire plan (existing behavior). When set, the checklist applies to a specific task within the plan.

#### Scenario: Task-level checklist link

- GIVEN a job plan with task T1
- WHEN a checklist_template is inserted with job_plan_task_id = T1's UUID
- THEN the checklist is linked to that specific task, not the entire plan

#### Scenario: NULL means plan-level (backward compat)

- GIVEN existing checklist_templates with job_plan_task_id = NULL
- WHEN querying checklists for a job plan
- THEN NULL-valued templates apply to the entire plan (unchanged behavior)

### Requirement: pm_schedules Table

The system MUST create a `pm_schedules` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| asset_id | TEXT | NOT NULL, FK → assets(id) |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) |
| time_frequency_days | INT | nullable |
| meter_frequency_value | NUMERIC | nullable |
| is_floating | BOOLEAN | DEFAULT false |
| parent_schedule_id | UUID | nullable, FK → pm_schedules(id) |
| suppression_multiplier | INT | nullable |
| last_completion_date | TIMESTAMPTZ | nullable |
| next_target_date | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

#### Scenario: Time-based PM schedule

- GIVEN an asset and a job plan exist
- WHEN a schedule with time_frequency_days = 30 is created
- THEN next_target_date SHALL be calculated as last_completion_date + 30 days

#### Scenario: Suppression chain

- GIVEN a parent schedule exists
- WHEN a child schedule links via parent_schedule_id with suppression_multiplier = 2
- THEN the child's next_target_date is suppressed until the parent is overdue by 2 cycles

#### Scenario: Meter-driven schedule

- GIVEN time_frequency_days is NULL and meter_frequency_value = 1000
- WHEN the schedule is evaluated
- THEN it triggers based on accumulated meter readings, not calendar days

### Requirement: meters Table

The system MUST create a `meters` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| asset_id | TEXT | NOT NULL, FK → assets(id) |
| code | TEXT | NOT NULL |
| meter_type | TEXT | NOT NULL, CHECK (IN: 'CONTINUOUS','GAUGE','CHARACTERISTIC') |
| uom | TEXT | NOT NULL |

#### Scenario: Register a meter on an asset

- GIVEN an asset exists
- WHEN a meter with valid meter_type and uom is inserted
- THEN the meter is linked to the asset for condition tracking

#### Scenario: Invalid meter_type rejected

- GIVEN an asset exists
- WHEN inserting a meter with meter_type = 'VOLTAGE'
- THEN the INSERT MUST fail with CHECK constraint violation

### Requirement: measure_points Table

The system MUST create a `measure_points` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| meter_id | UUID | NOT NULL, FK → meters(id) ON DELETE CASCADE |
| upper_limit_warning | NUMERIC | nullable |
| upper_limit_critical | NUMERIC | nullable |
| lower_limit_warning | NUMERIC | nullable |
| lower_limit_critical | NUMERIC | nullable |

#### Scenario: Define thresholds for a meter

- GIVEN a meter exists
- WHEN measure_points with warning and critical limits are inserted
- THEN thresholds are set for condition-based alerting

#### Scenario: Thresholds cascade on meter removal

- GIVEN measure_points exist for a meter
- WHEN the meter is deleted
- THEN all associated measure_points are deleted

### Requirement: meter_readings Table

The system MUST create a `meter_readings` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| meter_id | UUID | NOT NULL, FK → meters(id) ON DELETE CASCADE |
| reading_value | NUMERIC | NOT NULL |
| reading_date | TIMESTAMPTZ | DEFAULT NOW() |
| is_alert_triggered | BOOLEAN | DEFAULT false |

#### Scenario: Record a meter reading

- GIVEN a meter exists
- WHEN a numeric reading_value is inserted
- THEN the reading is stored with auto-generated timestamp

#### Scenario: Historical readings retrieval

- GIVEN multiple readings exist for a meter across different dates
- WHEN querying ordered by reading_date DESC
- THEN the full reading history is returned with the most recent first

#### Scenario: Warning reading flagged

- GIVEN a measure_point with upper_limit_warning = 100
- WHEN inserting a reading with value = 105
- THEN `is_alert_triggered` = true
- AND NO work order is created

#### Scenario: Critical reading creates work order

- GIVEN a measure_point with upper_limit_critical = 120
- WHEN inserting a reading with value = 130
- THEN `is_alert_triggered` = true
- AND a work order is created with `wo_type = 'CBM'`
- AND the work order has `lifecycle_phase = 'WAPPR'`

#### Scenario: Anti-spam suppresses duplicate alerts

- GIVEN an existing CBM work order for asset A1 + meter M1 in WAPPR status
- WHEN inserting a new critical reading for A1 + M1
- THEN the reading is flagged `is_alert_triggered = true`
- BUT no new work order is created
- AND the existing work order is reused

#### Scenario: Normal reading below all thresholds

- GIVEN a measure_point with warning = 100, critical = 120
- WHEN inserting a reading with value = 50
- THEN `is_alert_triggered` remains FALSE
- AND no work order is created

#### Scenario: Lower limit critical

- GIVEN a measure_point with lower_limit_critical = 10
- WHEN inserting a reading with value = 5
- THEN `is_alert_triggered` = true
- AND a work order is created with `symptom_note` describing the low-limit breach

### Requirement: RLS Access Control

The system MUST enable RLS on all 7 core tables plus the new `job_plan_labor` and `job_plan_safety` tables. ADMIN and PLANNER SHALL have full read/write on all core tables. TECHNICIAN SHALL have SELECT on all core tables and INSERT only on `meter_readings`.

For `job_plan_labor` and `job_plan_safety`: ADMIN SHALL have ALL DML, PLANNER SHALL have SELECT/INSERT/UPDATE (not DELETE), TECHNICIAN SHALL have SELECT only.

#### Scenario: ADMIN full access

- GIVEN an authenticated user with role ADMIN
- WHEN performing any DML on any table
- THEN the operation succeeds

#### Scenario: TECHNICIAN inserts reading

- GIVEN an authenticated user with role TECHNICIAN
- WHEN inserting into meter_readings
- THEN the operation succeeds

#### Scenario: TECHNICIAN denied on job_plans INSERT

- GIVEN an authenticated user with role TECHNICIAN
- WHEN attempting to INSERT into job_plans
- THEN the RLS policy rejects the operation

#### Scenario: TECHNICIAN read-only on job_plan_labor

- GIVEN a user with role TECHNICIAN
- WHEN SELECTing from job_plan_labor
- THEN rows are returned
- WHEN attempting INSERT
- THEN the RLS policy rejects the operation

#### Scenario: ADMIN full access on job_plan_safety

- GIVEN a user with role ADMIN
- WHEN performing any DML on job_plan_safety
- THEN the operation succeeds

### Requirement: `meter_id` on work_orders (CBM)

The system MUST add a `meter_id` column to `work_orders` for tracing which sensor triggered a condition-based work order.

| Column | Type | Constraints |
|--------|------|-------------|
| meter_id | UUID | FK → meters(id), nullable, only set for CBM work orders |

#### Scenario: CBM work order links to meter

- GIVEN a meter reading exceeds a critical limit
- WHEN the trigger creates a work order
- THEN `work_orders.meter_id` = the meter that triggered the alert

## Non-Functional Requirements

- **Idempotency**: All CREATE TABLE statements MUST use IF NOT EXISTS for safe re-runs
- **FK integrity**: All foreign keys MUST be strict (no ON DELETE SET NULL) except as noted
- **Constraint enforcement**: CHECK constraints MUST reject invalid values at database level
- **CBM automation**: Business logic is implemented via `BEFORE INSERT FOR EACH ROW` trigger on `meter_readings` with `SECURITY DEFINER SET search_path = public`
- **Anti-spam**: Critical threshold alerts MUST deduplicate by `asset_id + meter_id` while an open CBM work order exists (`lifecycle_phase IN ('WAPPR', 'APPROVED', 'INPRG')`)

## Acceptance Criteria

- [ ] `job_plans`, `job_plan_tasks`, `job_plan_materials` created with FK chain to each other and `spare_parts`
- [ ] `pm_schedules` created with FK to `assets(id)`, `job_plans(id)`, and nullable self-FK for suppression
- [ ] `meters`, `measure_points`, `meter_readings` created with FK chain to `assets(id)`
- [ ] CHECK constraints reject negative planned_qty, invalid intervention_type, and invalid meter_type
- [ ] UNIQUE(job_plan_id, step_sequence) enforced on job_plan_tasks
- [ ] RLS enabled on all 7 tables — ADMIN/PLANNER full r/w, TECHNICIAN restricted
- [ ] Migration idempotent — safe to run repeatedly
- [ ] `work_orders.meter_id` column added (nullable FK → meters(id)) for CBM tracing
- [ ] `trg_meter_reading_cbm` trigger installed on `meter_readings` — evaluates 4-quadrant thresholds
- [ ] Warning threshold → `is_alert_triggered = true`, no work order created
- [ ] Critical threshold → work order generated with `wo_type = 'CBM'`, `lifecycle_phase = 'WAPPR'`
- [ ] Anti-spam deduplication: same asset + meter with open WO suppresses duplicate
- [ ] CBM trigger tested on production — 4/4 pgTAP tests passing
