# Tasks: GEMA Competency Engine

## Phase 1: Foundation — Technological Modules

- [x] 1.1 Create `supabase/migrations/20260528000001_technological_modules.sql` with `technological_modules` table (code PK TEXT, name, description) + 8 seed rows (M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-PUMP, M-TÉRM, M-INFR)
- [x] 1.2 Add `module_id UUID REFERENCES technological_modules(id)` column to `assets` table in same migration

## Phase 2: Core — Competency Engine Tables & Logic

- [x] 2.1 Create `supabase/migrations/20260528000002_competency_engine.sql` with 5 tables: `proficiency_levels`, `technician_skills` (UNIQUE technician+module), `skill_requirements`, `technician_skill_evidence` (CHECK nivel_evaluado IN 2-4), `technician_module_progress` (UNIQUE technician+module) — all with FKs, audit columns, and Spanish comments
- [x] 2.2 Seed 5 proficiency levels (1=Awareness…5=Master) and add audit trigger columns
- [x] 2.3 Write trigger `trg_recalculate_technician_level()` — AFTER INSERT on evidence, calculates MAX(level) from induction flag + PASS counts at each nivel + author flag
- [x] 2.4 Write trigger `trg_update_module_progress()` — AFTER UPDATE on `technician_module_progress`, syncs induction/author flags into `technician_skills.current_level`
- [x] 2.5 Write function `check_competency_for_assignment(p_technician_id UUID, p_work_order_id TEXT)` returning JSON `{status, message, current_level, required_level}` — soft-lock warning
- [x] 2.6 Add RLS policies (TECHNICIAN read-only, PLANNER insert/update, ADMIN all) and wire audit triggers

## Phase 3: Database Tests

- [x] 3.1 Create `supabase/tests/database/competency_engine_test.sql` — pgTAP schema tests: tables exist, FKs valid, CHECK constraints, seed rows
- [x] 3.2 Add trigger tests: level 2 from 1 PASS, level 3 threshold (5 PASS), level 4 from specialist PASS, level 5 from author flag, FAIL no increase, independent tech levels
- [x] 3.3 Add RLS tests: TECHNICIAN INSERT rejected; PLANNER INSERT ok; TECHNICIAN SELECT all tables ok
- [x] 3.4 Add function tests: below minimum → WARNING, meets minimum → OK, no requirement → OK, no module → OK

## Phase 4: Verification

- [ ] 4.1 Run all pgTAP tests, verify migrations apply in order with idempotency (DROP IF EXISTS), confirm migration 2 FK to `assets.module_id` resolves after migration 1
