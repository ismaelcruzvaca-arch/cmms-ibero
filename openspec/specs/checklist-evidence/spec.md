# Checklist Evidence Specification

## Purpose

Define the structured checklist system that captures field evidence (PASS/FAIL + causa_falla) from work order execution and feeds it into the Competency Engine. This is the raw input layer — templates define what to check, sampling reduces click fatigue, and a trigger converts completed checklists into skill evidence.

## Requirements

### Requirement: Causa Falla Catalog

The system MUST maintain a fixed catalog of 6 failure-cause codes. The catalog SHALL be seeded by migration and SHALL NOT be user-editable (ADMIN-only CRUD for future expansion).

| Code | Description |
|------|-------------|
| BRECHA_CONOCIMIENTO | Knowledge gap — technician lacks skill/knowledge |
| FALTA_HERRAMIENTA | Missing tool or equipment |
| DESVIACION_DISCIPLINARIA | Procedure not followed (disciplinary) |
| FALTA_REPUESTO | Missing spare part |
| ERROR_DOCUMENTACION | Documentation error (LUP, standard, diagram) |
| NO_APLICA | Item not applicable in this context (neutro for competency) |

#### Scenario: Seed causes after migration

- GIVEN the migration has been applied
- WHEN querying `causa_falla_catalog`
- THEN exactly 6 rows exist with the codes above

#### Scenario: NO_APLICA is neutro

- GIVEN a checklist item response with `causa_falla_id = NO_APLICA`
- WHEN the trigger feeds evidence to technician_skill_evidence
- THEN the evidence SHALL be recorded as PASS (status=true) regardless of the item status — NO_APLICA overrides FAIL

### Requirement: Checklist Template Definition

The system MUST define checklist templates per technological module, with optional override per job_plan.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| module_id | UUID | FK → technological_modules(id) |
| job_plan_id | UUID | FK → job_plans(id), NULLABLE |
| block | TEXT | NOT NULL, CHECK IN ('A', 'B', 'C') |
| title | TEXT | NOT NULL |
| description | TEXT | NULLABLE |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

Unique constraint: `UNIQUE(module_id, job_plan_id, block)` where `job_plan_id IS NOT NULL`; for module-wide templates, `UNIQUE(module_id, block)` where `job_plan_id IS NULL`.

#### Scenario: Module-wide template created

- GIVEN a PLANNER creates a template for M-PACK, Block A, with no job_plan
- WHEN the template is inserted
- THEN it applies to ALL work orders in M-PACK that have no job_plan-specific override

#### Scenario: Job-plan override takes priority

- GIVEN a module-wide template exists for M-PACK Block A
- AND a job_plan-specific template exists for the same module+block
- WHEN resolving templates for a work order with that job_plan
- THEN the job_plan-specific template SHALL be used (not the module-wide one)

### Requirement: Checklist Template Items

Each template SHALL have ordered items with configurable metadata.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| template_id | UUID | FK → checklist_templates(id) ON DELETE CASCADE |
| step_sequence | INT | NOT NULL |
| item_text | TEXT | NOT NULL |
| item_type | TEXT | NOT NULL DEFAULT 'safety', CHECK IN ('safety', 'procedure', 'quality', 'precision') |
| requires_photo | BOOLEAN | DEFAULT false |
| requires_comment | BOOLEAN | DEFAULT false |
| optional | BOOLEAN | DEFAULT false |

Unique constraint: `UNIQUE(template_id, step_sequence)`.

#### Scenario: Ordered items resolved by step_sequence

- GIVEN a template with 5 items at step_sequence 1-5
- WHEN the Focus Mode loads items
- THEN items SHALL display in ascending step_sequence order (1 → 5)

#### Scenario: Optional item skipped does not block

- GIVEN an item with `optional=true`
- WHEN the technician skips it (no PASS/FAIL selected)
- THEN the checklist SHALL still be submittable
- AND skipped optional items SHALL NOT be recorded in checklist_item_responses

### Requirement: Sampling Configuration

The system MUST define sampling rates per module+block pair to control which work orders require checklists.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| module_id | UUID | FK → technological_modules(id) |
| block | TEXT | NOT NULL, CHECK IN ('A', 'B', 'C') |
| sampling_rate | INT | NOT NULL, CHECK (sampling_rate BETWEEN 1 AND 100), DEFAULT 100 |
| is_active | BOOLEAN | DEFAULT true |

Unique constraint: `UNIQUE(module_id, block)`. Rate `100` means always sample (deterministic hash always matches). Rate `0` means never sample.

#### Scenario: Sampling rate 100 means always

- GIVEN `sampling_rate = 100` for M-PACK Block A
- WHEN resolving templates for any work order in M-PACK
- THEN the Block A template SHALL always apply

#### Scenario: Sampling rate 0 means never

- GIVEN `sampling_rate = 0` for M-PACK Block C
- WHEN resolving templates for any work order in M-PACK
- THEN the Block C template SHALL never apply

#### Scenario: Deterministic hash sampling

- GIVEN `sampling_rate = 20` for M-PACK Block B
- WHEN resolving templates for work order WO-001 and WO-002
- THEN `(hash(wo.id || template.id) % 100) < 20` determines inclusion
- AND the same work order SHALL always get the same result (deterministic)

### Requirement: Block C Visibility Gate

Block C checklists SHALL only be visible when the assigned technician has `current_level >= 3` in the work order's module.

#### Scenario: Level below 3 hides Block C

- GIVEN a work order in module M-PACK
- AND the assigned technician has `current_level = 2` in M-PACK
- WHEN resolving templates at WO open time
- THEN Block C template SHALL NOT be applied (invisible)

#### Scenario: Level 3 or above shows Block C

- GIVEN a work order in module M-PACK
- AND the assigned technician has `current_level >= 3` in M-PACK
- WHEN resolving templates at WO open time
- THEN Block C template SHALL be applied (if sampling matches)

### Requirement: Checklist Instances

Each completed checklist becomes an instance recording who evaluated, using what trust model, and optionally who verified.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| work_order_id | TEXT | NOT NULL FK → work_orders(id) |
| technician_id | UUID | NOT NULL FK → user_profiles(id) |
| template_id | UUID | NOT NULL FK → checklist_templates(id) |
| asset_id | TEXT | NOT NULL FK → assets(id) |
| evaluator_source | TEXT | NOT NULL, CHECK IN ('SELF', 'SUPERVISOR', 'PEER'), DEFAULT 'SELF' |
| verified_by | UUID | NULLABLE FK → user_profiles(id) |
| status | TEXT | NOT NULL, CHECK IN ('IN_PROGRESS', 'COMPLETED', 'VOID') |
| started_at | TIMESTAMPTZ | DEFAULT NOW() |
| completed_at | TIMESTAMPTZ | NULLABLE |

#### Scenario: Technician starts a checklist

- GIVEN a technician opens Focus Mode for a work order
- WHEN the template is resolved
- THEN a checklist_instance SHALL be created with status='IN_PROGRESS'

#### Scenario: SELF evaluator gets trust=0.5

- GIVEN a checklist_instance with `evaluator_source='SELF'`
- WHEN `trg_checklist_to_evidence` fires
- THEN each evidence row SHALL have `trust_score=0.5`

#### Scenario: SUPERVISOR evaluator gets trust=1.0

- GIVEN a checklist_instance with `evaluator_source='SUPERVISOR'`
- WHEN `trg_checklist_to_evidence` fires
- THEN each evidence row SHALL have `trust_score=1.0`

#### Scenario: PEER evaluator gets trust=0.8

- GIVEN a checklist_instance with `evaluator_source='PEER'`
- WHEN `trg_checklist_to_evidence` fires
- THEN each evidence row SHALL have `trust_score=0.8`

### Requirement: Checklist Item Responses

Individual item results within a checklist instance.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| checklist_instance_id | UUID | NOT NULL FK → checklist_instances(id) ON DELETE CASCADE |
| template_item_id | UUID | NOT NULL FK → checklist_template_items(id) |
| status | TEXT | NOT NULL, CHECK IN ('PASS', 'FAIL') |
| causa_falla_id | UUID | NULLABLE FK → causa_falla_catalog(id) |
| photo_url | TEXT | NULLABLE |
| comment | TEXT | NULLABLE |
| responded_at | TIMESTAMPTZ | DEFAULT NOW() |

NOTE: `causa_falla_id` MUST NOT be NULL when `status='FAIL'` — enforced at insert by trigger or application logic.

#### Scenario: FAIL requires causa_falla

- GIVEN a technician sets an item to FAIL
- WHEN submitting the checklist
- THEN `causa_falla_id` MUST be provided
- AND submission SHALL be rejected if causa_falla is missing for a FAIL

#### Scenario: PASS with optional causa_falla

- GIVEN a technician sets an item to PASS
- WHEN submitting the checklist
- THEN `causa_falla_id` MAY be NULL (not required for PASS)

### Requirement: Trigger trg_checklist_to_evidence

The system MUST provide `trg_checklist_to_evidence` (AFTER UPDATE ON checklist_instances WHEN status='COMPLETED') that converts completed checklist item responses into `technician_skill_evidence` rows.

Mapping rules:
- Each item_response with `status='PASS'` → `technician_skill_evidence.status=true`
- Each item_response with `status='FAIL'` → `technician_skill_evidence.status=false`
- `modulo_gema` resolved from template → module
- `nivel_evaluado`: Block A=2, Block B=3, Block C=4
- `evaluation_source`, `trust_score` from checklist_instances
- `causa_falla_id` from item_response
- Items with `causa_falla = NO_APLICA` SHALL be recorded as PASS (status=true)

#### Scenario: Completed checklist feeds evidence

- GIVEN a checklist_instance with 3 items (2 PASS, 1 FAIL with FALTA_HERRAMIENTA)
- WHEN status transitions to 'COMPLETED'
- THEN 3 rows SHALL be inserted into technician_skill_evidence
- AND the FAIL row SHALL have `status=false` and `causa_falla_id=FALTA_HERRAMIENTA`

#### Scenario: NO_APLICA overrides FAIL

- GIVEN a checklist item_response with `status='FAIL'` and `causa_falla_id=NO_APLICA`
- WHEN the trigger fires
- THEN the evidence row SHALL have `status=true` (PASS)
- AND `causa_falla_id=NO_APLICA`

### Requirement: Row Level Security

The system MUST enforce RLS on all new tables.

| Table | TECHNICIAN | PLANNER | ADMIN |
|-------|-----------|---------|-------|
| causa_falla_catalog | SELECT | SELECT | ALL |
| checklist_templates | SELECT | INSERT/SELECT/UPDATE | ALL |
| checklist_template_items | SELECT | INSERT/SELECT/UPDATE | ALL |
| checklist_instances | INSERT (own), SELECT (own), UPDATE (own) | ALL | ALL |
| checklist_item_responses | INSERT (own), SELECT (own) | ALL | ALL |
| checklist_sampling_config | SELECT | SELECT/UPDATE | ALL |

#### Scenario: TECHNICIAN inserts own checklist

- GIVEN a TECHNICIAN is authenticated
- WHEN they INSERT a checklist_instance with their own `technician_id`
- THEN the row SHALL be created successfully

#### Scenario: TECHNICIAN cannot read another's checklist

- GIVEN a TECHNICIAN is authenticated
- WHEN they SELECT a checklist_instance where `technician_id != auth.uid()`
- THEN the row SHALL NOT be returned (RLS filter)

#### Scenario: PLANNER reads all checklists

- GIVEN a PLANNER is authenticated
- WHEN they SELECT checklist_instances
- THEN ALL rows SHALL be returned regardless of technician_id
