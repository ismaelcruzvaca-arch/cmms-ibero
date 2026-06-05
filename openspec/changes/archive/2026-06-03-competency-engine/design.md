# Design: competency-engine

## Technical Approach

Two ordered SQL migrations for Supabase that create the technological module catalog, extend `assets`, and build the competency engine (5 tables, 2 triggers, soft-lock function, RLS). Reuses existing patterns: `get_user_role()` for RLS, `audit_trigger_func()` for audit, `SECURITY DEFINER` for triggers. Level calculation is immediate via triggers — no polling, no cron.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Migration order | Single vs split | **Split into 2** | `technological_modules` + `assets.module_id` must exist before `technician_skill_evidence` REFERENCES `assets(id)`. Prevents chicken-and-egg FK. |
| Level calculation | Cron vs trigger | **Trigger: `trg_recalculate_technician_level()`** | Immediate update on evidence INSERT. No delay, no polling. Cost negligible (single-row). |
| Soft-lock mechanism | Hard block vs warning | **Function returning JSON** | Planner calls function manually or via frontend. Warning does not block assignment. Hard-lock deferred. |
| Level 1 & 5 storage | In `technician_skills` vs separate | **`technician_module_progress` flags** | Keeps calculation logic clean: manual flags separate from auto-calculated evidence. PK `(technician_id, module_id)` prevents duplicates. |
| Evidence storage | `modulo_gema` as TEXT vs FK | **TEXT column** | Offline resilience — no FK enforcement to module catalog. Code is sufficient for lookup in triggers. |

## Data Flow

```
PLANNER inserts evidence ──→ technician_skill_evidence
                                    │
                         [AFTER INSERT trigger]
                                    │
                         trg_recalculate_technician_level()
                                    │
                         technician_skills.current_level ← MAX(achieved)

PLANNER toggles induction/author ──→ technician_module_progress
                                          │
                               [AFTER UPDATE trigger]
                                          │
                         trg_update_module_progress()
                                          │
                         technician_skills.current_level ← updated

check_competency_for_assignment(t, wo)
    ──→ reads skill_requirements (job_plan_id → minimum_level)
    ──→ reads technician_skills (current_level)
    ──→ returns {status: 'OK'|'WARNING', current_level, required_level, message}
```

## Level Calculation Logic

```
current_level = MAX of:
  Level 1: technician_module_progress.induccion_completada = true
  Level 2: EXISTS evidence WHERE nivel_evaluado=2 AND status=true
  Level 3: COUNT(evidence WHERE nivel_evaluado=3 AND status=true) >= 5
  Level 4: EXISTS evidence WHERE nivel_evaluado=4 AND status=true
  Level 5: technician_module_progress.autor_estandar = true
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260528000001_technological_modules.sql` | Create | `technological_modules` table + 8 seed rows + `ALTER assets ADD COLUMN module_id` + RLS + audit trigger |
| `supabase/migrations/20260528000002_competency_engine.sql` | Create | 5 tables (`proficiency_levels`, `technician_skills`, `skill_requirements`, `technician_skill_evidence`, `technician_module_progress`) + 2 triggers + soft-lock function + RLS + seed data |
| `supabase/tests/database/competency_engine_test.sql` | Create | 37 pgTAP tests: schema (14), triggers (10), RLS (7), functions (6) |

## Interfaces / Contracts

```sql
-- Soft-lock: returns JSON warning, never blocks
check_competency_for_assignment(
  p_technician_id UUID,
  p_work_order_id TEXT
) RETURNS JSON
-- Returns: {status, current_level, required_level, message}
-- status: 'OK' | 'WARNING'

-- Trigger: recalculates on evidence INSERT
trg_recalculate_technician_level() RETURNS TRIGGER
-- Trigger: recalculates on progress UPDATE
trg_update_module_progress() RETURNS TRIGGER
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | Tables exist, FKs OK, CHECK constraints, seed rows | pgTAP `has_table`, `col_is_fk`, `col_has_check`, `is(COUNT)` |
| Triggers | Level 2 from 1 PASS, level 3 threshold (4 vs 5), level 4, level 5, FAIL no increase, independent per tech+module | pgTAP `is()`, set up auth context, INSERT evidence, assert `current_level` |
| RLS | TECHNICIAN SELECT OK / INSERT rejected, PLANNER INSERT OK, PLANNER DELETE rejected | pgTAP with `set_auth()` helper, `throws_ok` / `lives_ok` |
| Function | Below minimum → WARNING, meets minimum → OK, no requirement → OK, no module → OK, WO not found → OK | pgTAP `is()` on JSON return values |

## Migration / Rollout

Two migrations in order. `20260528000002` depends on `20260528000001` (FK to `assets.module_id`). Both use `DROP IF EXISTS` and `IF NOT EXISTS` for idempotency. No feature flags — schema-only changes. Rollback: revert `00002` then `00001`; `module_id` column in `assets` is nullable, no data loss.

## Open Questions

None. All decisions frozen in exploration/design.
