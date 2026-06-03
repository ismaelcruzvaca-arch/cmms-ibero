# Competency Evidence Specification

## Purpose

Define how skill evidence (checklist results, module progress flags) is recorded into the system. Evidence is the raw input that the competency engine consumes to calculate proficiency levels. PLANNER and ADMIN roles manage evidence; TECHNICIAN role is read-only except via SECURITY DEFINER trigger.

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

### Requirement: Evaluation Source Columns

The `technician_skill_evidence` table MUST add three new columns to support qualified evidence from checklist evaluation:

| Column | Type | Constraints |
|--------|------|-------------|
| evaluation_source | TEXT | NULLABLE, CHECK IN ('SELF', 'SUPERVISOR', 'PEER'), DEFAULT 'SELF' |
| causa_falla_id | UUID | NULLABLE FK → causa_falla_catalog(id) |
| trust_score | NUMERIC | NULLABLE, CHECK (trust_score BETWEEN 0 AND 1) |

Legacy NULL behavior:
- `trust_score IS NULL` SHALL be treated as `1.0` (full trust) for backward compatibility
- `causa_falla_id IS NULL` SHALL count as a regular FAIL for competency calculation

#### Scenario: New columns default to NULL for legacy

- GIVEN existing rows in technician_skill_evidence from before this migration
- WHEN the migration adds the columns
- THEN all existing rows SHALL have `evaluation_source=NULL`, `causa_falla_id=NULL`, `trust_score=NULL`
- AND the engine SHALL treat NULL trust_score as 1.0

#### Scenario: SELF evaluation recorded with trust_score

- GIVEN a checklist_instance completes with `evaluator_source='SELF'`
- WHEN `trg_checklist_to_evidence` inserts evidence
- THEN `evaluation_source='SELF'` AND `trust_score=0.5`

### Requirement: Record Skill Evidence

The system MUST allow PLANNER/ADMIN to insert rows into `technician_skill_evidence` with `nivel_evaluado` IN (2, 3, 4) and `status` BOOLEAN (true = PASS). The trigger `trg_checklist_to_evidence` (SECURITY DEFINER) MAY also insert rows on behalf of TECHNICIAN users.
(Previously: Only PLANNER/ADMIN could insert evidence directly. No trigger-based insert existed.)

#### Scenario: PLANNER records PASS evidence with new columns

- GIVEN a PLANNER is authenticated
- AND a valid work_order, technician, and asset exist
- WHEN the PLANNER inserts evidence with `modulo_gema='M-PACK'`, `nivel_evaluado=2`, `status=true`, `evaluation_source='SUPERVISOR'`, `trust_score=1.0`
- THEN a row is created in `technician_skill_evidence` with the new columns populated

#### Scenario: TECHNICIAN cannot insert evidence directly

- GIVEN a TECHNICIAN is authenticated
- WHEN they attempt to INSERT into `technician_skill_evidence`
- THEN the row is rejected (RLS policy violation), even with the new columns
- AND the only way TECHNICIAN evidence is created is via the SECURITY DEFINER trigger

#### Scenario: Invalid evaluation_source rejected

- GIVEN any user attempts to insert evidence
- WHEN `evaluation_source` is 'MANAGER' (not in allowed values)
- THEN the CHECK constraint rejects the row

#### Scenario: Invalid trust_score rejected

- GIVEN any user attempts to insert evidence
- WHEN `trust_score = 1.5` (outside 0-1 range)
- THEN the CHECK constraint rejects the row

### Requirement: RLS Modification — TECHNICIAN Insert

The RLS policy on `technician_skill_evidence` MUST be modified to allow INSERT by the trigger (SECURITY DEFINER) and SELECT for all authenticated roles.

The trigger `trg_checklist_to_evidence` SHALL be SECURITY DEFINER — it SHALL bypass RLS when inserting evidence rows. Direct INSERT by any user SHALL remain restricted to PLANNER/ADMIN.

#### Scenario: Trigger inserts evidence bypassing RLS

- GIVEN a TECHNICIAN completes a checklist
- WHEN `trg_checklist_to_evidence` fires (SECURITY DEFINER)
- THEN the evidence rows SHALL be inserted successfully even though the TECHNICIAN has no direct INSERT permission

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
