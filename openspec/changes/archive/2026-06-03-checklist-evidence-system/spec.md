# Spec: Checklist Evidence System

## Purpose

Build a structured checklist system that captures field evidence (PASS/FAIL + causa_falla) from work order execution and feeds qualified evidence into the Competency Engine. Resolves the 3 Blind Spots: (1) **causa_falla** — why it failed, not just that it failed; (2) **evaluator_source** — who evaluates determines evidence weight; (3) **sampling** — click fatigue via deterministic sampling per module+block.

---

## Capability: Checklist Evidence

### Requirement: Causa Falla Catalog

The system MUST maintain a fixed catalog of 6 failure-cause codes seeded by migration (ADMIN-only CRUD for future expansion).

| Code | Name | Description |
|------|------|-------------|
| BRECHA_CONOCIMIENTO | Brecha de Conocimiento | Technician lacks skill — triggers training |
| FALTA_HERRAMIENTA | Falta de Herramienta | Specialized tool missing/damaged — triggers purchase |
| DESVIACION_DISCIPLINARIA | Desviación Disciplinaria | Technician skipped step intentionally — triggers admin action |
| FALTA_REPUESTO | Falta de Repuesto | Spare part missing/defective — triggers purchasing audit |
| ERROR_DOCUMENTACION | Error de Documentación | SOP/LUP outdated or wrong — triggers standard revision |
| NO_APLICA | No Aplica | Step optional per order context — neutral for competency |

**Schema**:

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | UNIQUE NOT NULL |
| name | TEXT | NOT NULL |
| description | TEXT | |

#### Scenario: Seed causes after migration

```
GIVEN the migration has been applied
WHEN querying causa_falla_catalog
THEN exactly 6 rows exist with the codes above
```

#### Scenario: NO_APLICA is neutro

```
GIVEN a checklist item response with status='FAIL' and causa_falla_id = NO_APLICA
WHEN trg_checklist_to_evidence fires
THEN the evidence SHALL be recorded as PASS (status=true)
AND the NO_APLICA causa_falla_id SHALL be preserved for traceability
```

### Requirement: Checklist Template Definition

Templates per technological module, with optional override per `job_plan`. Each module+block combination allows exactly one default template and optionally one per job_plan.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| code | TEXT | UNIQUE NOT NULL (e.g. CHK-MPACK-A-001) |
| description | TEXT | NOT NULL |
| module_id | UUID | NOT NULL FK → technological_modules(id) |
| job_plan_id | UUID | FK → job_plans(id), NULLABLE |
| block_type | TEXT | NOT NULL CHECK IN ('A', 'B', 'C') |
| sampling_rate | INT | DEFAULT 1, CHECK (0–100) |
| is_auditable | BOOLEAN | DEFAULT false |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

Unique partial indexes:
- `(module_id, block_type) WHERE job_plan_id IS NULL`
- `(module_id, job_plan_id, block_type) WHERE job_plan_id IS NOT NULL`

**Block types**: A (Safety/LOTO → level 2), B (Execution → level 3), C (Precision → level 4).

**Sampling**: `1` = always, `3` = 1 of every 3 WOs, `0` = only if WO is auditable.

#### Scenario: Module-wide template created

```
GIVEN a PLANNER creates a template for M-PACK Block A with no job_plan
WHEN resolving templates for a WO in M-PACK
THEN it applies to ALL work orders in M-PACK that have no job_plan-specific override
```

#### Scenario: Job-plan override takes priority

```
GIVEN a module-wide template exists for M-PACK Block A
AND a job_plan-specific template exists for the same module+block
WHEN resolving templates for a WO with that job_plan
THEN the job_plan-specific template SHALL be used
```

### Requirement: Checklist Template Items

Ordered items per template with configurable response type and evidence requirements.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| checklist_template_id | UUID | NOT NULL FK → checklist_templates(id) ON DELETE CASCADE |
| step_sequence | INT | NOT NULL |
| item_text | TEXT | NOT NULL |
| item_type | TEXT | DEFAULT 'PASS_FAIL', CHECK IN ('PASS_FAIL', 'MEASUREMENT', 'YES_NO', 'TEXT') |
| requires_photo | BOOLEAN | DEFAULT false |
| requires_comment | BOOLEAN | DEFAULT false |
| optional | BOOLEAN | DEFAULT false |
| UNIQUE | (checklist_template_id, step_sequence) | |

**Item types**: `PASS_FAIL` (binary pass/fail), `MEASUREMENT` (numeric value), `YES_NO` (boolean), `TEXT` (free text comment).

#### Scenario: Items resolved by step_sequence

```
GIVEN a template with items at step_sequence 1-5
WHEN Focus Mode loads items
THEN items SHALL display in ascending step_sequence order
```

#### Scenario: Optional item skipped

```
GIVEN an item with optional=true
WHEN the technician skips it
THEN the checklist SHALL still be submittable
AND skipped optional items SHALL NOT be recorded in checklist_item_responses
```

### Requirement: Checklist Instances

Runtime instance per template per work order. Created at WO open time. Completion triggers evidence feeding.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_order_id | TEXT | NOT NULL FK → work_orders(id) |
| checklist_template_id | UUID | NOT NULL FK → checklist_templates(id) |
| technician_id | UUID | NOT NULL FK → user_profiles(id) |
| asset_id | TEXT | NOT NULL FK → assets(id) |
| evaluator_source | TEXT | NOT NULL DEFAULT 'SELF', CHECK IN ('SELF', 'SUPERVISOR', 'PEER') |
| evaluated_by | UUID | NOT NULL DEFAULT auth.uid(), FK → user_profiles(id) |
| verified_by | UUID | FK → user_profiles(id) |
| verified_at | TIMESTAMPTZ | |
| status | TEXT | NOT NULL DEFAULT 'IN_PROGRESS', CHECK IN ('IN_PROGRESS', 'COMPLETED', 'VOID') |
| started_at | TIMESTAMPTZ | DEFAULT NOW() |
| completed_at | TIMESTAMPTZ | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**evaluator_source** determines trust: SELF=0.5, PEER=0.8, SUPERVISOR=1.0.

#### Scenario: Technician starts a checklist

```
GIVEN a technician opens Focus Mode for a WO
WHEN the template is resolved
THEN a checklist_instance SHALL be created with status='IN_PROGRESS'
```

#### Scenario: Completed instance triggers evidence

```
GIVEN a checklist_instance is COMPLETED with 2 PASS and 1 FAIL with FALTA_HERRAMIENTA
WHEN trg_checklist_to_evidence fires (AFTER UPDATE)
THEN ONE row SHALL be inserted into technician_skill_evidence
AND status SHALL be false (because at least one FAIL exists)
AND causa_falla_id SHALL be the FIRST FAIL's causa_falla
```

#### Scenario: NO_APLICA overrides FAIL to PASS

```
GIVEN a checklist_instance has ALL items FAIL + NO_APLICA
WHEN trg_checklist_to_evidence fires
THEN the evidence row SHALL have status=true (aggregate PASS)
AND causa_falla_id = the NO_APLICA record's causa_falla_id
```

### Requirement: Checklist Item Responses

Individual item results within an instance.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| checklist_instance_id | UUID | NOT NULL FK → checklist_instances(id) ON DELETE CASCADE |
| template_item_id | UUID | NOT NULL FK → checklist_template_items(id) |
| status | TEXT | NOT NULL CHECK IN ('PASS', 'FAIL', 'NA', 'SKIPPED') |
| causa_falla_id | UUID | FK → causa_falla_catalog(id) |
| comment | TEXT | |
| photo_url | TEXT | |
| measurement_value | NUMERIC | |
| answered_at | TIMESTAMPTZ | DEFAULT NOW() |
| UNIQUE | (checklist_instance_id, template_item_id) | |

#### Scenario: FAIL requires causa_falla

```
GIVEN a technician sets an item to FAIL
WHEN submitting the checklist
THEN causa_falla_id MUST be provided
AND the submission SHOULD be validated client-side before sending
```

### Requirement: Sampling Configuration

Global override for sampling rates per module+block, without modifying templates.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| module_id | UUID | FK → technological_modules(id) |
| job_plan_id | UUID | FK → job_plans(id) |
| block_type | TEXT | NOT NULL CHECK IN ('A', 'B', 'C') |
| default_sampling_rate | INT | DEFAULT 1, CHECK (0–100) |
| is_auditable_only | BOOLEAN | DEFAULT false |
| is_active | BOOLEAN | DEFAULT true |
| UNIQUE | (module_id, job_plan_id, block_type) | |

#### Scenario: Sampling config overrides template

```
GIVEN a template has sampling_rate=3
AND a sampling_config exists for that module+block with default_sampling_rate=10
WHEN resolving sampling for a WO
THEN effective_rate = 10 (config overrides template)
```

---

## Capability: Competency Evidence (Delta)

### Requirement: New Columns on technician_skill_evidence

| Column | Type | Constraints |
|--------|------|-------------|
| evaluation_source | TEXT | CHECK IN ('SELF', 'SUPERVISOR', 'PEER') |
| causa_falla_id | UUID | FK → causa_falla_catalog(id) |
| trust_score | NUMERIC | DEFAULT 1.0, CHECK (0–1) |

Legacy NULL behavior: `trust_score IS NULL` treated as `1.0`, `causa_falla_id IS NULL` = regular FAIL.

### Requirement: New Columns on work_orders

| Column | Type | Constraints |
|--------|------|-------------|
| is_auditable | BOOLEAN | DEFAULT false |
| audit_reason | TEXT | |

---

## Capability: Competency Engine (Delta)

### Requirement: Trigger trg_checklist_to_evidence

SECURITY DEFINER function on `checklist_instances` AFTER UPDATE WHEN `NEW.status = 'COMPLETED'`.

**Aggregation logic**:
- Iterates all item responses for the completed instance
- If ANY item has `status='FAIL'` AND `causa_falla_code != 'NO_APLICA'` → evidence `status=false`
- If ALL FAILs are NO_APLICA → evidence `status=true` (override)
- Uses the FIRST non-null `causa_falla_id` found across responses
- Block→nivel mapping: A→2, B→3, C→4
- trust_score from evaluator_source: SELF=0.5, PEER=0.8, SUPERVISOR=1.0
- Inserts ONE aggregated row per instance

#### Scenario: Aggregated evidence

```
GIVEN a Block B checklist with 12 items (10 PASS, 2 FAIL with BRECHA_CONOCIMIENTO)
WHEN trg_checklist_to_evidence fires
THEN 1 row inserted into technician_skill_evidence
AND status = false (at least one real FAIL)
AND nivel_evaluado = 3 (Block B)
AND trust_score = evaluator_source mapping
```

### Requirement: Modified trg_recalculate_technician_level

Level 3 calculation changes from `COUNT(*)` to `SUM(COALESCE(trust_score, 1.0))`. Threshold remains >= 5.

Evidence with `causa_falla_id` IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION) SHALL NOT count toward level 3 PASS SUM — these are external factors, not the technician's fault.

#### Scenario: Trust-weighted level 3

```
GIVEN a technician has 10 PASS at nivel_evaluado=3 with trust_score=0.5 each (SELF)
WHEN level calculation runs
THEN SUM = 5.0 >= 5
AND current_level = 3
```

#### Scenario: External factor FAIL excluded

```
GIVEN a technician has 5 PASS at nivel_evaluado=3 (trust=1.0)
AND 3 FAIL with FALTA_HERRAMIENTA
WHEN level calculation runs
THEN SUM = 5.0 (FAILs excluded)
AND current_level = 3
```

---

## Non-Functional Requirements

| Requirement | Constraint |
|---|---|
| RLS | All 6 new tables have row-level security per role matrix |
| Audit | `checklist_instances` and `checklist_item_responses` have audit triggers |
| Idempotency | All DDL uses IF NOT EXISTS / DROP IF EXISTS |
| Backward compat | Legacy NULL trust_score = 1.0, legacy NULL causa_falla = regular FAIL |
| Trigger security | `trg_checklist_to_evidence` is SECURITY DEFINER (bypasses RLS) |
