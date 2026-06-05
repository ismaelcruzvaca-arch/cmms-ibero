# Spec: competency-engine

## Capabilities Referenced

- `competency-engine` (new) — `openspec/specs/competency-engine/spec.md` — proficiency levels, automatic calculation, soft-lock
- `competency-evidence` (new) — `openspec/specs/competency-evidence/spec.md` — evidence table, module progress flags

## Requirements Implemented

### R1: Technological Modules Catalog

8 modules seeded with codes M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-PUMP, M-TÉRM, M-INFR. Column `module_id` added to `assets` as nullable FK.

#### Scenarios verified
- [x] `technological_modules` has 8 seed rows after migration 01
- [x] `assets.module_id` FK references `technological_modules(id)`
- [x] All authenticated roles can SELECT the catalog
- [x] Only ADMIN can INSERT/UPDATE/DELETE

### R2: Proficiency Levels Catalog

5 fixed levels (1–5) with CHECK constraint and trigger descriptions.

| Level | Name | Rule |
|-------|------|------|
| 1 | Awareness | `induccion_completada = true` |
| 2 | Assisted | Any PASS evidence at `nivel_evaluado = 2` |
| 3 | Independent | 5+ PASS evidence at `nivel_evaluado = 3` |
| 4 | Specialist | Any PASS evidence at `nivel_evaluado = 4` |
| 5 | Master | `autor_estandar = true` |

#### Scenarios verified
- [x] `proficiency_levels` has 5 seed rows after migration 02
- [x] Level is calculated as MAX of all achieved levels

### R3: Technician Skills — Automatic Level

Trigger `trg_recalculate_technician_level` (AFTER INSERT on `technician_skill_evidence`) recalculates `technician_skills.current_level` as MAX of achieved levels. Trigger `trg_update_module_progress` (AFTER UPDATE on `technician_module_progress`) recalculates when induction/author flags change.

#### Scenarios verified
- [x] Single PASS evidence at level 2 → `current_level = 2`
- [x] 4 PASS at level 3 → threshold NOT met (needs 5)
- [x] 5+ PASS at level 3 → `current_level = 3`
- [x] 5 PASS at level 3 + 1 PASS at level 4 → `current_level = 4`
- [x] `autor_estandar = true` → `current_level = 5`
- [x] FAIL evidence does NOT increase level
- [x] Independent level calculation per technician+module pair

### R4: Skill Requirements

Table `skill_requirements` with unique constraint on `(job_plan_id, module_id)`, `minimum_level_required` CHECK (1–5).

#### Scenarios verified
- [x] PLANNER can INSERT/UPDATE requirements
- [x] Only ADMIN can DELETE requirements

### R5: Soft-Lock on Assignment

Function `check_competency_for_assignment(technician_id UUID, work_order_id TEXT)` returns JSON `{status, message, current_level, required_level}`.

#### Scenarios verified
- [x] Technician below minimum → `status: 'WARNING'` with level details
- [x] Technician meets minimum → `status: 'OK'`
- [x] No requirement defined → `status: 'OK'`
- [x] No module on asset → `status: 'OK'`
- [x] Work order not found → `status: 'OK'`

### R6: Technician Module Progress

Table `technician_module_progress` with PK `(technician_id, module_id)`, flags `induccion_completada` and `autor_estandar`.

#### Scenarios verified
- [x] PLANNER can toggle induction/author flags
- [x] `updated_at` and `updated_by` auto-recorded
- [x] Updating `autor_estandar` triggers recalculation to level 5

### R7: Evidence Validation

`technician_skill_evidence` with CHECK constraint `nivel_evaluado IN (2, 3, 4)`, boolean `status`, FK to `work_orders`, `user_profiles`, `assets`.

#### Scenarios verified
- [x] `nivel_evaluado = 1` rejected by CHECK
- [x] `nivel_evaluado = 5` rejected by CHECK
- [x] `nivel_evaluado = 2` accepted
- [x] `evaluated_by` defaults to `auth.uid()`

### R8: RLS Matrix

| Table | TECHNICIAN | PLANNER | ADMIN |
|-------|-----------|---------|-------|
| technological_modules | SELECT | SELECT | ALL |
| proficiency_levels | SELECT | SELECT | ALL |
| technician_skills | SELECT | SELECT | ALL |
| skill_requirements | SELECT | SELECT/INSERT/UPDATE | ALL |
| technician_skill_evidence | SELECT | SELECT/INSERT/UPDATE | ALL |
| technician_module_progress | SELECT | SELECT/INSERT/UPDATE | ALL |

#### Scenarios verified
- [x] TECHNICIAN SELECT all tables OK
- [x] TECHNICIAN INSERT on evidence REJECTED
- [x] PLANNER INSERT on evidence OK
- [x] PLANNER INSERT on module progress OK
- [x] No DELETE for PLANNER on evidence or progress

### R9: Audit Trail

`technician_skill_evidence` has audit trigger (`technician_skill_evidence_audit`) using `audit_trigger_func()`. `technician_module_progress` excluded (PK is composite, function expects `NEW.id`).

## Test Coverage

- 37 pgTAP tests at `supabase/tests/database/competency_engine_test.sql`
- Schema (14 tests): tables, FKs, CHECK constraints, seed data
- Triggers (10 tests): level calculation at each threshold, edge cases
- RLS (7 tests): role isolation, INSERT/UPDATE/DELETE per role
- Functions (6 tests): soft-lock scenarios (WARNING, OK, no requirement, no module, not found)
