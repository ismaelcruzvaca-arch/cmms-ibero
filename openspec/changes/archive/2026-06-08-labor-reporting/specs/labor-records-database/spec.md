# Labor Records Database Specification

## Purpose

Persist clock-in/out sessions for mechanics working on work orders, with proper constraints, access control, FSM integration, and audit trails.

## Requirements

### R1: labor_records Table Schema

The system MUST provide a `labor_records` table with:
- `id` UUID PK (gen_random_uuid())
- `work_order_id` TEXT NOT NULL FK → work_orders.id
- `technician_id` UUID NOT NULL FK → user_profiles.id
- `start_time` TIMESTAMPTZ NOT NULL
- `end_time` TIMESTAMPTZ (nullable — NULL means session is active)
- `hours_worked` NUMERIC GENERATED ALWAYS AS (EXTRACT(EPOCH FROM COALESCE(end_time, NOW()) - start_time) / 3600) STORED
- `activity_code` TEXT NOT NULL
- `notes` TEXT
- `device_timestamp` TIMESTAMPTZ (for offline reconciliation)
- `created_at` TIMESTAMPTZ DEFAULT NOW()

#### Scenario: Insert valid labor record

- GIVEN a work order and technician exist
- WHEN a labor record is inserted with valid activity_code, work_order_id, and technician_id
- THEN the record is persisted with hours_worked auto-calculated

### R2: Activity Code Constraint

`activity_code` MUST have a CHECK constraint limiting values to: `'DIRECT_WORK'`, `'WAIT_MATERIAL'`, `'WAIT_PERMIT'`, `'TRAVEL'`, `'BREAK'`.

#### Scenario: Invalid activity code rejected

- GIVEN a labor record insert with activity_code 'INVALID'
- WHEN the insert is executed
- THEN it MUST fail with a CHECK constraint violation

### R3: Row-Level Security

The system MUST enforce RLS on `labor_records`:
- **TECHNICIAN**: SELECT, INSERT, UPDATE own records (technician_id = auth.uid())
- **PLANNER**: SELECT all records
- **ADMIN**: ALL operations on any record

#### Scenario: Technician sees only own records

- GIVEN two technicians with labor_records for different WOs
- WHEN technician A queries labor_records
- THEN only records WHERE technician_id = auth.uid() are returned

### R4: Defensive FSM Validation (Client-Driven)

The system MUST provide defensive database triggers. The client (RxDB) creates and closes labor_records — the server only VALIDATES.

- **trg_validate_labor_fsm()** (BEFORE INSERT OR UPDATE ON labor_records):
  - On INSERT with end_time=NULL (new active session): MUST verify work_order.lifecycle_phase = 'INPRG', otherwise RAISE EXCEPTION
  - On UPDATE: MUST verify technician ownership (technician_id matches auth.uid() for non-admin)
- **trg_labor_sum_hours()** (BEFORE UPDATE ON work_orders):
  - On COMP→CLOSED: MUST SUM all labor_records.hours_worked → work_orders.actual_hours
- NO auto-create triggers. The server does NOT create labor_records based on lifecycle transitions.

#### Scenario: Active session requires INPRG

- GIVEN a work order in WAPPR phase
- WHEN a labor_record is inserted with end_time=NULL (active session)
- THEN the insert MUST be rejected — only INPRG work orders can have active sessions

#### Scenario: Active session allowed in INPRG

- GIVEN a work order in INPRG phase
- WHEN a labor_record is inserted with end_time=NULL, activity_code='DIRECT_WORK'
- THEN the record is persisted

#### Scenario: Auto-sum on COMP→CLOSED

- GIVEN a work order in COMP phase with multiple labor_records
- WHEN lifecycle transitions to CLOSED
- THEN work_orders.actual_hours MUST equal SUM of all labor_records.hours_worked for that WO

### R5: Audit Trail

The table MUST have an `updated_at` trigger that sets `updated_at = NOW()` on row update.

#### Scenario: Update sets updated_at

- GIVEN an existing labor_record
- WHEN the record is updated (e.g., end_time set)
- THEN updated_at changes from its previous value
