# Spec: Structured Job Plans (job-plan-structured)

## Purpose

Expand `job_plans` from basic template (code, description, hours) to Maximo/SAP-level structured plans with labor requirements by trade, safety requirements (permits/LOTO/PPE), snapshot tables for generated WOs, and supporting columns across related tables.

## Capabilities

- **job-plan-labor**: Trade-based labor estimation with headcount and planned hours per job plan
- **job-plan-safety**: Safety requirement catalog (permits, LOTO, PPE) linked to job plans

## Requirements

### R1: job_plan_labor Table

The system MUST create a `job_plan_labor` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| trade | trade_enum | NOT NULL (ELECTRICIAN, MECHANIC, INSTRUMENTIST, LUBRICATOR, HELPER, WELDER, OPERATOR) |
| estimated_hours | NUMERIC | NOT NULL, CHECK (> 0) |
| head_count | INT | DEFAULT 1, CHECK (> 0) |
| hourly_rate | NUMERIC | DEFAULT 0 |
| | | UNIQUE(job_plan_id, trade) |

#### Scenario: Planner adds labor requirement

- GIVEN a job plan exists
- WHEN a planner inserts a labor row with trade='ELECTRICIAN', estimated_hours=4, head_count=2
- THEN the row is persisted linked to the job plan

#### Scenario: Same trade on same plan rejected

- GIVEN a job plan with trade='MECHANIC' already exists
- WHEN inserting another row with the same job_plan_id and trade='MECHANIC'
- THEN the INSERT MUST fail with unique constraint violation

#### Scenario: Multiple trades on same plan

- GIVEN a job plan exists
- WHEN inserting labor rows for ELECTRICIAN (2h), MECHANIC (1h), and HELPER (2h)
- THEN all three rows are persisted with their respective hours and headcounts

#### Scenario: Zero hours rejected

- GIVEN a job plan exists
- WHEN inserting a labor row with estimated_hours = 0
- THEN the INSERT MUST fail with CHECK constraint violation

### R2: job_plan_safety Table

The system MUST create a `job_plan_safety` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| safety_type | safety_type_enum | NOT NULL (PTW, LOTO, HOT_WORK, CONFINED_SPACE, HEIGHTS, EPP_ESPECIALIZADO, OTRO) |
| description | TEXT | nullable |
| is_mandatory | BOOLEAN | DEFAULT true |
| | | UNIQUE(job_plan_id, safety_type) |

#### Scenario: Planner adds safety requirement

- GIVEN a job plan exists
- WHEN a planner inserts a safety row with safety_type='LOTO' and description='Lockout main breaker panel'
- THEN the row is persisted linked to the job plan with is_mandatory=true

#### Scenario: Duplicate safety_type on same plan rejected

- GIVEN a job plan with safety_type='PTW' exists
- WHEN inserting another row with the same job_plan_id and safety_type='PTW'
- THEN the INSERT MUST fail with unique constraint violation

#### Scenario: Multiple safety types on same plan

- GIVEN a job plan exists
- WHEN inserting safety rows for PTW, LOTO, and HEIGHTS
- THEN all three rows are persisted

#### Scenario: Invalid safety_type rejected

- GIVEN a job plan exists
- WHEN inserting a safety row with safety_type='FIRE_EXTINGUISHER'
- THEN the INSERT MUST fail with CHECK constraint violation

### R3: job_plans — New Columns

The system MUST ADD three columns to `job_plans`:

| Column | Type | Constraints |
|--------|------|-------------|
| asset_type_id | TEXT | nullable, FK → asset_types(id) |
| is_active | BOOLEAN | DEFAULT true |
| updated_at | TIMESTAMPTZ | nullable, set by BEFORE UPDATE trigger |

#### Scenario: Asset type filtering

- GIVEN job plans with asset_type_id='PUMP' and asset_type_id=NULL (generic)
- WHEN querying plans applicable to a 'PUMP' asset
- THEN both the type-specific plan (asset_type_id='PUMP') and generic plans (asset_type_id=NULL) are returned

#### Scenario: New plan defaults to active

- GIVEN a new job plan is created
- WHEN no is_active value is specified
- THEN is_active SHALL default to true

#### Scenario: Updated_at set on update

- GIVEN a job plan exists
- WHEN a planner updates any column
- THEN updated_at SHALL be set to the current timestamp

### R4: checklist_templates.job_plan_task_id

The system MUST ADD a nullable `job_plan_task_id` column to `checklist_templates`:

| Column | Type | Constraints |
|--------|------|-------------|
| job_plan_task_id | UUID | nullable, FK → job_plan_tasks(id) ON DELETE SET NULL |

#### Scenario: Task-level checklist link

- GIVEN a job plan with task T1
- WHEN a checklist_template is inserted with job_plan_task_id = T1's UUID
- THEN the checklist is linked to that specific task, not the entire plan

#### Scenario: NULL means plan-level (backward compat)

- GIVEN existing checklist_templates with job_plan_task_id = NULL
- WHEN querying checklists for a job plan
- THEN NULL-valued templates apply to the entire plan (unchanged behavior)

### R5: work_orders — Estimated Cost Columns

The system MUST ADD three columns to `work_orders`:

| Column | Type | Constraints |
|--------|------|-------------|
| estimated_hours | NUMERIC | DEFAULT 0 |
| estimated_parts_cost | NUMERIC | DEFAULT 0 |
| estimated_labor_cost | NUMERIC | DEFAULT 0 |

#### Scenario: WO generation computes costs

- GIVEN a job plan with labor (MECHANIC 2h × 1, ELECTRICIAN 1h × 1) and materials (2 × bearing @ $15.50, 1 × seal @ $45.00)
- WHEN `generate_due_preventive_work_orders()` creates a WO
- THEN estimated_hours = 3, estimated_parts_cost = $76.00, estimated_labor_cost = SUM(hours × rate)

### R6: checklist_instances — PENDING Status

The system MUST ADD `'PENDING'` to the checklist_instances status CHECK constraint alongside existing values (`IN_PROGRESS`, `COMPLETED`, `VOID`).

#### Scenario: PM-generated checklist starts PENDING

- GIVEN a WO is generated from a PM schedule with associated checklist templates
- WHEN the WO is created
- THEN checklist_instances SHALL be created with status='PENDING' (no technician assigned yet)

### R7: spare_parts.unit_cost

The system MUST ADD a `unit_cost` column to `spare_parts`:

| Column | Type | Constraints |
|--------|------|-------------|
| unit_cost | NUMERIC | DEFAULT 0 |

#### Scenario: Parts cost estimation

- GIVEN a spare part with unit_cost=$15.50
- WHEN `generate_due_preventive_work_orders()` computes estimated_parts_cost
- THEN the calculation SHALL use spare_parts.unit_cost as the per-unit price

### R8: work_order_labor_estimates (Snapshot Table)

The system MUST create a snapshot table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_order_id | TEXT | NOT NULL, FK → work_orders(id) |
| job_plan_id | UUID | nullable, FK → job_plans(id) |
| trade | trade_enum | NOT NULL |
| estimated_hours | NUMERIC | NOT NULL |
| head_count | INT | DEFAULT 1 |
| hourly_rate | NUMERIC | DEFAULT 0 |
| | | UNIQUE(work_order_id, trade) |

#### Scenario: Labor frozen at WO creation

- GIVEN a job plan with labor rows (MECHANIC 2h, ELECTRICIAN 1h)
- WHEN a WO is generated and later the job plan labor is updated
- THEN `work_order_labor_estimates` SHALL retain the original values from WO creation time

### R9: work_order_safety_requirements (Snapshot Table)

The system MUST create a snapshot table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_order_id | TEXT | NOT NULL, FK → work_orders(id) |
| job_plan_id | UUID | nullable, FK → job_plans(id) |
| safety_type | safety_type_enum | NOT NULL |
| description | TEXT | nullable |
| is_mandatory | BOOLEAN | DEFAULT true |
| is_fulfilled | BOOLEAN | DEFAULT false |
| | | UNIQUE(work_order_id, safety_type) |

#### Scenario: Safety frozen at WO creation

- GIVEN a job plan with safety rows (LOTO, PTW)
- WHEN a WO is generated and later the job plan safety is updated
- THEN `work_order_safety_requirements` SHALL retain the original safety data from WO creation time

#### Scenario: Partial index covers unfulfilled queries

- GIVEN the partial index `idx_wosr_unfulfilled ON work_order_safety_requirements(is_fulfilled) WHERE is_fulfilled = false`
- WHEN querying unfulfilled safety requirements
- THEN the query SHALL use the partial index

### R10: RLS — All New Tables

The system MUST enable RLS on all four new tables with role-based policies:

| Table | TECHNICIAN | PLANNER | ADMIN |
|-------|-----------|---------|-------|
| job_plan_labor | SELECT | SELECT / INSERT / UPDATE | ALL |
| job_plan_safety | SELECT | SELECT / INSERT / UPDATE | ALL |
| work_order_labor_estimates | SELECT | SELECT / INSERT / UPDATE | ALL |
| work_order_safety_requirements | SELECT | SELECT / INSERT / UPDATE | ALL |

#### Scenario: TECHNICIAN read-only on job_plan_labor

- GIVEN a user with role TECHNICIAN
- WHEN SELECTing from job_plan_labor
- THEN rows are returned
- WHEN attempting INSERT, UPDATE, or DELETE
- THEN the RLS policy rejects the operation

#### Scenario: PLANNER full CRUD except DELETE on plan tables

- GIVEN a user with role PLANNER
- WHEN SELECT, INSERT, or UPDATE on job_plan_labor or job_plan_safety
- THEN the operation succeeds
- WHEN attempting DELETE
- THEN the RLS policy rejects the operation

#### Scenario: ADMIN full access

- GIVEN a user with role ADMIN
- WHEN performing any DML on all four tables
- THEN the operation succeeds

### R11: Clone labor + safety + checklists on WO Generation

The `generate_due_preventive_work_orders()` function MUST:
1. Clone `job_plan_labor` rows into `work_order_labor_estimates`
2. Clone `job_plan_safety` rows into `work_order_safety_requirements`
3. Instantiate matching `checklist_templates` into `checklist_instances` with status='PENDING'
4. Compute and set `estimated_hours`, `estimated_parts_cost`, `estimated_labor_cost` on the new WO
5. Advance `pm_schedules.next_target_date` and set `last_completion_date`

#### Scenario: Full WO generation lifecycle

- GIVEN a pm_schedule due today with a job plan that has labor, safety, materials, and checklist templates
- WHEN `generate_due_preventive_work_orders()` executes
- THEN a WO is created in WAPPR phase
- AND work_order_labor_estimates has cloned labor rows
- AND work_order_safety_requirements has cloned safety rows
- AND checklist_instances has PENDING instances
- AND estimated costs are computed from cloned data
- AND pm_schedule.next_target_date is advanced by the frequency interval

### R12: Audit Triggers

The system MUST create audit triggers on both snapshot tables:
- `work_order_labor_estimates_audit` (AFTER INSERT OR UPDATE OR DELETE)
- `work_order_safety_requirements_audit` (AFTER INSERT OR UPDATE OR DELETE)

### R13: updated_at Trigger on job_plans

The system MUST create a BEFORE UPDATE trigger `trg_job_plans_updated_at` on `job_plans` that sets `NEW.updated_at = NOW()`.
