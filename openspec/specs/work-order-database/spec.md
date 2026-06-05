# Work Order Database — ISO 14224 Specification

## Purpose

Define the database-layer schema for `work_orders` aligned with ISO 14224 failure taxonomy, event-driven lifecycle management, and generic immutable audit trail. This spec replaces the previous v1/v2 schema, FSM with `status` field, and `work_order_status_history` audit table.

**Scope**: Database layer ONLY (PostgreSQL + Triggers). Zero UI changes.

---

## Requirements

### Requirement: ENUMs

The system MUST create two PostgreSQL ENUM types:

| ENUM | Values |
|------|--------|
| `lifecycle_phase` | `WAPPR`, `APPROVED`, `INPRG`, `COMP`, `CLOSED` |
| `block_reason` | `NONE`, `MATERIAL`, `PLANT_CONDITION`, `SCHEDULE` |

`lifecycle_phase` controls the work order finite state machine. `block_reason` captures why a work order is on hold.

### Requirement: work_orders Table (ISO 14224)

The system MUST create a `work_orders` table (replacing the previous schema entirely) with the following columns:

#### Identity & Reference

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| asset_id | UUID | FK to `assets(id)` |
| equipment_id | VARCHAR | NOT NULL, denormalized read-only |
| wo_type | TEXT | NOT NULL DEFAULT 'corrective' |

#### Lifecycle

| Column | Type | Constraints |
|--------|------|-------------|
| lifecycle_phase | lifecycle_phase | NOT NULL DEFAULT 'WAPPR' |
| block_reason | block_reason | NOT NULL DEFAULT 'NONE' |

#### Event Timestamps (all TIMESTAMPTZ, nullable)

reported_at, approved_at, planned_start_at, actual_start_at, completed_at, closed_at, machine_down_at, machine_up_at

#### ISO 14224 Failure Taxonomy (all VARCHAR, nullable)

| Column | Description |
|--------|-------------|
| failure_class | High-level failure category |
| problem_code | Observed problem code |
| cause_code | Root cause code |
| remedy_code | Applied remedy code |

#### Operational Context (all VARCHAR, nullable)

| Column | Description |
|--------|-------------|
| criticality | Asset criticality classification |
| asset_class | Asset class or category |
| part_in_process | Part or sub-process involved |

#### Structured Notes (all TEXT, nullable)

| Column | Description |
|--------|-------------|
| symptom_note | Observed symptom description |
| cause_note | Root cause description |
| action_note | Action taken description |

#### Metadata

| Column | Type | Constraints |
|--------|------|-------------|
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| created_by | UUID | Nullable, references auth.users |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |
| is_auditable | BOOLEAN | NOT NULL DEFAULT false |
| audit_reason | TEXT | Nullable |

**REMOVED columns** (no longer exist in the schema): `status`, `description`, `actual_hours`, `cost_estimate`, `actual_cost`, `percentage_complete`, `_conflict`, `_deleted`.

#### Scenario: Work order created with WAPPR lifecycle

- GIVEN a valid authenticated request
- WHEN a work order is INSERTed
- THEN lifecycle_phase SHALL default to `'WAPPR'`
- AND block_reason SHALL default to `'NONE'`
- AND created_at and updated_at SHALL be set

#### Scenario: Machine downtime captured

- GIVEN a work order in lifecycle_phase `INPRG`
- WHEN machine_down_at is set
- THEN the update SHALL succeed
- AND downtime calculation SHALL be possible via `machine_up_at - machine_down_at`

#### Scenario: Structured notes populated

- GIVEN a valid authenticated request with symptom text
- WHEN `symptom_note` is set to a non-empty string
- THEN the value SHALL persist without truncation

### Requirement: Lifecycle FSM

The system MUST enforce a finite state machine on `lifecycle_phase` via a BEFORE UPDATE trigger. The FSM SHALL enforce strictly linear forward-only transitions:

```
WAPPR → APPROVED → INPRG → COMP → CLOSED
```

**Transition rules:**
1. Only forward transitions are allowed (no backward moves).
2. No skips are allowed (e.g., WAPPR → INPRG is invalid).
3. Identity transitions (same → same) MUST be allowed and MUST NOT raise an error.
4. Terminal state (`CLOSED`) MUST reject any further phase changes.
5. The trigger MUST use `OLD.lifecycle_phase` and `NEW.lifecycle_phase` for validation.

#### Scenario: Lifecycle transition APPROVED → INPRG

- GIVEN a work order with lifecycle_phase = `APPROVED`
- WHEN a TECHNICIAN sets lifecycle_phase to `INPRG` and actual_start_at to NOW()
- THEN the update SHALL succeed
- AND the FSM trigger SHALL allow the transition

#### Scenario: Lifecycle transition COMP → WAPPR (invalid)

- GIVEN a work order with lifecycle_phase = `COMP`
- WHEN a user attempts to set lifecycle_phase to `WAPPR`
- THEN the FSM trigger SHALL raise an exception and roll back the update

### Requirement: Audit Trail

The system MUST create a generic, immutable audit trail table and trigger function.

#### audit_logs Table

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| table_name | TEXT | NOT NULL |
| record_id | UUID | NOT NULL |
| action | TEXT | NOT NULL, CHECK (action IN ('INSERT','UPDATE','DELETE')) |
| old_data | JSONB | Nullable |
| new_data | JSONB | Nullable |
| changed_by | UUID | FK to auth.users |
| changed_at | TIMESTAMPTZ | DEFAULT NOW() |

#### Generic audit_trigger_func()

The function MUST be generic — using `TG_TABLE_NAME`, `OLD`, and `NEW` — NOT hardcoded to any specific table. This allows applying audit to any future table by simply creating a trigger.

The trigger on `work_orders` MUST capture INSERT, UPDATE, and DELETE operations.

**RLS on audit_logs:**
- INSERT is allowed only via SECURITY DEFINER trigger (not direct user INSERT)
- SELECT is allowed for ADMIN only
- No UPDATE or DELETE policies exist (table is append-only)

#### Scenario: UPDATE captured in audit_logs

- GIVEN a work order with lifecycle_phase `WAPPR`
- WHEN a TECHNICIAN updates lifecycle_phase to `INPRG`
- THEN a row SHALL be inserted into `audit_logs` with action `UPDATE`, old_data containing the previous row, new_data containing the current row, and changed_by set to the TECHNICIAN's UUID

#### Scenario: DELETE captured in audit_logs

- GIVEN an existing work order
- WHEN an ADMIN deletes it
- THEN a row SHALL be inserted into `audit_logs` with action `DELETE`, old_data containing the deleted row, and new_data set to NULL

#### Scenario: Generic trigger reused

- GIVEN a future table `inspections`
- WHEN the generic `audit_trigger()` is applied to `inspections`
- THEN INSERT, UPDATE, DELETE on `inspections` SHALL produce audit_logs rows without code changes

---

## Non-Functional Requirements

- **Data integrity**: FSM enforcement MUST happen at the database level (trigger), not just in application code.
- **Audit immutability**: `audit_logs` rows MUST be insert-only. No UPDATE or DELETE operations permitted.
- **Extensibility**: The `audit_trigger_func()` MUST be generic and reusable across any table without code changes.
- **Schema clarity**: The destructive migration (DROP + CREATE) is intentional — backward-incompatible by design.

---

## Data Model Summary

```
work_orders
├── id UUID PK
├── asset_id UUID FK → assets(id)
├── equipment_id VARCHAR
├── wo_type TEXT
├── lifecycle_phase lifecycle_phase ENUM
├── block_reason block_reason ENUM
├── [8 timestamps] TIMESTAMPTZ
├── [4 failure taxonomy codes] VARCHAR
├── [3 operational context fields] VARCHAR
├── [3 structured notes] TEXT
├── created_at / created_by / updated_at
├── is_auditable BOOLEAN
└── audit_reason TEXT

audit_logs
├── id UUID PK
├── table_name TEXT
├── record_id UUID
├── action TEXT (INSERT|UPDATE|DELETE)
├── old_data JSONB
├── new_data JSONB
├── changed_by UUID FK
└── changed_at TIMESTAMPTZ
```

---

## Migration Strategy

The migration uses a destructive approach (Opción A) in two sequential Supabase migrations:

1. **Migration 1** (`rbac_audit`): ENUMs, `user_profiles`, `audit_logs`, generic `audit_trigger_func()`, `get_user_role()` helper, base RLS.
2. **Migration 2** (`work_orders_iso14224`): DROP old `work_orders` CASCADE, CREATE new ISO 14224 table, FSM trigger, re-attach audit trigger, RLS policies.

---

## Acceptance Criteria

- [ ] `lifecycle_phase` ENUM `('WAPPR','APPROVED','INPRG','COMP','CLOSED')` created and applied
- [ ] `block_reason` ENUM `('NONE','MATERIAL','PLANT_CONDITION','SCHEDULE')` created and applied
- [ ] `work_orders` table has all ISO 14224 columns (no legacy columns like `status`, `description`, etc.)
- [ ] FSM trigger enforces linear transitions: WAPPR → APPROVED → INPRG → COMP → CLOSED (no skips, no backward moves)
- [ ] All 8 timestamps are TIMESTAMPTZ, nullable
- [ ] `audit_logs` table exists with generic trigger function
- [ ] `audit_trigger_func()` is generic — uses TG_TABLE_NAME, OLD, NEW
- [ ] Trigger `work_orders_audit` is installed on work_orders for INSERT/UPDATE/DELETE
- [ ] Audit rows are immutable — no UPDATE or DELETE policies on audit_logs
- [ ] RLS on `audit_logs` allows INSERT via trigger (not user), SELECT for ADMIN only
