# Design: Checklist Evidence System

## Technical Approach

Single migration `20260529000001_checklist_evidence.sql` creating 6 tables (catalogs → templates → instances → responses → sampling), altering 2 existing tables (`technician_skill_evidence`, `work_orders`), and defining 2 trigger functions. Checklist completion feeds aggregated evidence into the Competency Engine via SECURITY DEFINER trigger, which chains into a modified `trg_recalculate_technician_level` for trust-weighted SUM. All new tables have RLS per role matrix and audit triggers.

**Key architectural choice**: Evidence is aggregated **per instance** (1 row per completed checklist), not per item. The trigger evaluates ALL item responses and produces a single PASS/FAIL verdict with the first causa_falla_id. This avoids bloating `technician_skill_evidence` with per-item rows and keeps the competency calculation simple.

---

## Architecture Decisions

### Decision: Aggregated evidence (1 row per instance), not per-item

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Per-item evidence (1 row per response) | 12 items = 12 evidence rows per WO, faster to pinpoint failures | ❌ |
| Aggregated per instance (1 row per checklist) | Simpler SUM, less storage, block-level verdict only | ✅ |

**Rationale**: The Competency Engine evaluates at block level (A→level 2, B→level 3, C→level 4). Per-item granularity adds storage and query complexity without changing the level calculation. The FIRST causa_falla_id provides traceability. If per-item granularity is needed later, a `checklist_evidence_details` table can be added.

### Decision: Aggregated trigger (loop + verdict), not per-item INSERT

The archived design (2026-05-31) inserted one `technician_skill_evidence` row per item response. The **actual implementation** iterates responses, tracks `v_any_fail` and `v_first_causa_falla_id`, then inserts ONE row. This is simpler and avoids N+1 evidence rows per checklist.

### Decision: item_type as response format, not category

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Item type as category (safety/procedure/quality/precision per archived design) | Semantic but unrelated to response UI | ❌ |
| Item type as response format (PASS_FAIL/MEASUREMENT/YES_NO/TEXT) | Directly maps to input widget, simpler validation | ✅ |

**Rationale**: The actual migration uses PASS_FAIL, MEASUREMENT, YES_NO, TEXT — these describe HOW the user responds, not what category the item belongs to. Category can be inferred from block_type (A=safety, B=execution, C=precision).

### Decision: Sampling rate on template + config override

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Sampling only in config table | Every template needs config entry, extra JOIN | ❌ |
| Sampling_rate on template + default_sampling_rate on config override | Templates have defaults, config can override per module+block | ✅ |

**Rationale**: Templates carry a `sampling_rate` default. `checklist_sampling_config` allows per-module+block overrides via `default_sampling_rate`. If no config entry exists, the template's rate applies.

### Decision: NO_APLICA override in trigger, not app logic

| Option | Tradeoff | Decision |
|--------|----------|----------|
| App enforces before submit | Client-side can be bypassed | ❌ |
| Trigger handles authoritative override | Single source of truth, SECURITY DEFINER, cannot be bypassed | ✅ |

**Rationale**: The trigger is authoritative and cannot be bypassed. NO_APLICA causes the evidence row to record `status=true` even if the item was marked FAIL.

### Decision: evaluator_source with trust_score mapping

| Source | Trust | Use Case |
|--------|-------|----------|
| SELF | 0.5 | Self-evaluation by the technician |
| PEER | 0.8 | Peer evaluation (another technician) |
| SUPERVISOR | 1.0 | Supervisor spot-check (highest trust) |

**Rationale**: Trust-weighted levels incentivize supervisor spot-checks and peer reviews. A technician cannot self-evaluate to level 3 — they need 10 SELF evaluations (5.0 SUM) vs 5 SUPERVISOR (5.0 SUM). This encourages supervisor engagement.

### Decision: No separate trg_validate_checklist_gate

The **actual implementation** does NOT include a `trg_validate_checklist_gate` BEFORE UPDATE trigger on `work_orders` (present in the archived design). Lifecycle gates are handled entirely in the frontend. The migration only covers the evidence pipeline.

---

## Data Flow

```
APPROVED → INPRG (frontend)
  │
  ├─ resolve sampling (module+block, deterministic hash)
  ├─ check Block C visibility (technician level >= 3)
  └─ create checklist_instances (IN_PROGRESS)
        │
        ▼
Technician opens Focus Mode
  │
  ├─ load template items by step_sequence
  ├─ complete items (PASS/FAIL + optional causa_falla)
  └─ submit:
       ├─ INSERT checklist_item_responses (per item)
       └─ UPDATE checklist_instances.status = 'COMPLETED'
             │
             ▼
  trg_checklist_to_evidence (AFTER UPDATE, SECURITY DEFINER)
    │
    ├─ iterate item responses
    ├─ detect any FAIL (non-NO_APLICA) → status=false
    ├─ detect first causa_falla_id (for traceability)
    ├─ map block→nivel: A→2, B→3, C→4
    ├─ resolve trust_score from evaluator_source
    └─ INSERT INTO technician_skill_evidence (1 aggregated row)
         │
         ▼
  trg_recalculate_technician_level (AFTER INSERT, existing)
    └─ SUM(COALESCE(trust_score,1.0)) for nivel=3, status=true
       Filter: exclude causa_falla IN (FALTA_HERRAMIENTA, FALTA_REPUESTO, ERROR_DOCUMENTACION)
```

---

## Migration Structure

```
20260529000001_checklist_evidence.sql
├── Section 1: causa_falla_catalog (6 seed rows)
├── Section 2: checklist_templates + checklist_template_items
├── Section 3: checklist_instances + checklist_item_responses
├── Section 4: checklist_sampling_config
├── Section 5: ALTER technician_skill_evidence (+3 columns)
├── Section 6: ALTER work_orders (+2 columns)
├── Section 7: trg_checklist_to_evidence (AFTER UPDATE)
├── Section 8: Replace trg_recalculate_technician_level
├── Section 9: RLS on all 6 tables
└── Section 10: Audit triggers on instances + responses
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260529000001_checklist_evidence.sql` | Create | 758 lines: 6 tables, 2 ALTERs, 2 triggers, RLS, audit |

---

## RLS Matrix

| Table | TECHNICIAN | PLANNER | ADMIN |
|-------|-----------|---------|-------|
| causa_falla_catalog | SELECT | SELECT | ALL |
| checklist_templates | SELECT | INSERT/SELECT/UPDATE | ALL |
| checklist_template_items | SELECT | INSERT/SELECT/UPDATE | ALL |
| checklist_sampling_config | SELECT | SELECT/UPDATE | ALL |
| checklist_instances | SELECT/INSERT/UPDATE (own) | ALL | ALL |
| checklist_item_responses | SELECT/INSERT | ALL | ALL |

Pattern: `get_user_role()` determines access. TECHNICIAN restricted to own instances via `technician_id = auth.uid()`.

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Migration | Tables, constraints, seed data | pgTAP: has_table, has_column, col_is_fk, CHECK constraint enforcement |
| Trigger | Evidence feeding, aggregation, NO_APLICA override, trust_score mapping | pgTAP: insert items, complete instance, verify evidence row |
| Engine | Trust-weighted SUM, causa_falla filter, backward compat | pgTAP: vary trust scores and causa_falla codes, assert level outcome |
| RLS | Role-based access per table | pgTAP: SET ROLE, verify SELECT/INSERT/UPDATE/DELETE behavior |
| Integration | Full chain: template → instance → responses → evidence → level | pgTAP: end-to-end with real FK chains |
