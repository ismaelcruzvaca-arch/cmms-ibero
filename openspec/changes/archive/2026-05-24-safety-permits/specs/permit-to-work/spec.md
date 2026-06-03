# Permit to Work — Specification

## Purpose

Define the Permit to Work (PTW) system for hazardous work control. Manages permit requests, approval, activation, and closure with isolation and gas test tracking.

## Requirements

### Requirement: permit_types Table

Seeded catalog of permit categories.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | NOT NULL, UNIQUE |
| name | TEXT | NOT NULL |
| requires_isolation | BOOLEAN | NOT NULL DEFAULT false |
| requires_gas_test | BOOLEAN | NOT NULL DEFAULT false |
| validity_hours | INTEGER | NOT NULL, CHECK (> 0) |

Seeds: HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION.

#### Scenario: Types seeded on migration

- GIVEN migration has run
- WHEN querying permit_types
- THEN 7 rows exist with correct code values

### Requirement: work_permits Table with FSM

Core permit record with 7-state FSM enforced by BEFORE UPDATE trigger.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| permit_type_id | UUID | NOT NULL, FK → permit_types(id) |
| work_order_id | UUID | FK → work_orders(id) |
| asset_id | UUID | FK → assets(id) |
| permit_status | permit_status | NOT NULL DEFAULT 'REQUESTED' |
| requested_by | UUID | FK → user_profiles(id) |
| approved_by | UUID | FK → user_profiles(id) |
| issued_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | CHECK (> issued_at) |
| completed_at | TIMESTAMPTZ | |
| isolation_required | BOOLEAN | NOT NULL DEFAULT false |
| gas_test_required | BOOLEAN | NOT NULL DEFAULT false |
| gas_test_result | TEXT | CHECK (IN ('PASS','FAIL',NULL)) |
| description | TEXT | NOT NULL |
| location | TEXT | |
| created_at / updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**FSM**: `REQUESTED → APPROVED → ACTIVE → COMPLETED`. Also: REQUESTED→CANCELLED|REJECTED, APPROVED→CANCELLED|EXPIRED, ACTIVE→EXPIRED. Trigger rejects invalid transitions and auto-expires ACTIVE permits past expires_at.

#### Scenario: Full lifecycle

- GIVEN SAFETY_OFFICER and valid work_order
- WHEN INSERT with status REQUESTED
- THEN row created
- AND UPDATE through APPROVED → ACTIVE → COMPLETED succeeds
- AND backward transitions raise error

#### Scenario: Gas test blocks activation

- GIVEN permit with gas_test_required=true, gas_test_result=NULL
- WHEN UPDATE to ACTIVE
- THEN trigger raises exception
- AND permit stays APPROVED until gas_test_result='PASS'

#### Scenario: Auto-expiry

- GIVEN ACTIVE permit with expires_at < NOW()
- WHEN any column updated
- THEN trigger sets permit_status = 'EXPIRED'

### Requirement: permit_tasks Table

Tasks and precautions under each permit.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_permit_id | UUID | NOT NULL, FK → work_permits(id) ON DELETE CASCADE |
| step_sequence | INTEGER | NOT NULL, CHECK (> 0) |
| task_description | TEXT | NOT NULL |
| is_precaution | BOOLEAN | NOT NULL DEFAULT false |
| completed | BOOLEAN | NOT NULL DEFAULT false |

#### Scenario: Cascade on delete

- GIVEN permit with 3 tasks
- WHEN permit deleted
- THEN all tasks cascade-deleted

### Requirement: RLS Policies

| Role | permit_types | work_permits | permit_tasks |
|------|-------------|--------------|--------------|
| ADMIN/SAFETY_OFFICER | ALL | ALL | ALL |
| PLANNER | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| TECHNICIAN | SELECT | SELECT | SELECT |

Policies use `get_user_role()`.

#### Scenario: TECHNICIAN read-only

- GIVEN TECHNICIAN role
- WHEN SELECT from work_permits
- THEN rows returned
- BUT INSERT/UPDATE/DELETE rejected by RLS

### Requirement: Audit

All tables MUST have `audit_trigger_func()` attached via BEFORE UPDATE trigger.
