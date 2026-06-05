# Job Plan Safety Specification

## Purpose

Safety requirement catalog linked to job plans. Defines permits (PTW), LOTO procedures, hot work authorizations, confined space entries, heights work, and specialized PPE requirements that must be fulfilled before executing a job plan.

## Requirements

### Requirement: job_plan_safety Table

The system MUST create a `job_plan_safety` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| safety_type | TEXT | NOT NULL, CHECK (IN: 'PTW','LOTO','HOT_WORK','CONFINED_SPACE','HEIGHTS','EPP_ESPECIALIZADO','OTRO') |
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

### Requirement: Safety Copied to Work Order

When a WO is generated from a job plan, the system MUST clone all `job_plan_safety` rows into `work_order_safety_requirements`.

#### Scenario: WO generation clones safety

- GIVEN a job plan with PTW and LOTO safety requirements
- WHEN `generate_due_preventive_work_orders()` creates a WO from this plan
- THEN the WO SHALL have corresponding PTW and LOTO rows in `work_order_safety_requirements` with the same safety_type, description, and is_mandatory

### Requirement: Block A Checklist per Safety Type

The system MAY configure a Block A checklist template per safety_type. When a WO is generated with a given safety requirement, the corresponding Block A checklist SHALL be instantiated in PENDING status if a mapping exists.

#### Scenario: Block A checklist instantiated for LOTO

- GIVEN a checklist_template exists with module-level safety_type='LOTO'
- WHEN a WO is generated from a job plan that has a LOTO safety requirement
- THEN a checklist_instance SHALL be created in PENDING status, linked to the WO

### Requirement: RLS — job_plan_safety

The system MUST enable RLS on `job_plan_safety` with the same matrix as `job_plan_labor`: TECHNICIAN=SELECT, PLANNER=SELECT+INSERT+UPDATE, ADMIN=ALL.

#### Scenario: TECHNICIAN read-only

- GIVEN a user with role TECHNICIAN
- WHEN SELECTing from job_plan_safety
- THEN rows are returned
- WHEN attempting INSERT
- THEN the RLS policy rejects the operation

#### Scenario: ADMIN full access

- GIVEN a user with role ADMIN
- WHEN performing any DML on job_plan_safety
- THEN the operation succeeds
