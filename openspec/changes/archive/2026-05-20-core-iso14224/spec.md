# Spec — Core: Security, Audit & ISO 14224 Schema

## REQ-1: RBAC (Auth & Roles)

### Requirement

The system MUST create a `user_profiles` table synced from `auth.users` via a database trigger. Four roles SHALL be supported: `ADMIN`, `PLANNER`, `TECHNICIAN`, `STOREKEEPER`. RLS policies MUST enforce role-based access on `work_orders` and `assets`.

| Role | work_orders | assets |
|------|-------------|--------|
| ADMIN | CRUD | CRUD |
| PLANNER | CRUD | SELECT |
| TECHNICIAN | UPDATE (lifecycle_phase, action_note, timestamps) | SELECT |
| STOREKEEPER | SELECT | SELECT |

#### Scenario: ADMIN creates a work order

- GIVEN an authenticated user with role `ADMIN`
- WHEN they INSERT into `work_orders`
- THEN the row is created successfully

#### Scenario: TECHNICIAN attempts to delete a work order

- GIVEN an authenticated user with role `TECHNICIAN`
- WHEN they attempt to DELETE a work order
- THEN the RLS policy rejects the operation

#### Scenario: Unauthenticated request

- GIVEN a request with no valid session
- WHEN it queries `work_orders`
- THEN RLS returns zero rows

#### Scenario: user_profiles synced on auth.users INSERT

- GIVEN a new user signs up via Supabase Auth
- WHEN a row is inserted into `auth.users`
- THEN a corresponding row SHALL appear in `user_profiles` with role `TECHNICIAN` (default)

#### Acceptance Criteria

- [ ] `user_profiles` table exists with columns: `id` (UUID PK, FK to auth.users), `role` (TEXT), `created_at`, `updated_at`
- [ ] Trigger on `auth.users` INSERT auto-creates profile with default role
- [ ] RLS policies on `work_orders` enforce row-level access per role matrix above
- [ ] RLS policies on `assets` enforce row-level access per role matrix above
- [ ] ADMIN can bypass all restrictions

---

## REQ-2: Audit Trail

### Requirement

The system MUST create an `audit_logs` table and a generic `audit_trigger()` function. A trigger on `work_orders` MUST capture INSERT, UPDATE, and DELETE operations.

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

#### Acceptance Criteria

- [ ] `audit_logs` table exists with the schema above
- [ ] RLS on `audit_logs` allows INSERT via trigger (not user), SELECT for ADMIN only
- [ ] `audit_trigger()` function is generic — references TG_TABLE_NAME, OLD, NEW — not hardcoded to work_orders
- [ ] Trigger `work_orders_audit` is installed on work_orders for INSERT/UPDATE/DELETE
- [ ] Audit rows are immutable — no UPDATE or DELETE policies on audit_logs

---

## REQ-3: work_orders ISO 14224

### Requirement

The system MUST replace the existing `work_orders` schema with an ISO 14224–aligned schema. The following changes SHALL be applied:

**REMOVED columns:** `status`, `description`, `actual_hours`, `cost_estimate`, `actual_cost`, `percentage_complete`, `_conflict`, `_deleted`

**ADDED columns:** `lifecycle_phase` (ENUM), `block_reason` (ENUM), timestamps (`reported_at`, `approved_at`, `planned_start_at`, `actual_start_at`, `completed_at`, `closed_at`, `machine_down_at`, `machine_up_at`), failure taxonomy (`failure_class`, `problem_code`, `cause_code`, `remedy_code`), operational context (`criticality`, `asset_class`, `part_in_process`), structured notes (`symptom_note`, `cause_note`, `action_note`).

| Field | Type | Notes |
|-------|------|-------|
| lifecycle_phase | ENUM | `WAPPR`, `APPROVED`, `INPRG`, `COMP`, `CLOSED` |
| block_reason | ENUM | `NONE`, `MATERIAL`, `PLANT_CONDITION`, `SCHEDULE` |
| failure_class / problem_code / cause_code / remedy_code | VARCHAR | ISO 14224 taxonomy codes |
| criticality / asset_class / part_in_process | VARCHAR | Operational context |
| symptom_note / cause_note / action_note | TEXT | Structured notes |

#### Scenario: Work order lifecycle transition APPROVED → INPRG

- GIVEN a work order with lifecycle_phase = `APPROVED`
- WHEN a TECHNICIAN sets lifecycle_phase to `INPRG` and actual_start_at to NOW()
- THEN the update SHALL succeed
- AND the FSM trigger SHALL allow the transition

#### Scenario: Work order lifecycle transition COMP → WAPPR (invalid)

- GIVEN a work order with lifecycle_phase = `COMP`
- WHEN a user attempts to set lifecycle_phase to `WAPPR`
- THEN the FSM trigger SHALL raise an exception and roll back the update

#### Scenario: Machine downtime captured

- GIVEN a work order in lifecycle_phase `INPRG`
- WHEN machine_down_at is set
- THEN the update SHALL succeed
- AND downtime calculation SHALL be possible via `machine_up_at - machine_down_at`

#### Scenario: Structured notes populated

- GIVEN a valid authenticated request with symptom text
- WHEN `symptom_note` is set to a non-empty string
- THEN the value SHALL persist without truncation

#### Acceptance Criteria

- [ ] `lifecycle_phase` ENUM `('WAPPR','APPROVED','INPRG','COMP','CLOSED')` created and applied
- [ ] `block_reason` ENUM `('NONE','MATERIAL','PLANT_CONDITION','SCHEDULE')` created and applied
- [ ] FSM trigger enforces linear transitions: WAPPR → APPROVED → INPRG → COMP → CLOSED (no skips, no backward moves)
- [ ] All 8 timestamps are TIMESTAMPTZ, nullable
- [ ] Old columns (`status`, `description`, `actual_hours`, etc.) are removed
- [ ] `audit_trigger()` from REQ-2 captures changes (not the old status_history trigger)

---

## REQ-4: Edge Function oee-trigger

### Requirement

The system MUST update the `oee-trigger` Edge Function to insert work orders matching the ISO 14224 schema. The function SHALL set `lifecycle_phase` to `'WAPPR'`, `block_reason` to `'NONE'`, and map the `sintoma` payload field to `symptom_note` (instead of embedding in `description`).

#### Scenario: Valid OEE trigger creates compliant work order

- GIVEN a valid authenticated request with `equipment_id` and `sintoma: "Vibración anormal en motor"`
- WHEN the Edge Function processes the request
- THEN a work order SHALL be created with lifecycle_phase = `'WAPPR'`
- AND block_reason = `'NONE'`
- AND symptom_note = `"Vibración anormal en motor"`
- AND description SHALL NOT be set (column removed)

#### Scenario: OEE trigger with missing sintoma

- GIVEN a valid authenticated request with `equipment_id` but empty `sintoma`
- WHEN the Edge Function processes the request
- THEN it SHALL respond with HTTP 400 (sintoma is required for symptom_note)

#### Acceptance Criteria

- [ ] Edge Function inserts lifecycle_phase = 'WAPPR', block_reason = 'NONE'
- [ ] `sintoma` maps to `symptom_note`, not `description`
- [ ] `description` field is absent from the INSERT (column no longer exists)
- [ ] Existing auth, validation, and asset resolution behavior from oee-webhook spec is preserved

---

## Summary of Changes vs Existing Specs

| Domain | Status | Existing Spec |
|--------|--------|---------------|
| RBAC (Auth & Roles) | **NEW** | None |
| Audit Trail | **NEW** — supersedes `work_order_status_history` from work-order-database | `work-order-database` |
| work_orders ISO 14224 | **MODIFIED** — replaces schema, FSM, and notes | `work-order-database` |
| oee-trigger | **MODIFIED** — aligns with new schema | `oee-webhook` |
