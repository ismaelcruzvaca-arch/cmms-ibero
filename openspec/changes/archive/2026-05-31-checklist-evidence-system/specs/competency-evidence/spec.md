# Delta for competency-evidence

## ADDED Requirements

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

### Requirement: RLS Modification — TECHNICIAN Insert

The RLS policy on `technician_skill_evidence` MUST be modified to allow INSERT by the trigger (SECURITY DEFINER) and SELECT for all authenticated roles.

The trigger `trg_checklist_to_evidence` SHALL be SECURITY DEFINER — it SHALL bypass RLS when inserting evidence rows. Direct INSERT by any user SHALL remain restricted to PLANNER/ADMIN.

#### Scenario: Trigger inserts evidence bypassing RLS

- GIVEN a TECHNICIAN completes a checklist
- WHEN `trg_checklist_to_evidence` fires (SECURITY DEFINER)
- THEN the evidence rows SHALL be inserted successfully even though the TECHNICIAN has no direct INSERT permission

## MODIFIED Requirements

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
