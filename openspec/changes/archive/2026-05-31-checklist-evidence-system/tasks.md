# Tasks: Checklist Evidence System

> 20 tasks across 3 phases. Migration file has 10 sections covering 6 new tables, 2 ALTERs, 3 trigger functions, RLS, audit.
> Design ref: `design.md` (773 lines), specs: `specs/checklist-evidence/`, `specs/competency-evidence/`, `specs/competency-engine/`, `specs/mechanic-work-order-execution/`

---

## Phase 1: Database — Migration + pgTAP

> All tasks in this phase write to a **single migration file**: `supabase/migrations/20260529000001_checklist_evidence.sql`
> Inherited patterns: SECURITY DEFINER, SET search_path = public, snake_case, COMMENT ON, DROP IF EXISTS
> Must run AFTER `20260528000002_competency_engine.sql` (modifies triggers created there)

---

### [ ] 1.1 Migration Sections 1-4 — 6 new tables + seed data

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: None (first task)
- **Acceptance**:
  - `causa_falla_catalog` table exists with exactly 6 seed rows (BRECHA_CONOCIMIENTO, FALTA_HERRAMIENTA, DESVIACION_DISCIPLINARIA, FALTA_REPUESTO, ERROR_DOCUMENTACION, NO_APLICA)
  - `checklist_templates` table exists with FKs to `technological_modules(id)` and optionally `job_plans(id)`, block CHECK ('A','B','C'), sampling_rate CHECK (0-100), is_auditable, is_active
  - Unique partial indexes on `checklist_templates`: one for `module_id + block WHERE job_plan_id IS NULL`, one for `module_id + job_plan_id + block WHERE job_plan_id IS NOT NULL`
  - `checklist_template_items` table exists with FK CASCADE, item_type CHECK ('safety','procedure','quality','precision'), UNIQUE(template_id, step_sequence)
  - `checklist_instances` table exists with FKs to work_orders, user_profiles (technician_id, evaluated_by, verified_by), checklist_templates, assets; evaluator_source CHECK ('SELF','SUPERVISOR','PEER'); status CHECK ('IN_PROGRESS','COMPLETED','VOID')
  - Indexes on `checklist_instances`: work_order_id, technician_id, status
  - `checklist_item_responses` table exists with FK CASCADE to checklist_instances, FK to checklist_template_items, status CHECK ('PASS','FAIL'), optional causa_falla_id FK, photo_url, comment, measurement_value
  - Index on `checklist_item_responses`: checklist_instance_id
  - `checklist_sampling_config` table exists with FKs to technological_modules and job_plans (both optional), block CHECK, default_sampling_rate CHECK (0-100), is_auditable_only, is_active, UNIQUE(module_id, job_plan_id, block)
  - All tables have COMMENT ON for table and key columns (Spanish)
- **Notes**:
  - Causa falla seed uses `ON CONFLICT (code) DO NOTHING` for idempotency
  - `checklist_instances.evaluated_by` defaults to `auth.uid()`
  - `checklist_instances.technician_id` is the assigned tech (NOT necessarily `auth.uid()` — SUPERVISOR can evaluate on behalf)
  - `checklist_instances.asset_id` is denormalized from the work order for query convenience
  - Sampling config: `default_sampling_rate` is stored on `checklist_sampling_config` (NOT on template), see design Section 4 vs spec — spec says column name `sampling_rate`, design Section 4 says `default_sampling_rate`; use `default_sampling_rate` per design (the config is an _override_ of a template-level default)

---

### [ ] 1.2 Migration Sections 5-6 — ALTER existing tables

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: [1.1] (uses tables created in sections 1-4 for FKs)
- **Acceptance**:
  - `technician_skill_evidence` has 3 new nullable columns: `evaluation_source TEXT CHECK ('SELF','SUPERVISOR','PEER')`, `causa_falla_id UUID FK → causa_falla_catalog(id)`, `trust_score NUMERIC CHECK (0-1)`
  - Existing rows have NULL in all 3 new columns (backward compatible)
  - `work_orders` has 2 new columns: `is_auditable BOOLEAN DEFAULT false`, `audit_reason TEXT`
  - Both ALTERs use `ADD COLUMN IF NOT EXISTS` for idempotency
  - COMMENT ON all 5 new columns (Spanish)
- **Notes**:
  - `trust_score IS NULL` means "legacy evidence, treat as 1.0" (handled in trigger [1.4])
  - `causa_falla_id IS NULL` on evidence means "regular FAIL, counts against competency"
  - The `technician_skill_evidence` FK to `causa_falla_catalog` depends on [1.1] creating that table first

---

### [ ] 1.3 Migration Section 7 — trg_checklist_to_evidence trigger

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: [1.1], [1.2] (needs tables + ALTERed columns)
- **Acceptance**:
  - Function `trg_checklist_to_evidence()` exists, SECURITY DEFINER, SET search_path = public, LANGUAGE plpgsql
  - Trigger `trg_checklist_to_evidence` on `checklist_instances`: AFTER UPDATE, FOR EACH ROW, WHEN (NEW.status = 'COMPLETED')
  - For each COMPLETED instance, iterates all `checklist_item_responses` and inserts into `technician_skill_evidence`
  - Block→nivel_evaluado mapping: A→2, B→3, C→4 (resolved via `checklist_templates.block`)
  - Modulo_gema resolved from template → `technological_modules.code`
  - Trust_score resolved from `evaluator_source`: SELF=0.5, PEER=0.8, SUPERVISOR=1.0, default=1.0
  - NO_APLICA override: if `causa_falla_code = 'NO_APLICA'`, then `v_effective_status := true` regardless of item status
  - Each evidence row includes: work_order_id, technician_id, asset_id, modulo_gema, nivel_evaluado, item_evaluado (from template), status, evaluated_at, evaluated_by, evaluation_source, causa_falla_id, trust_score
  - If NEW.status != 'COMPLETED', returns NEW immediately (no-op)
  - RAISE WARNING if module cannot be resolved (does not block)
- **Notes**:
  - Use `FOR v_item IN SELECT ... LOOP` pattern from design
  - JOIN `causa_falla_catalog cfc` to resolve NO_APLICA by code
  - `SELECT item_text FROM checklist_template_items WHERE id = v_item.template_item_id` inside loop to get text
  - Trigger uses DROP IF EXISTS / CREATE pattern for idempotency
  - This trigger MUST fire BEFORE `trg_recalculate_technician_level` (AFTER INSERT on evidence) — that already exists from the competency engine migration, so this trigger inserts evidence, which then fires the recalculate trigger. The chain is: checklist_instances UPDATE → trg_checklist_to_evidence (AFTER) → INSERT evidence → trg_recalculate_technician_level (AFTER INSERT on evidence) → level updates.

---

### [ ] 1.4 Migration Section 8 — Modify trg_recalculate_technician_level + trg_update_module_progress

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: [1.2], [1.3] (needs trust_score + causa_falla_id columns)
- **Acceptance**:
  - `trg_recalculate_technician_level` function is **replaced** (DROP/CREATE or CREATE OR REPLACE) with new logic for level 3:
    - OLD: `SELECT COUNT(*) ... WHERE nivel_evaluado=3 AND status=true`
    - NEW: `SELECT COALESCE(SUM(COALESCE(tse.trust_score, 1.0)), 0) ... WHERE nivel_evaluado=3 AND status=true AND (tse.causa_falla_id IS NULL OR cfc.code NOT IN ('FALTA_HERRAMIENTA', 'FALTA_REPUESTO', 'ERROR_DOCUMENTACION'))`
  - Same change applied to `trg_update_module_progress()` function
  - Level 3 threshold remains `>= 5` (now trust-weighted)
  - Legacy evidence with NULL trust_score counts as 1.0 (COALESCE)
  - Evidence with causa_falla_id IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION) is EXCLUDED from SUM regardless of PASS/FAIL
  - Evidence with causa_falla_id=NULL is treated as regular FAIL (not excluded from FAIL counting — but for SUM we only sum status=true rows, so a FAIL row is simply not included in SUM regardless)

    **Correction on the above**: The filter `tse.status = true` already means only PASS rows get summed. The causa_falla filter further excludes certain PASS rows that shouldn't count (e.g., PASS with FALTA_REPUESTOS = "technician passed but only because of external factors"). And for FAIL rows, they are already excluded by `tse.status = true`. So the query is correct.

    Actually, re-reading the spec more carefully: "Evidence with `status=false AND causa_falla_id IN (...)` SHALL be excluded entirely from level 3 SUM calculation." Since SUM only operates on `status=true`, FAIL rows are already excluded. But the spec says "exclude entirely" — so the filter clause `cfc.code NOT IN (...)` combined with `tse.status = true` is correct.

  - `COALESCE(tse.trust_score, 1.0)` ensures backward compat for legacy
- **Notes**:
  - Use `CREATE OR REPLACE FUNCTION` to modify existing functions
  - Must verify the existing function signature matches before replacing
  - The 3 excluded causa_falla codes represent "external factors" — not the technician's fault
  - Also apply to `trg_update_module_progress()` which has identical level 3 logic
  - After this migration, existing level 3 counts get re-weighted: a technician with 5 legacy PASS (NULL trust → 1.0) still qualifies

---

### [ ] 1.5 Migration — trg_validate_checklist_gate (BEFORE UPDATE on work_orders)

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: [1.1] (needs checklist_instances + checklist_item_responses + checklist_templates)
- **Acceptance**:
  - Function `trg_validate_checklist_gate()` exists, SECURITY DEFINER, SET search_path = public
  - Trigger on `work_orders`: BEFORE UPDATE, FOR EACH ROW, WHEN (OLD.lifecycle_phase IS DISTINCT FROM NEW.lifecycle_phase)
  - Only acts on INPRG → COMP transition
  - **Block A HARD gate**: If any Block A instance exists for this WO that is NOT COMPLETED → RAISE EXCEPTION "Completá el checklist de seguridad (Bloque A) antes de finalizar"
  - **Block A FAIL gate**: If any Block A instance is COMPLETED but has FAIL items (excluding NO_APLICA) → RAISE EXCEPTION "El checklist Bloque A tiene ítems FAIL — revisalos antes de finalizar"
  - **Block B/C SOFT gate**: If Block B or C instances exist and are NOT COMPLETED:
    - Look up first SOFT violation for this module+block using MIN(wo.completed_at) WHERE is_auditable=true
    - If first violation > 60 days ago → HARD: RAISE EXCEPTION "El checklist Bloque {B|C} es obligatorio — contactá a tu supervisor"
    - If within 60 days or first violation → SOFT: set NEW.is_auditable = true, NEW.audit_reason = "Bloque {B|C} checklist required but not completed at close-out"
  - If OLD.lifecycle_phase = NEW.lifecycle_phase → RETURN NEW (no-op)
  - Non INPRG → COMP transitions → RETURN NEW (no-op)
- **Notes**:
  - 60d grace period is per (module_code, block) combination globally
  - The FIRST SOFT violation starts the clock; AFTER 60d from that first violation, ALL WOs in that module+block have HARD gate
  - This trigger fires BEFORE the existing lifecycle FSM trigger — if this gate raises, FSM never runs
  - Fires on ANY lifecycle_phase change, not just INPRG→COMP, but only acts on that specific transition
  - Module code resolved via `assets → technological_modules`

---

### [ ] 1.6 Migration Sections 9-10 — RLS policies + audit triggers

- **Files**: `supabase/migrations/20260529000001_checklist_evidence.sql`
- **Depends on**: [1.1] (needs all 6 tables)
- **Acceptance**:

  **RLS per table** (use `get_user_role()` pattern, existing function):

  | Table | TECHNICIAN | PLANNER | ADMIN |
  |---|---|---|---|
  | `causa_falla_catalog` | SELECT | SELECT | ALL |
  | `checklist_templates` | SELECT | INSERT/SELECT/UPDATE | ALL |
  | `checklist_template_items` | SELECT | INSERT/SELECT/UPDATE | ALL |
  | `checklist_sampling_config` | SELECT | SELECT/UPDATE | ALL |
  | `checklist_instances` | SELECT/INSERT/UPDATE (own `technician_id = auth.uid()`) | ALL | ALL |
  | `checklist_item_responses` | SELECT/INSERT (own via instance) | ALL | ALL |

  - All tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  - One policy per role per operation (e.g., `technician_select`, `planner_insert`, `admin_all`)
  - For `checklist_item_responses`: TECHNICIAN "own via instance" means the instance's `technician_id = auth.uid()` — requires a subquery or JOIN in the USING clause
  - `technician_skill_evidence` RLS already exists from competency engine; verify it allows the SECURITY DEFINER trigger to bypass

  **Audit triggers** (follow existing `audit_trigger_func()` pattern):
  - `checklist_instances_audit`: AFTER INSERT OR UPDATE OR DELETE ON checklist_instances
  - `checklist_item_responses_audit`: AFTER INSERT OR UPDATE OR DELETE ON checklist_item_responses
  - Both use `EXECUTE FUNCTION audit_trigger_func()`

- **Notes**:
  - RLS policy for `checklist_item_responses` TECHNICIAN INSERT must verify ownership through the instance: `checklist_instance_id IN (SELECT id FROM checklist_instances WHERE technician_id = auth.uid())`
  - All existing tables from competency engine already have RLS — only new tables need new policies
  - The `trg_checklist_to_evidence` trigger is SECURITY DEFINER, so it bypasses RLS on technician_skill_evidence — no policy change needed there

---

### [ ] 1.7 pgTAP tests — Schema + seed data + constraints

- **Files**: `supabase/tests/database/checklist_evidence_test.sql`
- **Depends on**: [1.1], [1.2], [1.6] (migration applied)
- **Acceptance**:
  - Test file follows existing pattern: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`
  - Uses `SAVEPOINT`/`ROLLBACK TO` for test isolation
  - Tests:
    - All 6 new tables exist: `has_table()` for each
    - Seed data: `causa_falla_catalog` has exactly 6 rows
    - CHECK constraints: verify `checklist_instances.status` rejects 'DONE', accepts 'COMPLETED'; `checklist_templates.block` rejects 'D'
    - FK constraints: verify `checklist_templates.module_id` references `technological_modules(id)` with `col_is_fk()`
    - New columns on `technician_skill_evidence`: `has_column()` for evaluation_source, causa_falla_id, trust_score
    - New columns on `work_orders`: `has_column()` for is_auditable, audit_reason
    - RLS enabled: `SELECT is('on', relrowsecurity::text FROM pg_class WHERE relname = 'checklist_instances')`
    - Unique indexes: attempt duplicate module+block for module-wide template → throws
    - Sampling CHECK: verify `default_sampling_rate=101` on `checklist_sampling_config` is rejected
- **Notes**:
  - Plan count must account for every assertion (use inline `plan(N)` updates as sections are added)
  - Follow the same pattern as `competency_engine_test.sql`: seed global auth users + profiles first

---

### [ ] 1.8 pgTAP tests — Trigger feeding + recalculate + gate

- **Files**: `supabase/tests/database/checklist_evidence_test.sql`
- **Depends on**: [1.3], [1.4], [1.5] (all triggers exist)
- **Acceptance**:

  **trg_checklist_to_evidence tests**:
  - Create a template + instance + 3 items (2 PASS, 1 FAIL with FALTA_HERRAMIENTA)
  - Update instance to COMPLETED
  - Verify 3 rows inserted into `technician_skill_evidence` with correct work_order_id, modulo_gema, nivel_evaluado, item_evaluado, status
  - Verify FAIL row has `status=false` and `causa_falla_id` = FALTA_HERRAMIENTA
  - Verify NO_APLICA override: item_response FAIL + NO_APLICA → evidence has `status=true`
  - Verify trust_score: SELF→0.5, PEER→0.8, SUPERVISOR→1.0 (3 separate scenarios)
  - Verify trigger is no-op when status != COMPLETED (update to VOID, no evidence created)

  **trg_recalculate_technician_level tests** (trust-weighted + causa_falla filter):
  - **Backward compat**: legacy 5 PASS with NULL trust_score → SUM = 5.0 → level 3
  - **Trust-weighted**: 10 SELF PASS (trust=0.5) → SUM = 5.0 → level 3
  - **Below threshold**: 8 SELF PASS (trust=0.5) → SUM = 4.0 → NOT level 3
  - **FALTA_HERRAMIENTA exclusion**: 5 PASS + 3 FAIL with FALTA_HERRAMIENTA → SUM = 5.0 → level 3 (FAILs excluded)
  - **BRECHA_CONOCIMIENTO counts**: 5 PASS + 2 FAIL with BRECHA_CONOCIMIENTO → SUM = 5.0 → level 3 (brecha is regular FAIL, excluded from SUM because status=false)
  - **NULL causa_falla legacy**: 5 PASS + 1 FAIL with NULL causa_falla → SUM = 5.0 → level 3 (NULL causa_falla is regular FAIL)

  **trg_validate_checklist_gate tests**:
  - Block A IN_PROGRESS → INPRG→COMP rejected with error message
  - Block A COMPLETED all PASS → INPRG→COMP allowed
  - Block A COMPLETED with FAIL → INPRG→COMP rejected
  - Block B IN_PROGRESS within 60d → SOFT: allowed, is_auditable=true
  - Block B first violation starts 60d clock
  - Block B after 60d expiry → HARD: rejected

- **Notes**:
  - Use `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" TO '...'` for context where needed
  - Gate tests need to set `OLD.lifecycle_phase = 'INPRG'` via direct UPDATE (the trigger fires on UPDATE)
  - For grace period tests, use `NOW() - INTERVAL '61 days'` on `work_orders.completed_at` to simulate expired grace
  - All tests wrapped in SAVEPOINT/ROLLBACK TO for isolation

---

### [ ] 1.9 pgTAP tests — RLS + sampling + Block C visibility

- **Files**: `supabase/tests/database/checklist_evidence_test.sql`
- **Depends on**: [1.6] (RLS policies applied)
- **Acceptance**:

  **RLS tests**:
  - TECHNICIAN can SELECT `causa_falla_catalog` (all rows returned)
  - TECHNICIAN cannot INSERT into `causa_falla_catalog` (throws 42501)
  - TECHNICIAN can INSERT `checklist_instances` with own technician_id (lives_ok)
  - TECHNICIAN cannot SELECT `checklist_instances` where technician_id != auth.uid() (returns 0 rows)
  - PLANNER can INSERT `checklist_templates` (lives_ok)
  - ADMIN can DELETE from `checklist_sampling_config` (lives_ok)
  - TECHNICIAN cannot INSERT into `technician_skill_evidence` directly (throws 42501 — verifies trigger is only way)
  - SECURITY DEFINER trigger insert bypasses RLS (use `SECURITY DEFINER` test function or verify via checklist completion flow)

  **Sampling tests**:
  - Deterministic hash: same WO+template always gives same result (call resolution twice, assert same outcome)
  - Sampling rate 100 always includes
  - Sampling rate 0 always excludes

  **Block C visibility test**:
  - Technician with current_level=2 → Block C instance NOT created
  - Technician with current_level=3 → Block C instance created (if sampling matches)

- **Notes**:
  - RLS tests use `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub" TO '...'` with corresponding user_profile roles
  - Sampling determinism: compute `hash(wo.id || template.id) % 100` in SQL and verify against expected range
  - Block C visibility requires `technician_skills` row to exist (may need to insert one for test)

---

## Phase 2: Backend — RxDB + Hooks + Adapters

> All backend tasks depend on Phase 1 (RxDB schemas must match DB schema)

---

### [ ] 2.1 Add 5 RxDB collection schemas to rxdb.js

- **Files**: `src/lib/rxdb.js`
- **Depends on**: [1.1] (schemas mirror DB tables)
- **Acceptance**:

  5 new collection schemas added to `addCollections()` in `_createDatabase()`:

  **`causa_falla_catalog`** — version 0, primaryKey `id` (maxLength 50), pull-only
  - Fields: id, code, description
  - Replication: `createPullHandler('causa_falla_catalog', 'id')`

  **`checklist_templates`** — version 0, primaryKey `id` (maxLength 50), pull-only
  - Fields: id, module_id, job_plan_id?, block, title, description?, sampling_rate?, is_auditable?, is_active?, created_at
  - Replication: `createPullHandler('checklist_templates', 'created_at')`

  **`checklist_instances`** — version 0, primaryKey `id` (maxLength 50), pull + push
  - Fields: id, work_order_id, technician_id, template_id, asset_id, evaluator_source (enum: SELF/SUPERVISOR/PEER), evaluated_by, verified_by?, verified_at?, status (enum: IN_PROGRESS/COMPLETED/VOID), started_at, completed_at?, _deleted
  - Pull handler: filters by `technician_id = auth.uid()` (like labor_records pattern)
  - Push handler: standard `createPushHandler` with field list
  - Pre-save validation: none needed (trigger enforces on server)

  **`checklist_item_responses`** — version 0, primaryKey `id` (maxLength 50), pull + push
  - Fields: id, checklist_instance_id, template_item_id, status (enum: PASS/FAIL), causa_falla_id?, photo_url?, comment?, measurement_value?, responded_at?, _deleted
  - Pull handler: filters by instance's technician_id (join-based)
  - Push handler: standard `createPushHandler`

  **`checklist_sampling_config`** — version 0, primaryKey `id` (maxLength 50), pull-only
  - Fields: id, module_id?, job_plan_id?, block, default_sampling_rate?, is_auditable_only?, is_active?
  - Replication: `createPullHandler('checklist_sampling_config', 'id')`

- **Notes**:
  - Only `checklist_instances` and `checklist_item_responses` need push handlers (created client-side)
  - `causa_falla_catalog`, `checklist_templates`, `checklist_sampling_config` are pull-only (read from server)
  - For pull-only collections, set push to `null` in replication config
  - Follow the exact same schema structure as existing collections: `{ version, primaryKey, type: 'object', properties: {...}, required: [...] }`
  - Required fields must match DB NOT NULL columns
  - Add a 5th `workOrderSchema` migration strategy if `is_auditable` / `audit_reason` fields need to be synced (see [2.2] modifies workOrderSchema)
  - Create a `CHECKLIST_INSTANCE_PUSH_FIELDS` and `CHECKLIST_ITEM_RESPONSE_PUSH_FIELDS` constant arrays like existing `WORK_ORDER_PUSH_FIELDS`

---

### [ ] 2.2 Add `is_auditable` + `audit_reason` to work_orders RxDB schema

- **Files**: `src/lib/rxdb.js`
- **Depends on**: [1.2] (DB has these columns)
- **Acceptance**:
  - `workOrderSchema.properties` includes `is_auditable: { type: 'boolean' }` and `audit_reason: { type: 'string' }`
  - `is_auditable` defaults to `false` in migration strategy (new v5 migration)
  - `audit_reason` defaults to `''` in migration strategy
  - `WORK_ORDER_PUSH_FIELDS` includes both fields
- **Notes**:
  - Increment workOrderSchema version from 4 to 5
  - Add `workOrdersMigrationV5` strategy like the existing V2/V3/V4 patterns

---

### [ ] 2.3 Create checklistAdapter.js

- **Files**: `src/lib/adapters/checklistAdapter.js`
- **Depends on**: None (standalone utility)
- **Acceptance**:
  - `toViewModel(doc)` converts RxDB checklist document (snake_case) to camelCase ViewModel
  - `toViewModelList(docs)` maps array via `toViewModel`
  - Separate `toInstanceViewModel`, `toTemplateViewModel`, `toResponseViewModel` if needed for type clarity
  - `validateSubmission(items)` — validates that every FAIL item has a `causa_falla_id` before submit; returns `{ valid, errors: { itemId: 'error message' } }`
  - Follows same pattern as `laborAdapter.js`: `export function toViewModel(doc)` → `{ id, workOrderId, technicianId, ... }`
- **Mapping**:
  ```javascript
  // checklist_instance
  { id, workOrderId, technicianId, templateId, assetId,
    evaluatorSource, evaluatedBy, verifiedBy, verifiedAt,
    status, startedAt, completedAt }
  // checklist_item_response
  { id, checklistInstanceId, templateItemId, status,
    causaFallaId, photoUrl, comment, measurementValue, respondedAt }
  // checklist_template
  { id, moduleId, jobPlanId, block, title, description,
    samplingRate, isAuditable, isActive, createdAt }
  ```
- **Notes**:
  - `validateSubmission` is called by FocusModeModal before submit
  - Edge case: `optional=true` items have no response → skip validation, don't require PASS/FAIL

---

### [ ] 2.4 Create useChecklists.js hook

- **Files**: `src/hooks/useChecklists.js`
- **Depends on**: [2.1] (RxDB collections exist), [2.3] (adapter exists)
- **Acceptance**:

  Exposes 6 functions + reactive state:

  - `useChecklists({ workOrderId, userId })` → `{ templates, instances, getVisibleBlocks, submitChecklist, checkLifecycleGate, loading, error }`

  **`resolveTemplatesForWO(workOrderId)`** — async, returns filtered templates:
  1. Get work order from RxDB (resolve asset_id → module_id via `assets` collection)
  2. Find active templates: `checklist_templates` where module_id matches
  3. Priority: job_plan-specific overrides module-wide
  4. Apply sampling: deterministic hash check
  5. Apply Block C visibility: check technician level
  6. Return array of `{ template, block, samplingRate }`

  **`getVisibleBlocks(technicianId, moduleCode)`** — async, returns block array:
  1. Query `technician_skills` for current_level in this module
  2. Block A always visible
  3. Block B visible if level >= 1 (always)
  4. Block C visible if level >= 3

  **`createChecklistInstances(woId, templates)`** — async:
  1. For each resolved template, insert `checklist_instance` with status='IN_PROGRESS'
  2. Returns `{ success, instances: Array<id> }`

  **`getChecklistInstances(woId)`** — async:
  1. Query `checklist_instances` by work_order_id (reactive subscription)
  2. Returns ViewModel array

  **`submitChecklist(payload)`** — async:
  1. Validate all FAIL items have causa_falla_id (call `validateSubmission`)
  2. For each item in payload.items: `INSERT checklist_item_responses`
  3. Update `checklist_instances.status` to 'COMPLETED' (this triggers the DB trigger)
  4. Returns `{ success, errors? }`

  **`checkLifecycleGate(woId)`** — async, returns gate status:
  1. Load checklist_instances for this WO
  2. For each instance, check status + item responses
  3. Return `{ allowed: boolean, blocks: Array<{ block, status: 'COMPLETED'|'INCOMPLETE'|'FAIL'|'MISSING', soft?: boolean, reason?: string }> }`
  4. Block A INCOMPLETE or FAIL → not allowed
  5. Blocks B/C INCOMPLETE within 60d → allowed with soft flag
  6. Blocks B/C INCOMPLETE after 60d → not allowed

- **Notes**:
  - Follow `useLaborRecords.js` pattern: `useEffect` init, `initRxDB()`, subscription to reactive changes
  - `submitChecklist` is the critical writing path — MUST validate FAIL+causa_falla on client side (server trigger also validates via NO_APLICA logic but client validation prevents unnecessary round-trips)
  - `checkLifecycleGate` is called by WorkOrderDrawer and WorkOrderActions — needs to be performant (reads from local RxDB, no server query)
  - Sampling hash: `function deterministicHash(str) { let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return Math.abs(hash); }`
  - `getVisibleBlocks` needs to read from `technician_skills` RxDB collection (created by competency engine Phase 2)

---

## Phase 3: Frontend — Focus Mode Modal + Lifecycle Gates

---

### [ ] 3.1 Create FocusModeCard.jsx

- **Files**: `src/components/mechanic/FocusModeCard.jsx`
- **Depends on**: None (standalone presentational component)
- **Acceptance**:
  - Renders a single checklist item as a large touch-friendly card
  - Displays `item_text` prominently, with visual `item_type` badge (safety=red, procedure=blue, quality=green, precision=purple)
  - Two large buttons: PASS (green `#4caf50`) with checkmark icon, FAIL (red `#f44336`) with close icon
  - Selected state: tapped button becomes filled/lifted, other is outlined
  - **When FAIL is selected**: `CausaFallaSelector` appears below with 6 radio options from `causa_falla_catalog`
  - **When PASS is selected**: `CausaFallaSelector` is hidden (causa_falla not required)
  - Photo capture button shown if `requires_photo` (use device camera or file input — placeholder `📷` button that sets photoUrl state)
  - Comment textarea shown if `requires_comment`
  - If `optional=true`: shows a "Skip" button that allows proceeding without selection
  - Props: `{ item, selectedStatus, selectedCausaFalla, onStatusChange, onCausaFallaChange, onPhotoCapture, onCommentChange, photoUrl, comment }`
  - Next button disabled if:
    - No PASS/FAIL selected AND item is not optional
    - FAIL selected but no causa_falla chosen
- **Notes**:
  - This is a presentational component — FocusModeModal manages the state array
  - Large touch targets: buttons should be minimum 48px height, full width
  - Use MUI `Radio`, `RadioGroup`, `FormControlLabel` for causa_falla selector
  - Use `DialogContent` styling pattern from existing codebase
  - The CausaFallaSelector reads from RxDB `causa_falla_catalog` collection (reactive)

---

### [ ] 3.2 Create FocusModeProgress.jsx

- **Files**: `src/components/mechanic/FocusModeProgress.jsx`
- **Depends on**: None (standalone presentational component)
- **Acceptance**:
  - Shows "Item N de M — Bloque {block}" text at top of modal
  - Linear progress bar showing position
  - Current step indicator: colored dot for current, checkmarks for completed, gray for remaining
  - Props: `{ currentIndex, totalItems, block }`
- **Notes**:
  - Use MUI `LinearProgress` with `determinate` variant
  - Step dots: use MUI `Step`, `StepLabel`, `Stepper` with `alternativeLabel` for responsive layout
  - Compact design: fits in ~60px height at top of modal

---

### [ ] 3.3 Create FocusModeResult.jsx

- **Files**: `src/components/mechanic/FocusModeResult.jsx`
- **Depends on**: None (standalone presentational component)
- **Acceptance**:
  - Summary screen showing all items with PASS (green badge) or FAIL (red badge)
  - Items with FAIL display their causa_falla description
  - Items with NO_APLICA show "N/A (No Aplica)" badge
  - Block-level result summary:
    - Block A: 🟢 "Todos PASS" or 🔴 "Tiene ítems FAIL — contactá a tu supervisor"
    - Block B/C: 🟢 "Completado" or 🟡 "Pendiente — se marcará para auditoría" or 🔴 "Obligatorio — contactá a tu supervisor"
  - "Submit" button (full-width, large, primary color) to finalize checklist
  - "Revisar" (Review) link/button to go back and edit FAIL items
  - Props: `{ items, responses, onReview, onSubmit, isSubmitting, blockResults }`
- **Notes**:
  - `responses` is the final state array after all items answered
  - Block-level results are computed from `blockResults` prop (computed by FocusModeModal from responses)
  - "Revisar" button navigates back to the specific FAIL item index

---

### [ ] 3.4 Create FocusModeModal.jsx

- **Files**: `src/components/mechanic/FocusModeModal.jsx`
- **Depends on**: [3.1], [3.2], [3.3] (all child components), [2.4] (useChecklists hook), [2.3] (adapter validation)
- **Acceptance**:
  - Full-screen `<Dialog>` with `fullScreen` prop, dark backdrop
  - NOT a Drawer — explicitly uses `<Dialog fullScreen>` from MUI
  - On open:
    1. Loads checklist_template_items from RxDB for the given template (ordered by step_sequence)
    2. Initializes empty responses array `[{ itemId, status: null, causaFallaId: null, photoUrl: null, comment: '' }]`
    3. Sets `currentIndex = 0`
  - Navigation:
    - Shows current item via FocusModeCard (index = currentIndex)
    - "Next" button: advances to next item (only if current item answered, or optional+skipped)
    - "Back" button: returns to previous item
    - On last item: transitions to FocusModeResult summary
  - State management:
    - `responses[]` — accumulator of all answers
    - `currentIndex` — current item position
    - `isComplete` — boolean, switches to result screen
    - Optionally: `error` state for submit failures
  - On Submit (from FocusModeResult):
    1. Validate all non-optional items have PASS/FAIL
    2. Filter out skipped optional items (no response recorded)
    3. Call `submitChecklist(payload)` from useChecklists hook
    4. On success: close modal, refresh WO drawer
    5. On error: show inline error toast
  - Props: `{ open, onClose, workOrderId, technicianId, templateId }`
- **Notes**:
  - Use `useChecklists().submitChecklist` for the submit flow
  - MUST handle the NO_APLICA case: if user selects FAIL then picks NO_APLICA, the response records `status='FAIL', causa_falla_id=NO_APLICA` — the DB trigger converts this to PASS
  - iOS fullscreen: add `sx={{ '& .MuiDialog-paper': { width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', m: 0 } }}`
  - Follow existing Dialog pattern from WorkOrderDrawer (confirmation dialog)

---

### [ ] 3.5 Modify WorkOrderDrawer.jsx — Add "Begin Close-Out" button + gate-aware Completar

- **Files**: `src/components/mechanic/WorkOrderDrawer.jsx`
- **Depends on**: [3.4] (FocusModeModal component), [2.4] (checkLifecycleGate hook)
- **Acceptance**:

  **When `lifecyclePhase === 'INPRG'`**:

  1. On drawer open, call `checkLifecycleGate(workOrder.id)` to get gate status
  2. **If Block A exists and NOT completed**: Show "Iniciar Cierre" button (above WorkOrderActions). Clicking opens FocusModeModal.
  3. **If Block A completed with FAIL**: Show warning Alert "El checklist de seguridad tiene ítems FAIL. Revisalos antes de finalizar."
  4. **If Blocks B/C missing (within 60d grace)**: Show yellow Alert "El checklist Bloque B/C no fue completado. Se marcará para auditoría." — still allow Completar.
  5. **If Blocks B/C missing (grace expired)**: Show red Alert "El checklist Bloque B/C es obligatorio. Contactá a tu supervisor." + block Completar.
  6. **"Completar" button behavior**: Pass `validationErrors` with checklist gate messages to disable it appropriately.

  **New state**:
  - `focusModeOpen` — boolean, controls FocusModeModal visibility
  - `checklistGate` — result from `checkLifecycleGate`, stored after initial load
  - `checklistLoading` — loading indicator for gate check

  **Data flow**:
  ```
  Drawer open → useChecklists().checkLifecycleGate(woId)
              → setChecklistGate(result)
              → render appropriate UI based on result.blocks
  ```

- **Notes**:
  - Import FocusModeModal and render it as a sibling to the confirmation Dialog (not inside Drawer)
  - Gate loading should be non-blocking: show skeleton/spinner for the checklist section, rest of drawer loads normally
  - When FocusModeModal closes after successful submit → re-check gate (instances now COMPLETED)
  - "Iniciar Cierre" button styling: full-width, `color="warning"` variant, with clipboard-check icon
  - The existing `handleAction` for Completar must incorporate checklistGate into validation

---

### [ ] 3.6 Modify WorkOrderActions.jsx — Show checklist status + disable Completar

- **Files**: `src/components/mechanic/WorkOrderActions.jsx`
- **Depends on**: None (standalone component, modified)
- **Acceptance**:

  1. Accept new props: `checklistGate`, `showBeginCloseOut`, `onBeginCloseOut`
  2. When `showBeginCloseOut === true`: render "Iniciar Cierre" button ABOVE the standard action button (or replace the standard button)
  3. When `checklistGate.blocks` has Block A FAIL or grace-expired Block B/C: disable "Completar" with tooltip showing the specific error
  4. Tooltips for different gate states:
     - Block A incomplete: "Completá el checklist de seguridad (Bloque A) antes de finalizar"
     - Block A FAIL: "El checklist Bloque A tiene ítems FAIL — revisalos"
     - Block B/C grace expired: "El checklist Bloque {B|C} es obligatorio — contactá a tu supervisor"
     - Block B/C SOFT: no tooltip (allow Completar, warning shown in drawer)
  5. When checklist is loading: show skeleton or disabled button

- **Changes from current**:
  - Current: single button per ACTION_CONFIG[lifecyclePhase]
  - New when INPRG: conditional rendering — either (a) "Iniciar Cierre" button alone, (b) both buttons stacked, or (c) only "Completar" (when all checklists done)
  - The "Begin Close-Out" button opens FocusModeModal (the parent passes `onBeginCloseOut`)

- **Notes**:
  - Keep backward compatibility: when `checklistGate` prop is undefined/null, render as before (no change for COMP/CLOSED phases)
  - Use `stack` direction for button layout when showing both buttons
  - "Iniciar Cierre" button: `color="warning"` variant, `startIcon={<AssignmentIcon />}`

---

### [ ] 3.7 Modify workOrderAdapter.js — Add checklist validation to validateCompletion()

- **Files**: `src/lib/adapters/workOrderAdapter.js`
- **Depends on**: None (standalone adapter)
- **Acceptance**:
  - `validateCompletion(notes, checklistGate?)` accepts optional second parameter
  - When `checklistGate` is provided and `checklistGate.allowed !== true`:
    - Returns `{ valid: false, errors: { checklist: 'error message' }, checklistBlocked: true }`
  - Existing validation (symptom_note, action_note) still runs
  - The WorkOrderDrawer's `handleAction` passes `checklistGate` to validateCompletion
- **Notes**:
  - Don't break existing callers (no checklistGate → validate as before)
  - Error messages should match the trigger's exception messages in [1.5]

---

### [ ] 3.8 Implement sampling resolution at APPROVED→INPRG transition

- **Files**: `src/hooks/useChecklists.js` (add to the `clockIn` equivalent or a new `startWorkOrder` function), `src/lib/rxdb.js` (add pre-save hook or trigger on lifecycle change)
- **Depends on**: [2.4] (useChecklists hook exists), [2.1] (RxDB collections)
- **Acceptance**:
  - When a work order transitions APPROVED → INPRG (currently in `useLaborRecords.clockIn`), call sampling resolution
  - Resolution flow (inline in hook or a dedicated function):
    1. Get work order's module_id (via `workOrder.asset_id` → resolve `asset.module_id` from `assets` collection)
    2. Query `checklist_templates` for active templates matching module
    3. Apply job_plan override priority
    4. For each template:
       a. Get effective sampling_rate (template rate, or config override)
       b. Apply deterministic hash: `(hash(wo.id + template.id) % 100) < effective_rate`
       c. If Block C: check technician level >= 3
    5. Create `checklist_instances` for each passing template
  - If no templates match for a block, no instance is created (block is simply not applicable)
  - The existing APPROVED→INPRG in `useLaborRecords.clockIn` should be modified to call `resolveChecklists` after the WO transition. Or better: a separate hook call in WorkOrderDrawer or WorkOrderList that triggers on lifecycle change.
- **Notes**:
  - This is the trickiest backend task: it bridges the RxDB client-side lifecycle transition with checklist instance creation
  - Pattern: In `useLaborRecords.js`, after the `woDoc.update({ $set: { lifecycle_phase: 'INPRG' } })` call, invoke `resolveChecklists(woDoc, userId)` from useChecklists
  - Alternatively, handle it in WorkOrderDrawer: when drawer opens with INPRG and no checklist_instances exist yet for this WO → resolve and create
  - The latter is more resilient (handles offline case where the transition happened but checklists weren't resolved)
  - IMPORTANT: `resolveChecklists` must be idempotent — if instances already exist, don't create duplicates (check before insert)

---

## Summary

| Phase | Tasks | Key Artifacts |
|-------|-------|---------------|
| 1. Database | 1.1→1.9 | Migration `20260529000001_checklist_evidence.sql`, test `checklist_evidence_test.sql` |
| 2. Backend | 2.1→2.4 | `rxdb.js` (5 collections), `checklistAdapter.js`, `useChecklists.js` |
| 3. Frontend | 3.1→3.8 | FocusModeModal/Card/Progress/Result, modified WorkOrderDrawer/Actions |

### Dependency Graph

```
Phase 1 (sequential):
  1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
                                          ↘
  1.7 ── depends on 1.1, 1.2, 1.6          → 1.9 ── depends on 1.6
  1.8 ── depends on 1.3, 1.4, 1.5

Phase 2:
  2.1 ── depends on 1.1
  2.2 ── depends on 1.2
  2.3 ── standalone
  2.4 ── depends on 2.1, 2.3

Phase 3:
  3.1 ── standalone
  3.2 ── standalone
  3.3 ── standalone
  3.4 ── depends on 3.1, 3.2, 3.3, 2.4, 2.3
  3.5 ── depends on 3.4, 2.4
  3.6 ── standalone (modified)
  3.7 ── standalone (modified)
  3.8 ── depends on 2.4, 2.1
```

### Edge Cases to Watch

| Edge Case | Where Handled | Mechanism |
|-----------|--------------|-----------|
| NO_APLICA overrides FAIL → PASS | [1.3] trigger, [2.3] validation | DB trigger is authoritative |
| FALTA_HERRAMIENTA etc. excluded from level SUM | [1.4] trigger | SQL filter clause |
| Legacy NULL trust_score = 1.0 | [1.4] trigger | COALESCE |
| Legacy NULL causa_falla = regular FAIL | [1.4] trigger | NOT IN filtered, NULL not in set |
| Sampling determinism | [2.4] hook, [1.9] test | Deterministic hash function |
| Block C hidden if level < 3 | [2.4] getVisibleBlocks, [1.9] test | Level check before instance creation |
| 60d grace → HARD transition | [1.5] trigger | First violation timestamp + interval |
| SOFT gate → is_auditable flag set | [1.5] trigger | SET NEW.is_auditable = true |
| Optional items skipped | [3.4] FocusModeModal, [2.3] validation | Filter out null responses before submit |
| Idempotent instance creation | [3.8] sampling resolution | Check before insert |
