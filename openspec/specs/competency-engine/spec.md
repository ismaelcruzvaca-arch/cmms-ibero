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
| 3 | Independent | 5+ PASS evidence at nivel_evaluado = 3 (same module) |
| 4 | Specialist | Any PASS evidence at nivel_evaluado = 4 |
| 5 | Master | autor_estandar = true |

#### Scenario: All levels seeded

- GIVEN the migration has been applied
- WHEN querying `proficiency_levels`
- THEN exactly 5 rows exist with levels 1 through 5

### Requirement: Automatic Level Calculation

The system MUST calculate `technician_skills.current_level` as the MAX of all achieved levels per technician+module pair.

Achievement rules:
- Level 1 if `technician_module_progress.induccion_completada = true`
- Level 2 if EXISTS any evidence with `nivel_evaluado=2 AND status=true`
- Level 3 if COUNT of evidence with `nivel_evaluado=3 AND status=true` >= 5
- Level 4 if EXISTS any evidence with `nivel_evaluado=4 AND status=true`
- Level 5 if `technician_module_progress.autor_estandar = true`

#### Scenario: Level 2 from single evidence

- GIVEN a technician has `induccion_completada=true` for module M-PACK
- AND 1 PASS evidence at nivel_evaluado=2 on the same module
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 2`

#### Scenario: Level 3 requires 5 evidence items

- GIVEN a technician has 4 PASS evidence items at nivel_evaluado=3 for module M-PACK
- WHEN level calculation triggers
- THEN `technician_skills.current_level` is NOT 3 (threshold not met)

#### Scenario: Level 4 from single specialist evidence

- GIVEN a technician has `induccion_completada=true`
- AND 5 PASS evidence at nivel_evaluado=3 AND 1 PASS evidence at nivel_evaluado=4
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 4` (MAX of 1, 3, 4)

#### Scenario: Level 5 from autor_estandar

- GIVEN a technician has `autor_estandar=true` for module M-PACK
- WHEN level calculation triggers
- THEN `technician_skills.current_level = 5`

### Requirement: Skill Requirements

The system MUST allow defining minimum proficiency level per skill for job plans.

#### Scenario: Skill requirement assigned to job plan

- GIVEN a job_plan exists
- WHEN a PLANNER inserts a row in `skill_requirements` with `job_plan_id`, `skill_id`, `minimum_level_required=3`
- THEN the requirement is stored

### Requirement: Soft-Lock on Assignment

The system MUST provide a function `check_competency_for_assignment(technician_id, work_order_id)` that returns a warning (NOT a hard block) when the technician's current level is below the minimum required.

#### Scenario: Technician below minimum — returns warning

- GIVEN a work_order with skill_requirement `minimum_level_required=3`
- AND the assigned technician has `current_level=2` for the matching skill
- WHEN `check_competency_for_assignment()` is called
- THEN the function returns a warning: "Technician level 2 is below the required minimum 3 for this work order"

#### Scenario: Technician meets minimum — returns OK

- GIVEN a work_order with skill_requirement `minimum_level_required=3`
- AND the assigned technician has `current_level=4` for the matching skill
- WHEN `check_competency_for_assignment()` is called
- THEN the function returns OK with no warning

#### Scenario: No skill requirement defined — passes silently

- GIVEN a work_order with NO matching `skill_requirements`
- WHEN `check_competency_for_assignment()` is called
- THEN the function returns OK (no requirement to check)
