# Tasks: competency-engine

## Phase 1: Technological Modules Catalog

- [x] 1.1 Create `supabase/migrations/20260528000001_technological_modules.sql` with `technological_modules` table (id UUID PK, code TEXT UNIQUE, name, description, timestamps) + 8 seed rows: M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-PUMP, M-TÉRM, M-INFR
- [x] 1.2 Add `module_id UUID REFERENCES technological_modules(id)` column to `assets` with index `idx_assets_module`
- [x] 1.3 Add `trg_technological_modules_updated_at` trigger + RLS policies (TECHNICIAN/PLANNER=SELECT, ADMIN=ALL)

## Phase 2: Core Competency Engine

- [x] 2.1 Create `proficiency_levels` table (level INT PK CHECK 1–5, name, trigger_description) + 5 seed rows with names: Awareness, Assisted, Independent, Specialist, Master
- [x] 2.2 Create `technician_skills` table (id UUID PK, technician_id FK→user_profiles, module_id FK→technological_modules, current_level DEFAULT 1, calculated_at, UNIQUE technician+module) + indexes
- [x] 2.3 Create `skill_requirements` table (id UUID PK, job_plan_id FK→job_plans, work_type TEXT nullable, module_id FK→technological_modules, minimum_level_required CHECK 1–5, UNIQUE job_plan+module)
- [x] 2.4 Create `technician_skill_evidence` table (id UUID PK, work_order_id FK→work_orders, technician_id FK→user_profiles, asset_id FK→assets, modulo_gema TEXT, nivel_evaluado CHECK IN (2,3,4), item_evaluado TEXT, status BOOLEAN, evaluated_at, evaluated_by FK→user_profiles) + indexes
- [x] 2.5 Create `technician_module_progress` table (technician_id FK→user_profiles, module_id FK→technological_modules, induccion_completada BOOLEAN DEFAULT false, autor_estandar BOOLEAN DEFAULT false, updated_by FK→user_profiles, updated_at, PK technician+module) + `trg_progress_updated_at` trigger
- [x] 2.6 Write trigger `trg_recalculate_technician_level()` — AFTER INSERT ON technician_skill_evidence, resolves module code→UUID, evaluates PASS evidence at each level (2/3/4), reads induction/author flags, calculates MAX level, UPSERT into technician_skills
- [x] 2.7 Write trigger `trg_update_module_progress()` — AFTER UPDATE ON technician_module_progress, evaluates existing evidence with new flag values, recalculates MAX level, UPSERT into technician_skills
- [x] 2.8 Write function `check_competency_for_assignment(p_technician_id UUID, p_work_order_id TEXT)` — resolves asset→module→skill_requirement, compares current_level vs minimum_level_required, returns JSON `{status, current_level, required_level, message}` (WARNING if below, OK otherwise)
- [x] 2.9 Add RLS policies per table: TECHNICIAN=SELECT, PLANNER=SELECT+INSERT+UPDATE (evidence, progress, requirements), ADMIN=ALL; PLANNER has no DELETE on evidence/progress
- [x] 2.10 Wire audit trigger `technician_skill_evidence_audit` using `audit_trigger_func()`

## Phase 3: Database Tests (pgTAP)

- [x] 3.1 Schema tests (14): `has_table` for 6 tables, `col_is_fk` for assets.module_id, `col_has_check` for nivel_evaluado, seed row counts (8 modules, 5 levels), CHECK constraint rejects nivel 1 and 5, accepts nivel 2
- [x] 3.2 Trigger tests (10): level 2 from single PASS evidence, level 3 threshold NOT met at 4 PASS, level 3 reached at 5+ PASS, level 4 from specialist PASS, level 5 from autor_estandar, FAIL evidence does not increase level, independent levels per technician+module pair, induction flag triggers recalculation, autor_estandar triggers recalculation, multiple evidence items with mixed results
- [x] 3.3 RLS tests (7): TECHNICIAN SELECT all tables OK, TECHNICIAN INSERT on evidence REJECTED, PLANNER INSERT on evidence OK, PLANNER INSERT on progress OK, PLANNER DELETE on evidence REJECTED, PLANNER DELETE on progress REJECTED, ADMIN can DELETE
- [x] 3.4 Function tests (6): below minimum→WARNING, meets minimum→OK, no requirement→OK, no module→OK, WO not found→OK, WARNING includes current and required level

## Phase 4: Verification

- [x] 4.1 Run all 37 pgTAP tests (`supabase db test`), confirm migrations apply in order with idempotency, verify FK from migration 02 resolves against migration 01 `technological_modules` + `assets.module_id`
