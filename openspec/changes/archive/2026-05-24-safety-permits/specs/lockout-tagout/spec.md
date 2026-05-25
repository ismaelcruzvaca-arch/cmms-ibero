# Lockout/Tagout — Specification

## Purpose

Define the Lockout/Tagout (LOTO) system for energy isolation. Tracks isolation procedures from planning through verified removal, linked to permits or work orders.

## Requirements

### Requirement: lockout_tagout Table with FSM

One isolation procedure with 4-state FSM enforced by BEFORE UPDATE trigger.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_permit_id | UUID | FK → work_permits(id) |
| work_order_id | UUID | FK → work_orders(id) |
| asset_id | UUID | FK → assets(id) |
| loto_status | loto_status | NOT NULL DEFAULT 'PLANNED' |
| description | TEXT | NOT NULL |
| locked_by | UUID | FK → user_profiles(id) |
| locked_at | TIMESTAMPTZ | |
| verified_by | UUID | FK → user_profiles(id) |
| verified_at | TIMESTAMPTZ | CHECK (≥ locked_at) |
| removed_by | UUID | FK → user_profiles(id) |
| removed_at | TIMESTAMPTZ | CHECK (≥ verified_at) |
| created_at / updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**FSM**: `PLANNED → LOCKED → VERIFIED → REMOVED`. Forward-only. Trigger must reject skips (e.g., LOCKED→REMOVED). Two-person rule: verified_by != locked_by required at VERIFIED transition.

#### Scenario: Full LOTO lifecycle

- GIVEN SAFETY_OFFICER
- WHEN INSERT with loto_status PLANNED
- THEN row created
- AND UPDATE through LOCKED → VERIFIED → REMOVED succeeds
- AND backward transitions raise error

#### Scenario: Skip verification rejected

- GIVEN LOTO at status LOCKED
- WHEN UPDATE to REMOVED
- THEN trigger raises exception
- AND procedure stays LOCKED

#### Scenario: Two-person rule

- GIVEN LOTO locked by user A
- WHEN user A tries to self-verify (verified_by = locked_by)
- THEN trigger rejects the transition
- AND a different user must verify

### Requirement: tagout_devices Table

Physical devices used in a LOTO procedure.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| lockout_tagout_id | UUID | NOT NULL, FK → lockout_tagout(id) ON DELETE CASCADE |
| device_type | device_type | NOT NULL |
| device_id | TEXT | NOT NULL |
| device_label | TEXT | |

ENUM device_type: LOCK, TAG, HASPS, CHAIN.

#### Scenario: Devices cascade on delete

- GIVEN LOTO with 3 devices
- WHEN procedure deleted
- THEN all devices cascade-deleted

#### Scenario: ENUM validation

- GIVEN INSERT with device_type = 'KEY'
- WHEN inserting
- THEN ENUM rejects the value

### Requirement: RLS Policies

| Role | lockout_tagout | tagout_devices |
|------|---------------|----------------|
| ADMIN/SAFETY_OFFICER | ALL | ALL |
| PLANNER | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE |
| TECHNICIAN | SELECT | SELECT |

Policies use `get_user_role()`.

#### Scenario: PLANNER creates but cannot delete

- GIVEN PLANNER role
- WHEN INSERT into lockout_tagout
- THEN row created
- AND DELETE rejected by RLS

### Requirement: Audit

Both tables MUST have `audit_trigger_func()` via BEFORE UPDATE trigger.
