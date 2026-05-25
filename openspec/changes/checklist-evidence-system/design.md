# Design: Checklist Evidence System

## Technical Approach

Two-layer architecture: (1) SQL migration builds 6 new tables + modifies 2 existing + 2 triggers, (2) frontend adds Focus Mode modal + lifecycle gates on INPRG→COMP. Sampling reduces click fatigue via deterministic hash. Completed checklists feed `technician_skill_evidence` via SECURITY DEFINER trigger, which chains into existing `trg_recalculate_technician_level` modified for trust-weighted SUM.

**Map to specs**: checklist-evidence (tables/triggers), competency-evidence (ALTER columns + RLS), competency-engine (SUM trust_score), mechanic-work-order-execution (Focus Mode + gates).

---

## Architecture Decisions

### Decision: Instance creation at APPROVED→INPRG

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Create at Focus Mode open | Delays RxDB sync, gate can't pre-check | ❌ |
| Create at APPROVED→INPRG | Gate can check instances immediately, sampling resolved once | ✅ |

**Rationale**: The lifecycle gate needs to know which checklist instances exist BEFORE the drawer opens. Creating at APPROVED→INPRG ensures `checklist_instances` with IN_PROGRESS exist by the time the technician opens the drawer. Focus Mode reads existing instances.

### Decision: Gate logic in BEFORE UPDATE trigger, not FSM

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Modify `validate_lifecycle_fsm` | Tangles FSM with checklist logic, harder to test | ❌ |
| Separate `trg_checklist_gate` BEFORE UPDATE | Clean separation, follows `trg_validate_labor_fsm` pattern | ✅ |

**Rationale**: Existing labor_records trigger `trg_validate_labor_fsm` is a separate BEFORE INSERT/UPDATE trigger. Following the same pattern for checklist gates keeps concerns separated. Fires BEFORE the FSM trigger.

### Decision: Sampling at template + config override

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Sampling only in `checklist_sampling_config` | Every template needs config entry, extra JOIN | ❌ |
| Sampling rate on template + config override | Templates have defaults, config can override per module+block | ✅ |

**Rationale**: Templates carry a default `sampling_rate`. The `checklist_sampling_config` table allows per-module+block overrides. If no config entry exists, template's own rate applies. Config with `default_sampling_rate=NULL` means "use template's rate."

### Decision: NO_APLICA override in trigger, not app logic

| Option | Tradeoff | Decision |
|--------|----------|----------|
| App enforces before submit | Client-side can be bypassed, extra validation needed | ❌ |
| Trigger handles it | Single source of truth, SECURITY DEFINER guarantees enforcement | ✅ |

**Rationale**: The trigger `trg_checklist_to_evidence` converts FAIL+NO_APLICA → PASS at the DB level. This is authoritative and cannot be bypassed.

### Decision: Focus Mode as full-screen modal, not Drawer extension

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Expand the 420px Drawer | Too narrow for one-question-at-a-time, poor mobile UX | ❌ |
| Full-screen modal | Dedicated space, large touch targets, proper progress UX | ✅ |

**Rationale**: The Drawer is 420px. A checklist with 12+ items and large PASS/FAIL buttons needs full screen. Spec explicitly requires "full-screen modal, NOT in the 420px drawer."

---

## Data Flow

```
APPROVED → INPRG (server trigger)
  │
  ├─ resolveChecklists(wo, technician)
  │    ├─ get module from asset
  │    ├─ find active templates (module-wide + job_plan override)
  │    ├─ apply deterministic hash sampling
  │    ├─ gate Block C by technician level >= 3
  │    └─ create checklist_instances (IN_PROGRESS)
  │
  ▼
Technician opens Drawer (INPRG)
  │
  ├─ WorkOrderActions checks checklist_instances:
  │   ├─ Block A exists AND NOT completed → show "Begin Close-Out", disable "Completar"
  │   ├─ Block A COMPLETED with FAIL → block "Completar", show error
  │   ├─ Block B/C uncompleted → SOFT 60d or HARD
  │   └─ All PASS → enable "Completar"
  │
  └─ "Begin Close-Out" clicked → FocusModeModal opens
       │
       ├─ Loads template items from checklist_template_items
       ├─ One question at a time (PASS/FAIL + optional causa_falla)
       ├─ On submit:
       │   ├─ INSERT checklist_item_responses
       │   └─ UPDATE checklist_instances.status = 'COMPLETED'
       │
       ▼
       trg_checklist_to_evidence (AFTER UPDATE, SECURITY DEFINER)
         │
         ├─ Reads item_responses for this instance
         ├─ Maps block to nivel_evaluado (A→2, B→3, C→4)
         ├─ NO_APLICA → status=true (override FAIL)
         ├─ trust_score = f(evaluator_source): SELF=0.5, PEER=0.8, SUPERVISOR=1.0
         └─ INSERT INTO technician_skill_evidence
              │
              ▼
              trg_recalculate_technician_level (AFTER INSERT, existing)
                └─ SUM(COALESCE(trust_score,1.0)) >= 5 for level 3
                   Filter: exclude PASS with causa_falla IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION)
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260529000001_checklist_evidence.sql` | Create | 6 tables, 2 ALTER TABLE, 2 trigger functions, RLS, audit |
| `src/lib/rxdb.js` | Modify | Add 5 RxDB collection schemas + replication handlers |
| `src/hooks/useChecklists.js` | Create | Checklist hooks: resolve sampling, submit, get visible blocks |
| `src/components/mechanic/FocusModeModal.jsx` | Create | Full-screen modal, one question at a time |
| `src/components/mechanic/FocusModeCard.jsx` | Create | Single question card with PASS/FAIL + causa_falla |
| `src/components/mechanic/FocusModeProgress.jsx` | Create | Step indicator "Item 3 de 12" |
| `src/components/mechanic/FocusModeResult.jsx` | Create | Summary with PASS/FAIL per block |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modify | Add "Begin Close-Out" button, gate-aware Completar |
| `src/components/mechanic/WorkOrderActions.jsx` | Modify | Accept checklist state, disable Completar with tooltip |
| `src/lib/adapters/workOrderAdapter.js` | Modify | Add checklist validation to `validateCompletion()` |

---

## 1. Migration Structure

File: `supabase/migrations/20260529000001_checklist_evidence.sql`

### Section 1: Causa Falla Catalog

```sql
CREATE TABLE IF NOT EXISTS causa_falla_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

COMMENT ON TABLE causa_falla_catalog IS 'Catálogo fijo de causas de falla para checklist';
COMMENT ON COLUMN causa_falla_catalog.code IS 'Código único: BRECHA_CONOCIMIENTO, FALTA_HERRAMIENTA, DESVIACION_DISCIPLINARIA, FALTA_REPUESTO, ERROR_DOCUMENTACION, NO_APLICA';
COMMENT ON COLUMN causa_falla_catalog.description IS 'Descripción legible de la causa';

INSERT INTO causa_falla_catalog (code, description) VALUES
  ('BRECHA_CONOCIMIENTO', 'Falta de conocimiento/habilidad del técnico'),
  ('FALTA_HERRAMIENTA', 'Falta de herramienta o equipo'),
  ('DESVIACION_DISCIPLINARIA', 'Procedimiento no seguido (disciplinario)'),
  ('FALTA_REPUESTO', 'Falta de repuesto'),
  ('ERROR_DOCUMENTACION', 'Error en documentación (LUP, estándar, diagrama)'),
  ('NO_APLICA', 'Ítem no aplica en este contexto (neutro para competencia)')
ON CONFLICT (code) DO NOTHING;
```

### Section 2: Checklist Template Tables

```sql
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES technological_modules(id),
  job_plan_id UUID REFERENCES job_plans(id),
  block TEXT NOT NULL CHECK (block IN ('A', 'B', 'C')),
  title TEXT NOT NULL,
  description TEXT,
  sampling_rate INT NOT NULL DEFAULT 100 CHECK (sampling_rate BETWEEN 0 AND 100),
  is_auditable BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: module-wide (job_plan_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_templates_module_block
  ON checklist_templates(module_id, block) WHERE job_plan_id IS NULL;

-- Unique constraint: job_plan-specific override
CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_templates_jobplan_block
  ON checklist_templates(module_id, job_plan_id, block) WHERE job_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  step_sequence INT NOT NULL,
  item_text TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'safety' CHECK (item_type IN ('safety', 'procedure', 'quality', 'precision')),
  requires_photo BOOLEAN DEFAULT false,
  requires_comment BOOLEAN DEFAULT false,
  optional BOOLEAN DEFAULT false,
  UNIQUE(template_id, step_sequence)
);
```

### Section 3: Runtime Instance Tables

```sql
CREATE TABLE IF NOT EXISTS checklist_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  template_id UUID NOT NULL REFERENCES checklist_templates(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  evaluator_source TEXT NOT NULL DEFAULT 'SELF' CHECK (evaluator_source IN ('SELF', 'SUPERVISOR', 'PEER')),
  evaluated_by UUID NOT NULL DEFAULT auth.uid() REFERENCES user_profiles(id),
  verified_by UUID REFERENCES user_profiles(id),
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'VOID')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checklist_instances_wo ON checklist_instances(work_order_id);
CREATE INDEX IF NOT EXISTS idx_checklist_instances_tech ON checklist_instances(technician_id);
CREATE INDEX IF NOT EXISTS idx_checklist_instances_status ON checklist_instances(status);

CREATE TABLE IF NOT EXISTS checklist_item_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_instance_id UUID NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  template_item_id UUID NOT NULL REFERENCES checklist_template_items(id),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  causa_falla_id UUID REFERENCES causa_falla_catalog(id),
  photo_url TEXT,
  comment TEXT,
  measurement_value NUMERIC,
  responded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_responses_instance ON checklist_item_responses(checklist_instance_id);
```

### Section 4: Sampling Config

```sql
CREATE TABLE IF NOT EXISTS checklist_sampling_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES technological_modules(id),
  job_plan_id UUID REFERENCES job_plans(id),
  block TEXT NOT NULL CHECK (block IN ('A', 'B', 'C')),
  default_sampling_rate INT CHECK (default_sampling_rate BETWEEN 0 AND 100),
  is_auditable_only BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(module_id, job_plan_id, block)
);
```

### Section 5: ALTER technician_skill_evidence

```sql
ALTER TABLE technician_skill_evidence
  ADD COLUMN IF NOT EXISTS evaluation_source TEXT CHECK (evaluation_source IN ('SELF', 'SUPERVISOR', 'PEER')),
  ADD COLUMN IF NOT EXISTS causa_falla_id UUID REFERENCES causa_falla_catalog(id),
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC CHECK (trust_score BETWEEN 0 AND 1);

COMMENT ON COLUMN technician_skill_evidence.evaluation_source IS 'Fuente de evaluación: SELF, SUPERVISOR, PEER. NULL para evidencia legacy (pre-checklist)';
COMMENT ON COLUMN technician_skill_evidence.causa_falla_id IS 'Causa de falla asociada. NULL para PASS o evidencia legacy. NO_APLICA sobreescribe FAIL→PASS';
COMMENT ON COLUMN technician_skill_evidence.trust_score IS 'Peso de confianza: SELF=0.5, PEER=0.8, SUPERVISOR=1.0. NULL se trata como 1.0 (legacy)';
```

### Section 6: ALTER work_orders

```sql
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS is_auditable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_reason TEXT;

COMMENT ON COLUMN work_orders.is_auditable IS 'TRUE si la OT requiere auditoría por soft-gate violation';
COMMENT ON COLUMN work_orders.audit_reason IS 'Razón por la que la OT fue marcada como auditable';
```

### Section 7: Trigger trg_checklist_to_evidence

```sql
CREATE OR REPLACE FUNCTION trg_checklist_to_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_modulo_gema TEXT;
  v_block TEXT;
  v_nivel_evaluado INT;
  v_item RECORD;
  v_item_text TEXT;
  v_trust_score NUMERIC;
  v_effective_status BOOLEAN;
BEGIN
  IF NEW.status != 'COMPLETED' THEN
    RETURN NEW;
  END IF;

  -- Resolve module code from template
  SELECT m.code, ct.block INTO v_modulo_gema, v_block
  FROM checklist_templates ct
  JOIN technological_modules m ON m.id = ct.module_id
  WHERE ct.id = NEW.template_id;

  IF v_modulo_gema IS NULL THEN
    RAISE WARNING 'Cannot resolve module for template %', NEW.template_id;
    RETURN NEW;
  END IF;

  -- Map block to nivel_evaluado
  v_nivel_evaluado := CASE v_block
    WHEN 'A' THEN 2
    WHEN 'B' THEN 3
    WHEN 'C' THEN 4
  END;

  -- Resolve trust_score from evaluator_source
  v_trust_score := CASE NEW.evaluator_source
    WHEN 'SELF' THEN 0.5
    WHEN 'PEER' THEN 0.8
    WHEN 'SUPERVISOR' THEN 1.0
    ELSE 1.0
  END;

  -- Iterate item responses
  FOR v_item IN
    SELECT cir.*, cfc.code AS causa_falla_code
    FROM checklist_item_responses cir
    LEFT JOIN causa_falla_catalog cfc ON cfc.id = cir.causa_falla_id
    WHERE cir.checklist_instance_id = NEW.id
  LOOP
    -- Get item text from template
    SELECT item_text INTO v_item_text
    FROM checklist_template_items
    WHERE id = v_item.template_item_id;

    -- NO_APLICA overrides FAIL → PASS
    IF v_item.causa_falla_code = 'NO_APLICA' THEN
      v_effective_status := true;
    ELSE
      v_effective_status := (v_item.status = 'PASS');
    END IF;

    INSERT INTO technician_skill_evidence (
      work_order_id, technician_id, asset_id,
      modulo_gema, nivel_evaluado, item_evaluado,
      status, evaluated_at, evaluated_by,
      evaluation_source, causa_falla_id, trust_score
    ) VALUES (
      NEW.work_order_id, NEW.technician_id, NEW.asset_id,
      v_modulo_gema, v_nivel_evaluado, v_item_text,
      v_effective_status, COALESCE(NEW.completed_at, NOW()), NEW.evaluated_by,
      NEW.evaluator_source, v_item.causa_falla_id, v_trust_score
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checklist_to_evidence ON checklist_instances;
CREATE TRIGGER trg_checklist_to_evidence
  AFTER UPDATE ON checklist_instances
  FOR EACH ROW
  WHEN (NEW.status = 'COMPLETED')
  EXECUTE FUNCTION trg_checklist_to_evidence();
```

### Section 8: Modify trg_recalculate_technician_level

Replace the level 3 calculation (within `trg_recalculate_technician_level()` and `trg_update_module_progress()`):

```sql
-- OLD: COUNT(*) for level 3
-- SELECT COUNT(*) INTO v_lv3_count FROM technician_skill_evidence
-- WHERE technician_id = NEW.technician_id AND modulo_gema = NEW.modulo_gema
--   AND nivel_evaluado = 3 AND status = true;

-- NEW: SUM(trust_score) with causa_falla filtering
SELECT COALESCE(SUM(COALESCE(tse.trust_score, 1.0)), 0) INTO v_lv3_count
FROM technician_skill_evidence tse
LEFT JOIN causa_falla_catalog cfc ON cfc.id = tse.causa_falla_id
WHERE tse.technician_id = NEW.technician_id
  AND tse.modulo_gema = NEW.modulo_gema
  AND tse.nivel_evaluado = 3
  AND tse.status = true
  AND (tse.causa_falla_id IS NULL OR cfc.code NOT IN ('FALTA_HERRAMIENTA', 'FALTA_REPUESTO', 'ERROR_DOCUMENTACION'));

-- Condition stays: >= 5 (now with trust-weighted SUM)
IF v_lv3_count >= 5 THEN v_level := GREATEST(v_level, 3); END IF;
```

Apply same change to `trg_update_module_progress()` for consistency.

### Section 9: RLS Policies

```
Table                    TECHNICIAN          PLANNER             ADMIN
───────────────────────  ──────────────────  ──────────────────  ────
causa_falla_catalog      SELECT              SELECT              ALL
checklist_templates      SELECT              INSERT/SELECT/UPD   ALL
checklist_template_items SELECT              INSERT/SELECT/UPD   ALL
checklist_sampling_config SELECT             SELECT/UPDATE       ALL
checklist_instances      INSERT/SELECT/UPD   ALL                 ALL
                         (own technician_id)
checklist_item_responses INSERT/SELECT       ALL                 ALL
                         (own via instance)
```

Pattern: select-all for authenticated (get_user_role IN ('TECHNICIAN','PLANNER','ADMIN')), write restricted by role. TECHNICIAN can only operate on instances where `technician_id = auth.uid()`.

### Section 10: Audit Triggers

```sql
DROP TRIGGER IF EXISTS checklist_instances_audit ON checklist_instances;
CREATE TRIGGER checklist_instances_audit
  AFTER INSERT OR UPDATE OR DELETE ON checklist_instances
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS checklist_item_responses_audit ON checklist_item_responses;
CREATE TRIGGER checklist_item_responses_audit
  AFTER INSERT OR UPDATE OR DELETE ON checklist_item_responses
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

---

## 2. RxDB Collections

Add to `src/lib/rxdb.js` `addCollections()`:

### Collection: causa_falla_catalog
- **Version**: 0
- **Primary key**: `id` (string, maxLength 50)
- **Push/Pull**: Pull-only (read from server, never created by client)
- **Schema fields**: id, code, description
- **Replication**: `createPullHandler('causa_falla_catalog', 'id')`

### Collection: checklist_templates
- **Version**: 0
- **Primary key**: `id` (string, maxLength 50)
- **Push/Pull**: Pull-only (read-only for technicians)
- **Schema fields**: id, module_id, job_plan_id, block, title, description, sampling_rate, is_auditable, is_active, created_at
- **Replication**: `createPullHandler('checklist_templates', 'created_at')`

### Collection: checklist_instances
- **Version**: 0
- **Primary key**: `id` (string, maxLength 50)
- **Push/Pull**: Pull + Push (created locally by Focus Mode submit, synced to server)
- **Schema fields**: id, work_order_id, technician_id, template_id, asset_id, evaluator_source, evaluated_by, verified_by, verified_at, status, started_at, completed_at, _deleted
- **Push fields**: all above
- **Replication**: Pull handler filters by `technician_id = auth.uid()` (like labor_records), push handler is standard

### Collection: checklist_item_responses
- **Version**: 0
- **Primary key**: `id` (string, maxLength 50)
- **Push/Pull**: Pull + Push
- **Schema fields**: id, checklist_instance_id, template_item_id, status, causa_falla_id, photo_url, comment, measurement_value, responded_at, _deleted
- **Replication**: Pull handler filters by instance's technician_id (join-based or application-level filter)

### Collection: checklist_sampling_config
- **Version**: 0
- **Primary key**: `id` (string, maxLength 50)
- **Push/Pull**: Pull-only
- **Schema fields**: id, module_id, job_plan_id, block, default_sampling_rate, is_auditable_only, is_active
- **Replication**: `createPullHandler('checklist_sampling_config', 'id')`

---

## 3. Hook API

### `src/hooks/useChecklists.js`

```javascript
/**
 * Resolve which templates apply to a work order.
 * Called at APPROVED→INPRG transition and when drawer opens.
 * @param {string} workOrderId
 * @returns {Promise<Array<{template, block, samplingRate}>>}
 */
async function resolveTemplatesForWO(workOrderId) { ... }

/**
 * Get which blocks are visible based on technician's current level.
 * @param {string} technicianId
 * @param {string} moduleCode - e.g. 'M-PACK'
 * @returns {Promise<string[]>} e.g. ['A', 'B'] (no 'C' if level < 3)
 */
async function getVisibleBlocks(technicianId, moduleCode) { ... }

/**
 * Create checklist instances for resolved templates.
 * Called at APPROVED→INPRG.
 * @param {string} workOrderId
 * @param {Array<{template, block}>} resolvedTemplates
 * @returns {Promise<{success: boolean, instances: Array}>}
 */
async function createChecklistInstances(woId, templates) { ... }

/**
 * Get existing checklist instances for a work order (used by gate logic).
 * @param {string} workOrderId
 * @returns {Promise<Array<checklistInstance>>}
 */
async function getChecklistInstances(woId) { ... }

/**
 * Submit a completed checklist (called by Focus Mode on submit).
 * Creates item_responses and updates instance to COMPLETED.
 * @param {Object} payload - { instanceId, items: Array<{itemId, status, causaFallaId, photoUrl?, comment?}> }
 * @returns {Promise<{success: boolean, errors?: string[]}>}
 */
async function submitChecklist(payload) { ... }

/**
 * Check if INPRG→COMP transition is allowed (gate logic).
 * @param {string} workOrderId
 * @returns {Promise<{allowed: boolean, blocks: Array<{block, status, reason?}>}>}
 */
async function checkLifecycleGate(woId) { ... }

/**
 * Get sampling config overrides for a module+block combination.
 * @param {string} moduleId
 * @param {string} block
 * @returns {Promise<{default_sampling_rate, is_auditable_only}>}
 */
async function getSamplingConfig(moduleId, block) { ... }
```

### Sampling Resolution Algorithm (inline)

```
function resolveChecklists(workOrder, technician):
  1. Get job_plan_id from workOrder
  2. Get module_id from workOrder.asset_id (resolve asset → technological_modules)
  3. Find active templates where:
     module_id = resolved_module_id AND is_active = true AND
     (job_plan_id IS NULL OR job_plan_id = workOrder.job_plan_id)
     → If both module-wide and job_plan-specific exist for same block,
       job_plan-specific overrides (applied by priority in frontend or DISTINCT ON)
  4. For each template:
     a. Get sampling_rate from template
     b. Check checklist_sampling_config for override (module_id + block)
        If override exists: use override.default_sampling_rate
        If is_auditable_only AND NOT workOrder.is_auditable → SKIP
     c. If effective_rate == 0 → SKIP
     d. If effective_rate < 100:
        hash = deterministicHash(wo.id + template.id) % 100
        if hash >= effective_rate → SKIP
     e. If template.block == 'C':
        tech_level = getTechnicianLevel(technician_id, module_code)
        if tech_level < 3 → SKIP
  5. Return filtered templates
```

---

## 4. Component Hierarchy

```
WorkOrderDrawer (modified)
  ├── "Iniciar Cierre" button (new) when instances exist AND Block A not complete
  ├── WorkOrderActions (modified)
  │     └── "Completar" disabled with tooltip when checklist pending
  └──
FocusModeModal (new) — rendered outside Drawer, full-screen <Dialog>
  ├── FocusModeProgress — "Item N de M — Bloque A"
  ├── FocusModeCard — current question
  │     ├── Large PASS button (#4caf50)
  │     ├── Large FAIL button (#f44336)
  │     ├── CausaFallaSelector (shown on FAIL)
  │     │     └── 6 radio buttons from causa_falla_catalog
  │     ├── PhotoCapture (if requires_photo)
  │     └── CommentField (if requires_comment)
  ├── Navigation (Next / Back)
  └── FocusModeResult — summary screen
        ├── Item list with PASS/FAIL badges
        ├── Block A result: 🟢 PASS or 🔴 FAIL (gates block)
        ├── Block B/C result: 🟢 PASS or 🟡 SOFT warning or 🔴 HARD
        └── "Submit" button → save + close modal
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `FocusModeModal` | Full-screen Dialog wrapper, fetches instances+items, manages response state array, orchestrates FocusModeCard/Progress/Result, calls `submitChecklist` on completion |
| `FocusModeCard` | Renders single item, PASS/FAIL buttons, conditionally shows causa_falla selector (required on FAIL), photo button, comment textarea. Validates that FAIL has cause before allowing next |
| `FocusModeProgress` | Reads currentIndex + totalItems + block info, renders "Item 3 de 12 — Bloque A" with linear progress |
| `FocusModeResult` | Receives accumulator of all responses, groups by block, renders PASS/FAIL per block, explains gate implications, shows Submit button |
| `CausaFallaSelector` | Fetches from `causa_falla_catalog` RxDB collection, renders 6 large touch-friendly options |

---

## 5. Lifecycle Gate Logic

### INPRG→COMP Gate (BEFORE UPDATE trigger on work_orders)

```sql
-- New separate trigger function: trg_validate_checklist_gate
CREATE OR REPLACE FUNCTION trg_validate_checklist_gate()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_block RECORD;
  v_block_a_incomplete BOOLEAN;
  v_block_a_failed BOOLEAN;
  v_block_b_missing BOOLEAN;
  v_block_c_missing BOOLEAN;
  v_module_code TEXT;
  v_grace_expired BOOLEAN;
  v_first_violation TIMESTAMPTZ;
BEGIN
  -- Only apply on INPRG → COMP
  IF NOT (OLD.lifecycle_phase = 'INPRG' AND NEW.lifecycle_phase = 'COMP') THEN
    RETURN NEW;
  END IF;

  -- Check Block A: HARD gate
  SELECT EXISTS(
    SELECT 1 FROM checklist_instances ci
    JOIN checklist_templates ct ON ct.id = ci.template_id
    WHERE ci.work_order_id = NEW.id
      AND ct.block = 'A'
      AND ci.status != 'COMPLETED'
  ) INTO v_block_a_incomplete;

  IF v_block_a_incomplete THEN
    RAISE EXCEPTION 'Completá el checklist de seguridad (Bloque A) antes de finalizar';
  END IF;

  -- Check Block A: all items PASS? (if completed but has FAIL)
  SELECT EXISTS(
    SELECT 1 FROM checklist_instances ci
    JOIN checklist_templates ct ON ct.id = ci.template_id
    JOIN checklist_item_responses cir ON cir.checklist_instance_id = ci.id
    WHERE ci.work_order_id = NEW.id
      AND ct.block = 'A'
      AND ci.status = 'COMPLETED'
      AND cir.status = 'FAIL'
      AND (cir.causa_falla_id IS NULL OR (
        SELECT code FROM causa_falla_catalog WHERE id = cir.causa_falla_id
      ) != 'NO_APLICA')
  ) INTO v_block_a_failed;

  IF v_block_a_failed THEN
    RAISE EXCEPTION 'El checklist Bloque A tiene ítems FAIL — revisalos antes de finalizar';
  END IF;

  -- Check Block B/C: SOFT gate with 60d grace → HARD
  -- Get module code for grace period lookup
  SELECT tm.code INTO v_module_code
  FROM assets a
  JOIN technological_modules tm ON tm.id = a.module_id
  WHERE a.id = NEW.asset_id;

  FOR v_block IN
    SELECT DISTINCT ct.block
    FROM checklist_templates ct
    JOIN checklist_instances ci ON ci.template_id = ct.id
    WHERE ci.work_order_id = NEW.id
      AND ct.block IN ('B', 'C')
      AND ci.status != 'COMPLETED'
  LOOP
    -- Check if grace period has expired for this module+block
    -- First violation date is stored in a grace_period_tracker table or computed
    SELECT MIN(wo.completed_at) INTO v_first_violation
    FROM work_orders wo
    WHERE wo.is_auditable = true
      AND wo.id IN (
        SELECT ci2.work_order_id
        FROM checklist_instances ci2
        JOIN checklist_templates ct2 ON ct2.id = ci2.template_id
        WHERE ct2.block = v_block.block
      );

    -- If first violation > 60 days ago → HARD
    IF v_first_violation IS NOT NULL
       AND v_first_violation < NOW() - INTERVAL '60 days'
    THEN
      RAISE EXCEPTION 'El checklist Bloque % es obligatorio — contactá a tu supervisor',
        v_block.block;
    END IF;

    -- Within grace period: SOFT → allow, set audit flag
    NEW.is_auditable := true;
    NEW.audit_reason := CONCAT(
      'Bloque ', v_block.block,
      ' checklist required but not completed at close-out'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_checklist_gate ON work_orders;
CREATE TRIGGER trg_validate_checklist_gate
  BEFORE UPDATE ON work_orders
  FOR EACH ROW
  WHEN (OLD.lifecycle_phase IS DISTINCT FROM NEW.lifecycle_phase)
  EXECUTE FUNCTION trg_validate_checklist_gate();
```

### Frontend Gate (WorkOrderDrawer)

```javascript
// In WorkOrderDrawer, when lifecyclePhase === 'INPRG':
const checklistGate = await checkLifecycleGate(workOrder.id);

// If Block A exists and is NOT completed → show "Begin Close-Out", disable "Completar"
if (checklistGate.blocks.some(b => b.block === 'A' && b.status === 'INCOMPLETE')) {
  // Show "Iniciar Cierre" button → opens FocusModeModal
  // "Completar" button disabled with tooltip
}

// If Block A completed but has FAIL → block
if (checklistGate.blocks.some(b => b.block === 'A' && b.status === 'FAIL')) {
  // Show error, disable Completar
}

// If Block B/C missing and within grace → SOFT (allow with warning)
if (checklistGate.blocks.some(b => b.block !== 'A' && b.status === 'MISSING' && b.soft)) {
  // Allow Completar but show warning + will set audit flag
  // Warning: "El checklist Bloque B/C no fue completado. Se marcará para auditoría."
}

// If Block B/C missing and grace expired → HARD
if (checklistGate.blocks.some(b => b.block !== 'A' && b.status === 'MISSING' && !b.soft)) {
  // Block Completar, show "Contactá a tu supervisor"
}
```

---

## 6. RLS Matrix

| Table | Operation | TECHNICIAN | PLANNER | ADMIN |
|-------|-----------|------------|---------|-------|
| causa_falla_catalog | SELECT | ✅ ALL | ✅ ALL | ✅ ALL |
| | INSERT | ❌ | ❌ | ✅ |
| | UPDATE | ❌ | ❌ | ✅ |
| | DELETE | ❌ | ❌ | ✅ |
| checklist_templates | SELECT | ✅ ALL | ✅ ALL | ✅ ALL |
| | INSERT | ❌ | ✅ | ✅ |
| | UPDATE | ❌ | ✅ | ✅ |
| | DELETE | ❌ | ❌ | ✅ |
| checklist_template_items | SELECT | ✅ ALL | ✅ ALL | ✅ ALL |
| | INSERT | ❌ | ✅ | ✅ |
| | UPDATE | ❌ | ✅ | ✅ |
| | DELETE | ❌ | ❌ | ✅ |
| checklist_sampling_config | SELECT | ✅ ALL | ✅ ALL | ✅ ALL |
| | INSERT | ❌ | ❌ | ✅ |
| | UPDATE | ❌ | ✅ | ✅ |
| | DELETE | ❌ | ❌ | ✅ |
| checklist_instances | SELECT | ✅ own tech | ✅ ALL | ✅ ALL |
| | INSERT | ✅ own tech | ✅ ALL | ✅ ALL |
| | UPDATE | ✅ own tech | ✅ ALL | ✅ ALL |
| | DELETE | ❌ | ❌ | ✅ |
| checklist_item_responses | SELECT | ✅ own (via instance) | ✅ ALL | ✅ ALL |
| | INSERT | ✅ own (via instance) | ✅ ALL | ✅ ALL |
| | UPDATE | ❌ | ✅ | ✅ |
| | DELETE | ❌ | ❌ | ✅ |

Note: "own tech" = `technician_id = auth.uid()`. The trigger `trg_checklist_to_evidence` is SECURITY DEFINER — it bypasses RLS when inserting into `technician_skill_evidence`.

---

## 7. Migration Order and Dependencies

```
20260522000003_work_orders_iso14224_production.sql  (lifecycle_phase type)
    ↑
20260528000002_competency_engine.sql                (technician_skill_evidence, trg_recalculate_technician_level)
    ↑
20260529000001_checklist_evidence.sql  ← THIS MIGRATION
    │
    ├─ Depends on: technological_modules, job_plans, user_profiles, assets, work_orders
    ├─ Depends on: causa_falla_catalog (self-contained)
    ├─ Depends on: technician_skill_evidence (for ALTER)
    ├─ Modifies: trg_recalculate_technician_level, trg_update_module_progress
    └─ Creates: trg_validate_checklist_gate (BEFORE UPDATE on work_orders)
```

IMPORTANT: `20260529000001_checklist_evidence.sql` must run AFTER `20260528000002_competency_engine.sql` because it modifies the trigger functions created there.

The `trg_validate_checklist_gate` fires BEFORE `validate_lifecycle_fsm` (alphabetical? — both are BEFORE UPDATE with WHEN clause; execution order depends on creation order; the checklist gate is created later but both are BEFORE UPDATE. We need the checklist gate to fire FIRST. Solution: add `SET CONSTRAINTS` or ensure the checklist gate explicitly returns NEW before falling through to FSM validation. Since we keep the existing FSM trigger and add a new one, both fire. If our gate raises an exception, the FSM never runs. If our gate passes, FSM validates the transition. This is correct behavior.)
