# Tasks: Core — Security, Audit & ISO 14224 Schema

## Phase 1: Auth & RBAC

- [x] 1.1 Create `user_profiles` table (id UUID PK → auth.users, role TEXT DEFAULT 'TECHNICIAN', created_at, updated_at)
- [x] 1.2 Create `sync_user_profile()` trigger function and attach to `auth.users` INSERT
- [x] 1.3 Create `get_user_role()` helper function returning TEXT for RLS policies
- [x] 1.4 Enable RLS on `work_orders` — ADMIN/PLANNER CRUD, TECHNICIAN UPDATE limited fields, STOREKEEPER SELECT
- [x] 1.5 Enable RLS on `assets` — ADMIN CRUD, PLANNER/TECHNICIAN/STOREKEEPER SELECT

## Phase 2: Audit Trail

- [x] 2.1 Create `audit_logs` table (id UUID PK, table_name TEXT, record_id UUID, action TEXT CHECK, old_data JSONB, new_data JSONB, changed_by UUID, changed_at TIMESTAMPTZ)
- [x] 2.2 Create generic `audit_trigger_func()` using TG_TABLE_NAME, OLD, NEW
- [x] 2.3 Attach `work_orders_audit` trigger (AFTER INSERT/UPDATE/DELETE) on work_orders
- [x] 2.4 Enable RLS on `audit_logs` — INSERT via SECURITY DEFINER trigger, SELECT for ADMIN only

## Phase 3: work_orders ISO 14224

- [x] 3.1 Create ENUMs: `lifecycle_phase` ('WAPPR','APPROVED','INPRG','COMP','CLOSED'), `block_reason` ('NONE','MATERIAL','PLANT_CONDITION','SCHEDULE')
- [x] 3.2 DROP old `work_orders` CASCADE and CREATE new table with ISO 14224 columns (lifecycle_phase, block_reason, 8 timestamps, failure taxonomy, operational context, structured notes)
- [x] 3.3 Create `validate_lifecycle_fsm()` BEFORE UPDATE trigger enforcing linear forward-only transitions (WAPPR→APPROVED→INPRG→COMP→CLOSED)
- [x] 3.4 Re-attach `work_orders_audit` trigger on new work_orders (dropped by CASCADE)
- [x] 3.5 Enable RLS on new `work_orders` and verify all Phase 1 policies apply correctly

## Phase 4: Edge Function Update

- [x] 4.1 Update `insertWorkOrder()` in `supabase/functions/oee-trigger/index.ts` — add `lifecycle_phase: 'WAPPR'`, `block_reason: 'NONE'`, `symptom_note: sintoma`
- [x] 4.2 Remove `description`, `status`, `actual_hours`, `cost_estimate`, `actual_cost`, `percentage_complete`, `_conflict`, `_deleted` from INSERT object
- [x] 4.3 Update `index_test.ts` — assert `lifecycle_phase='WAPPR'`, `block_reason='NONE'`, `symptom_note=sintoma`, absence of removed fields
- [x] 4.4 Run `deno test` locally to verify all tests pass
