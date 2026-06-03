# Design: GEMA Competency Engine

## Technical Approach

Backend-only v1: two ordered SQL migrations for Supabase that create the technological module catalog, extend assets, and build the competency engine (proficiency levels, evidence trail, automatic level calculation via triggers, skill requirements, and a soft-lock validation function). Reuses existing patterns: `get_user_role()` for RLS, `audit_trigger_func()` for audit, `SECURITY DEFINER` for triggers.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Migration order | Single vs split | Split into 2 migrations | `technological_modules` + `assets.module_id` FK must exist before `technician_skill_evidence` REFERENCES `assets(id)`. Prevents chicken-and-egg. |
| Level calculation | Cron job vs trigger | Trigger: `trg_recalculate_technician_level()` | Immediate update on evidence insert. No delay, no polling. Cost is negligible (single-row operations). |
| Access enforcement | DB trigger vs function call | Function: `check_competency_for_assignment()` | Soft-lock is advisory (warning, not block). No FSM integration needed in v1. Planner calls function manually or via frontend. Hard-lock deferred to v3. |
| RLS policy | Row-level per table | Same matrix as safety-permits | TECHNICIAN read-only (cannot create evidence for themselves). PLANNER insert/update evidence+progress. ADMIN all. Consistent with existing `work_permits` pattern. |
| Level 1 & 5 storage | In `technician_skills` vs separate table | `technician_module_progress` flags | Keeps level calculation logic clean: one table for manual flags (induction, author), separate from auto-calculated evidence. `UNIQUE(technician_id, modulo_gema)` prevents duplicates. |

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
    ──→ returns {status: 'OK'|'WARNING', message, current_level, required_level}
```

## Level Calculation Logic (in trigger)

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
| `supabase/migrations/20260528000001_technological_modules.sql` | Create | `technological_modules` table + 8 seed rows + `ALTER assets ADD COLUMN module_id` |
| `supabase/migrations/20260528000002_competency_engine.sql` | Create | 5 tables + 2 triggers + RLS + audit + seed `proficiency_levels` |
| `supabase/tests/database/competency_engine_test.sql` | Create | pgTAP: schema (tables, enums, FKs), triggers (level calc), RLS, soft-lock function |

## Interfaces / Contracts

```sql
-- Soft-lock validation function
check_competency_for_assignment(
  p_technician_id UUID,
  p_work_order_id TEXT
) RETURNS JSON  -- {status: 'OK'|'WARNING', message, current_level, required_level}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Schema | Tables exist, FKs OK, enum values correct, CHECK constraints | pgTAP `has_table`, `has_type`, `col_not_null`, `fk_ok` |
| Triggers | Level calc: single lv2 evidence, lv3 threshold (4 vs 5), lv4, lv5, MAX logic | pgTAP `is()`, trigger setup with auth context |
| RLS | TECHNICIAN SELECT ok, INSERT rejected; PLANNER INSERT ok; TECHNICIAN cannot write progress flags | pgTAP with `set_auth()` helper |
| Function | competency check: below minimum → WARNING, meets minimum → OK, no requirement → OK | pgTAP `is()` on function return JSON |

## Migration / Rollout

Two migrations executed in order. Both use `DROP IF EXISTS` for idempotency. No feature flags — schema-only changes. `20260528000002` depends on `20260528000001` (FK to `assets` with `module_id` column).

## Open Questions

None. All 5 blocking decisions frozen in exploration phase.
