# Competency Evidence Specification

## Purpose

Define how skill evidence (checklist results, module progress flags) is recorded into the system. Evidence is the raw input that the competency engine consumes to calculate proficiency levels. PLANNER and ADMIN roles manage evidence; TECHNICIAN role is read-only.

## Requirements

### Requirement: Technological Modules

The system MUST maintain a catalog of 8 technological modules with unique codes.

| Code | Name | Description |
|------|------|-------------|
| M-PACK | Empaque | Packaging machinery |
| M-TRAN | Transporte | Conveyors, elevators, transport |
| M-ELEC | Eléctrico | Electrical systems and panels |
| M-REFR | Refrigeración | Cooling and refrigeration |
| M-VAPO | Vapor y Calderas | Steam and boilers (merged M-CAL) |
| M-PUMP | Bombas | Pumps (lobular, Cavemill, etc.) |
| M-TÉRM | Térmico | Thermal processing equipment |
| M-INFR | Infraestructura | Facilities and infrastructure |

#### Scenario: Seed modules exist after migration

- GIVEN the migration has been applied
- WHEN querying `technological_modules`
- THEN exactly 8 rows exist with the codes above

#### Scenario: Asset linked to module

- GIVEN an asset exists
- WHEN `module_id` is set to a valid technological_modules id
- THEN the asset is associated with that module for competency tracing

### Requirement: Record Skill Evidence

The system MUST allow PLANNER/ADMIN to insert rows into `technician_skill_evidence` with `nivel_evaluado` IN (2, 3, 4) and `status` BOOLEAN (true = PASS).

#### Scenario: PLANNER records PASS evidence

- GIVEN a PLANNER is authenticated
- AND a valid work_order, technician, and asset exist
- WHEN the PLANNER inserts evidence with `modulo_gema='M-PACK'`, `nivel_evaluado=2`, `item_evaluado='Lubricación correcta'`, `status=true`
- THEN a row is created in `technician_skill_evidence` with `evaluated_at` set to NOW()

#### Scenario: TECHNICIAN cannot insert evidence

- GIVEN a TECHNICIAN is authenticated
- WHEN they attempt to INSERT into `technician_skill_evidence`
- THEN the row is rejected (RLS policy violation)

#### Scenario: Invalid nivel_evaluado rejected

- GIVEN any user attempts to insert evidence
- WHEN `nivel_evaluado` is 1 or 5
- THEN the CHECK constraint rejects the row (nivel_evaluado must be 2, 3, or 4)

### Requirement: Module Progress Flags

The system MUST track `induccion_completada` and `autor_estandar` per technician+module pair in `technician_module_progress`.

#### Scenario: PLANNER activates induction flag

- GIVEN a PLANNER is authenticated
- WHEN they UPDATE `induccion_completada=true` for a technician+module pair
- THEN the row is created/updated with `updated_at=NOW()` and `updated_by` set to the PLANNER

#### Scenario: Unique technician-module constraint

- GIVEN a record exists for technician T and module M
- WHEN a second insert for the same pair is attempted
- THEN the UNIQUE constraint rejects the duplicate

### Requirement: Evidence Auditability

Every evidence row SHOULD record who evaluated (`evaluated_by` FK) and when (`evaluated_at` TIMESTAMPTZ default NOW()).

#### Scenario: Evaluator recorded automatically

- GIVEN a PLANNER inserts evidence
- WHEN the row is created
- THEN `evaluated_by` equals the PLANNER's UUID AND `evaluated_at` is NOT NULL
