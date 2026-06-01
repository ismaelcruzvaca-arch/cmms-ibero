# Competency Engine Specification

## Purpose

Define how proficiency levels are calculated from evidence and how skill requirements enforce competency warnings on work order assignments. The engine computes `technician_skills.current_level` automatically and provides a `check_competency_for_assignment()` function for soft-lock validation.

## Requirements

### Requirement: Proficiency Levels Catalog

The system MUST define 5 fixed proficiency levels.

| Level | Name | Trigger Description |
|-------|------|-------------------|
| 1 | Awareness | induccion_completada = true |
| 2 | Assisted | Any PASS evidence at nivel_evaluado = 2 |
| 3 | Independent | SUM(trust_score) >= 5 in Block B evidence |
| 4 | Specialist | Any PASS evidence at nivel_evaluado = 4 |
| 5 | Master | autor_estandar = true |

(Previously: Level 3 described as "5+ PASS evidence at nivel_evaluado = 3 (same module)". Updated to trust-weighted SUM.)

#### Scenario: All levels seeded

- GIVEN the migration has been applied
- WHEN querying `proficiency_levels`
- THEN exactly 5 rows exist with levels 1 through 5

### Requirement: Automatic Level Calculation

The system MUST calculate `technician_skills.current_level` as the MAX of all achieved levels per technician+module pair. Level 3 count SHALL use SUM(trust_score) instead of COUNT(*) for weighted qualification. Evidence with `causa_falla_id` IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION) SHALL NOT count against competence (status=false is filtered from FAIL count but PASS evidence is unaffected).

Achievement rules:
- Level 1 if `technician_module_progress.induccion_completada = true`
- Level 2 if EXISTS any evidence with `nivel_evaluado=2 AND status=true`
- Level 3 if SUM(trust_score) for evidence with `nivel_evaluado=3 AND status=true` >= 5
- Level 4 if EXISTS any evidence with `nivel_evaluado=4 AND status=true`
- Level 5 if `technician_module_progress.autor_estandar = true`

FAIL filtering: Evidence with `status=false AND causa_falla_id IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION)` SHALL be excluded entirely from level 3 SUM calculation. All other FAILs (BRECHA_CONOCIMIENTO, DESVIACION_DISCIPLINARIA, NULL causa_falla) SHALL count as regular FAILs (not added to SUM).

(Previously: Level 3 required COUNT of evidence with `nivel_evaluado=3 AND status=true >= 5`. No trust_score weighting. No causa_falla filtering.)

#### Scenario: Level 2 from single evidence

- GIVEN a technician has `induccion_completada=true` for module M-PACK
- AND 1 PASS evidence at nivel_evaluado=2 on the same module
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 2`

#### Scenario: Level 3 with trust_score weighting

- GIVEN a technician has 10 PASS evidence at nivel_evaluado=3, all with `trust_score=0.5` (SELF)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` which is >= 5
- AND `technician_skills.current_level = 3`

#### Scenario: Level 3 threshold not met with low trust

- GIVEN a technician has 8 PASS evidence at nivel_evaluado=3, all with `trust_score=0.5` (SELF)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 4.0` which is < 5
- AND `technician_skills.current_level` is NOT 3

#### Scenario: Level 4 from single specialist evidence

- GIVEN a technician has `induccion_completada=true`
- AND sufficient PASS evidence at nivel_evaluado=3 AND 1 PASS evidence at nivel_evaluado=4
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 4` (MAX of 1, 3, 4)

#### Scenario: Level 5 from autor_estandar

- GIVEN a technician has `autor_estandar=true` for module M-PACK
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 5`

#### Scenario: FAIL with FALTA_HERRAMIENTA excluded from count

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 (trust_score=1.0 each)
- AND 3 FAIL evidence at nivel_evaluado=3 with causa_falla=FALTA_HERRAMIENTA
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (FAILs excluded)
- AND `technician_skills.current_level = 3`

#### Scenario: FAIL with BRECHA_CONOCIMIENTO counts as regular FAIL

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 (trust_score=1.0 each)
- AND 2 FAIL evidence with causa_falla=BRECHA_CONOCIMIENTO
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (BRECHA_CONOCIMIENTO FAILs do not add to SUM)
- AND the BRECHA_CONOCIMIENTO FAILs are recorded but do not reduce the SUM

#### Scenario: Legacy NULL trust_score treated as 1.0

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3 with `trust_score IS NULL` (legacy)
- WHEN level calculation triggers
- THEN `SUM(trust_score)` treats each NULL as 1.0
- AND `SUM(trust_score) = 5.0`
- AND `technician_skills.current_level = 3`

#### Scenario: Legacy NULL causa_falla counts as regular FAIL

- GIVEN a technician has 5 PASS evidence at nivel_evaluado=3
- AND 1 FAIL evidence at nivel_evaluado=3 with `causa_falla_id IS NULL` (legacy)
- WHEN level calculation triggers
- THEN `SUM(trust_score) = 5.0` (legacy FAIL with NULL causa_falla is a regular FAIL — not added to SUM)
- AND `technician_skills.current_level = 3`

#### Scenario: NO_APLICA evidence counts as PASS

- GIVEN a checklist item_response with `status='FAIL'` and `causa_falla_id=NO_APLICA`
- WHEN `trg_checklist_to_evidence` fires
- THEN the evidence row has `status=true`
- AND when level calculation triggers, this counts toward PASS SUM

### Requirement: Skill Requirements

The system MUST allow defining minimum proficiency level per skill for job plans.

#### Scenario: Skill requirement assigned to job plan

- GIVEN a job_plan exists
- WHEN a PLANNER inserts a row in `skill_requirements` with `job_plan_id`, `skill_id`, `minimum_level_required=3`
- THEN the requirement is stored

### Requirement: Soft-Lock on Assignment

The system MUST provide an overloaded function `check_competency_for_assignment(technician_id UUID, work_order_id TEXT, strict BOOLEAN DEFAULT false)`. When strict=false (default), returns a JSON warning (NOT a hard block). When strict=true, RAISES EXCEPTION if the technician's level is below the minimum required. The existing 2-parameter call `(technician_id, work_order_id)` MUST continue to work unchanged (strict=false).

(Previously: single 2-parameter function returning JSON warning only)

#### Scenario: Technician below minimum — strict mode raises exception

- GIVEN a work_order with skill_requirement `minimum_level_required=3`
- AND the assigned technician has `current_level=2` for the matching skill
- WHEN `check_competency_for_assignment(tech_id, wo_id, true)` is called
- THEN the function RAISES EXCEPTION with message containing `current_level=2`, `required_level=3`, and the module name

#### Scenario: Technician below minimum — non-strict returns warning

- GIVEN a work_order with skill_requirement `minimum_level_required=3`
- AND the assigned technician has `current_level=2` for the matching skill
- WHEN `check_competency_for_assignment(tech_id, wo_id)` is called (2-parameter form)
- THEN the function returns `{'status': 'WARNING', ...}` with message "Technician level 2 is below the required minimum 3"

#### Scenario: Technician meets minimum — strict mode passes

- GIVEN a work_order with skill_requirement `minimum_level_required=3`
- AND the assigned technician has `current_level=4` for the matching skill
- WHEN `check_competency_for_assignment(tech_id, wo_id, true)` is called
- THEN the function returns `{'status': 'OK'}`

#### Scenario: No skill requirement defined — both modes pass

- GIVEN a work_order with NO matching `skill_requirements`
- WHEN `check_competency_for_assignment()` is called with either strict=false or strict=true
- THEN the function returns `{'status': 'OK'}`

#### Scenario: Existing callers unchanged

- GIVEN an existing caller invokes `check_competency_for_assignment(tech_id, wo_id)` with 2 arguments
- WHEN the function executes
- THEN it behaves identically to pre-change behavior (strict=false default)

### Requirement: Backward Compatibility Guarantee

The overload MUST NOT break any existing callers. The 3-parameter signature MUST be additive only.

#### Scenario: All existing callers resolve to 2-parameter form

- GIVEN a codebase with existing calls to `check_competency_for_assignment(tech_id, wo_id)`
- WHEN the migration is applied
- THEN all calls continue to resolve to the original behavior (strict=false)
