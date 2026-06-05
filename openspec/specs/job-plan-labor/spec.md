# Job Plan Labor Specification

## Purpose

Trade-based labor estimation for job plans. Enables planners to define headcount and estimated hours by trade (ELECTRICIAN, MECHANIC, etc.) per job plan, and the system to compute estimated labor cost at WO generation time.

## Requirements

### Requirement: job_plan_labor Table

The system MUST create a `job_plan_labor` table:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| job_plan_id | UUID | NOT NULL, FK → job_plans(id) ON DELETE CASCADE |
| trade | TEXT | NOT NULL |
| estimated_hours | NUMERIC | NOT NULL, CHECK (> 0) |
| head_count | INT | DEFAULT 1 |
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

### Requirement: Estimated Labor Cost

The system SHOULD compute `estimated_labor_cost` as SUM(estimated_hours × head_count) per trade when generating work orders. The hourly_rate lookup SHALL be deferred to a future labor_records/craft_rate table; for v1, all trades SHALL use a single configurable default rate.

#### Scenario: WO generation computes labor cost

- GIVEN a job plan with 1 ELECTRICIAN × 2h × 1 head_count and 1 MECHANIC × 1h × 2 head_count
- WHEN a preventive WO is generated from this plan
- THEN work_order.estimated_labor_cost SHALL be set to (2 + 2) × default_rate

### Requirement: RLS — job_plan_labor

The system MUST enable RLS on `job_plan_labor`:

| Role | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| TECHNICIAN | ✅ | ❌ | ❌ | ❌ |
| PLANNER | ✅ | ✅ | ✅ | ❌ |
| ADMIN | ✅ | ✅ | ✅ | ✅ |

#### Scenario: TECHNICIAN selects but cannot insert

- GIVEN a user with role TECHNICIAN
- WHEN SELECTing from job_plan_labor
- THEN rows are returned
- WHEN attempting to INSERT
- THEN the RLS policy rejects the operation

#### Scenario: PLANNER full CRUD except DELETE

- GIVEN a user with role PLANNER
- WHEN SELECT, INSERT, or UPDATE on job_plan_labor
- THEN the operation succeeds
- WHEN attempting to DELETE
- THEN the RLS policy rejects the operation

#### Scenario: ADMIN full access

- GIVEN a user with role ADMIN
- WHEN performing any DML on job_plan_labor
- THEN the operation succeeds
