# Delta for Preventive & Condition-Based Maintenance — Core Schema

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: job_plans Table

The system MUST create a `job_plans` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | UNIQUE NOT NULL |
| description | TEXT | nullable |
| intervention_type | TEXT | NOT NULL, CHECK (IN: 'INSPECTION','LUBRICATION','MINOR_SERVICE','OVERHAUL') |
| estimated_hours | NUMERIC | DEFAULT 0 |
| **asset_type_id** | **TEXT** | **nullable, FK → asset_types(id)** |
| **is_active** | **BOOLEAN** | **DEFAULT true** |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| **updated_at** | **TIMESTAMPTZ** | **nullable** |

(Previously: no asset_type_id, is_active, or updated_at columns)

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

### Requirement: RLS Access Control

The system MUST enable RLS on all 7 tables plus the new `job_plan_labor` and `job_plan_safety` tables. ADMIN and PLANNER SHALL have full read/write on `job_plan_labor` and `job_plan_safety` (PLANNER except DELETE). TECHNICIAN SHALL have SELECT only on `job_plan_labor` and `job_plan_safety`.

(Previously: only covered the original 7 tables — job_plans, job_plan_tasks, job_plan_materials, pm_schedules, meters, measure_points, meter_readings)

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
