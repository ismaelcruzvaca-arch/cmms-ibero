# Design: PM/RCM Engine — Phase 1 (Automation Layer)

## Technical Approach

Two self-contained PostgreSQL migrations implementing the execution layer of PM/RCM:

1. **CBM Alert Trigger** (`20260524000001_cbm_alert_trigger.sql`): A `BEFORE INSERT` trigger on `meter_readings` that evaluates readings against `measure_points` thresholds and conditionally generates work orders
2. **PM Engine Automata** (`20260524000002_pm_engine_automata.sql`): A PL/pgSQL function `generate_due_preventive_work_orders()` that scans `pm_schedules`, applies hierarchical suppression, generates work orders with material inheritance, and recalculates the maintenance clock

Both follow the ISO 14224 schema conventions already established in the codebase and use `SECURITY DEFINER SET search_path = public` for safe execution.

---

## Part A: CBM Alert Trigger Design

### Trigger: `trg_meter_reading_cbm`

```
Type: BEFORE INSERT FOR EACH ROW
Table: meter_readings
Function: evaluate_meter_reading_for_cbm()
```

#### Flow

```
INSERT into meter_readings
  │
  ▼
resolve asset_id + meter_code + uom from meters table
  │
  ▼
measure_points exist for this meter?
  ├── NO → RETURN NEW (no-op)
  │
  ▼ YES
compare NEW.reading_value against 4 quadrants:
  ┌──────────────────────────────────────────────┐
  │ upper_limit_critical  ─── upper_limit_warning │
  │                                              │
  │  CRITICAL_HIGH    ← WARNING_HIGH             │
  │                                              │
  │  WARNING_LOW      → CRITICAL_LOW             │
  │                                              │
  │ lower_limit_warning  ─── lower_limit_critical │
  └──────────────────────────────────────────────┘
  │
  ▼ threshold crossed?
  ├── NO  → RETURN NEW (no-op)
  │
  ▼ YES
set NEW.is_alert_triggered = true
  │
  ▼ is it CRITICAL (HIGH or LOW)?
  ├── NO  → RETURN NEW (warning-only, no WO)
  │
  ▼ YES — Anti-Spam check
  SELECT existing WO WHERE asset_id + meter_id + wo_type='CBM'
    AND lifecycle_phase IN (WAPPR, APPROVED, INPRG)
  │
  ├── FOUND → RETURN NEW (reuse existing WO)
  │
  ▼ NOT FOUND
INSERT work_order (wo_type='CBM', lifecycle_phase='WAPPR',
  symptom_note describing the breach)
  │
  ▼
RETURN NEW
```

### Anti-Spam Deduplication

**Criteria**: Existing CBM work order for the same `asset_id` + `meter_id` with `lifecycle_phase` in `('WAPPR', 'APPROVED', 'INPRG')`.

**Rationale**: Once a critical threshold is breached, we generate ONE work order. We don't flood the system with duplicate OTs for every subsequent reading. When the existing OT is completed or closed, fresh readings can trigger new alerts.

### Decision: BEFORE INSERT vs AFTER INSERT

| Option | Tradeoff | Decision |
|--------|----------|----------|
| AFTER INSERT | Can't modify NEW row; requires separate UPDATE for is_alert_triggered | ❌ Rejected |
| BEFORE INSERT | Can set `is_alert_triggered` in the same transaction; single write | ✅ **Chosen** |

---

## Part B: PM Engine Automata Design

### Function: `generate_due_preventive_work_orders()`

```
Returns: INT (count of WOs created)
Language: PL/pgSQL
Security: SECURITY DEFINER SET search_path = public
```

#### Internal Flow

```
1. WITH RECURSIVE due_chain AS (
     BASE: SELECT * FROM pm_schedules
       WHERE next_target_date::DATE <= CURRENT_DATE
       AND (parent_schedule_id IS NULL
         OR parent IS NOT overdue)   ← evita que hijos entren dos veces
       → mark suppressed = false
    
     UNION ALL (recursive step):
     SELECT children WHERE parent_schedule_id = dc.id
       AND next_target_date::DATE <= CURRENT_DATE
       → mark suppressed = true
       (cycle guard: NOT id = ANY(dc.path))
   )
   
2. eligible AS (
     SELECT due_chain.* JOIN assets + job_plans
     WHERE NOT suppressed
   )
   
3. FOR EACH eligible schedule (ordered by frequency DESC):
   
   a. GENERATE WO:
      INSERT work_orders (wo_type='PM', lifecycle_phase='WAPPR',
        job_plan_id, planned_hours from job_plan,
        symptom_note with job_plan code + description)
   
   b. INHERIT MATERIALS:
      INSERT material_requests (work_order_id, part_num, ...)
      SELECT FROM job_plan_materials
      LEFT JOIN spare_parts FOR description
   
   c. RECALC CLOCK:
      UPDATE pm_schedules SET
        last_completion_date = NOW(),
        next_target_date = next_target_date + time_frequency_days
   
   d. increment counter
   
4. RETURN counter
```

### Decision: RECORD variable over individual loop variables

Initial implementation used 6 individual loop variables (`v_wo_id`, `v_equip_id`, `v_jp_code`, etc.) causing a naming collision when `RETURNING id INTO v_wo_id` overwrote the schedule's `asset_id`.

| Approach | Issue | Fix |
|----------|-------|-----|
| Individual variables | Names collide with RETURNING INTO; hard to track position-to-column mapping | ❌ Buggy |
| `r RECORD` | Single variable, named field access (`r.schedule_id`, `r.asset_id`), no ambiguity | ✅ **Chosen** |

### Decision: Fixed-clock recalculation

PM schedules use **fixed-clock** mode (SAP/Maximo standard): `next_target_date` always advances by `time_frequency_days` from the current `next_target_date`, regardless of when the work order was actually completed.

This matches the ADR-03-04 design for `is_floating = false` schedules. Floating mode (`is_floating = true`) would recalculate from `last_completion_date` and is planned for a future phase.

### Decision: Ordering by time_frequency_days DESC NULLS LAST

Schedules with longer intervals (e.g., OVERHAUL every 365 days) are processed first, ensuring parent schedules are evaluated before children. This is critical for the suppression logic: parents must be in `due_chain` before the recursive step finds children.

---

## Combined Schema Changes

### work_orders additions

| Column | Type | FK | Purpose |
|--------|------|----|---------|
| meter_id | UUID | meters(id) | CBM: which sensor triggered alert |
| job_plan_id | UUID | job_plans(id) | PM: which job plan originated the WO |

### meter_readings additions

| Column | Type | Purpose |
|--------|------|---------|
| is_alert_triggered | BOOLEAN | Flagged when reading crosses any threshold |

---

## Constraints & Guardrails

| Concern | Mechanism |
|---------|-----------|
| Circular parent_schedule_id recursion | `NOT ps.id = ANY(dc.path)` cycle detection |
| Anti-spam perpetual alerting | Only blocks while WO is open (WAPPR/APPROVED/INPRG) |
| Non-existent meter silently ignored | `RAISE WARNING` + `RETURN NEW` (non-fatal) |
| No measure_points configured | `RETURN NEW` (no-op, expected for meters without thresholds) |
| NULL next_target_date | Excluded by `WHERE next_target_date IS NOT NULL` |
