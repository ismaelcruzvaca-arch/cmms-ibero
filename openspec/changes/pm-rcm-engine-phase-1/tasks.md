# Tasks: PM/RCM Engine — Phase 1 (Automation Layer)

## Migration 1: CBM Alert Trigger

- [x] **1.1 Add `meter_id` column to `work_orders`**
  `ALTER TABLE work_orders ADD COLUMN meter_id UUID REFERENCES meters(id)`
- [x] **1.2 Add `is_alert_triggered` column to `meter_readings`**
  `ALTER TABLE meter_readings ADD COLUMN is_alert_triggered BOOLEAN`
- [x] **1.3 Create `evaluate_meter_reading_for_cbm()` function**
   BEFORE INSERT trigger function with:
    - Meter resolution (asset_id, code, uom)
    - 4-quadrant threshold evaluation (upper/lower, warning/critical)
    - Anti-spam deduplication by asset_id + meter_id
    - Auto-generation of CBM work orders for critical thresholds
- [x] **1.4 Attach trigger `trg_meter_reading_cbm` to `meter_readings`**
- [x] **1.5 Apply migration to Supabase production**
  Adapted for production schema (no lifecycle_phase, adapted column references)

## Migration 2: PM Engine Automata

- [x] **2.1 Add `job_plan_id` column to `work_orders`**
  `ALTER TABLE work_orders ADD COLUMN job_plan_id UUID REFERENCES job_plans(id)`
- [x] **2.2 Create `generate_due_preventive_work_orders()` function**
  CTE recursive `due_chain` with:
    - Base: all overdue pm_schedules
    - Recursive: children with parent_schedule_id match → suppressed
    - Cycle detection guard
- [x] **2.3 Implement work order generation**
  INSERT into work_orders with `wo_type='PM'`, `lifecycle_phase='WAPPR'`, descriptive `symptom_note`
- [x] **2.4 Implement material inheritance**
  INSERT material_requests FROM job_plan_materials, LEFT JOIN spare_parts for description
- [x] **2.5 Implement fixed-clock recalculation**
  UPDATE pm_schedules: last_completion_date + next_target_date recalculation
- [x] **2.6 Bugfix: RECORD variable naming collision**
  Replaced individual loop variables with `r RECORD` to fix RETURNING INTO overwrite bug
- [x] **2.7 Bugfix: CTE base query — hijos con padre vencido entraban duplicados**
  Base CTE incluía TODOS los schedules vencidos (incluso hijos), y la recursión agregaba los mismos con suppressed=TRUE. UNION ALL no deduplica, así que los hijos aparecían con FALSE (base) y TRUE (recursión). El WHERE NOT suppressed se quedaba con la fila FALSE, anulando la supresión. Fix: base excluye schedules cuyo padre también está vencido mediante NOT EXISTS.
- [x] **2.8 Create pgTAP test file for PM Engine**
  `supabase/tests/database/pm_engine_test.sql` with 7 test cases (14 assertions):
  1. Basic WO generation ✓
  2. Hierarchical suppression 1 level ✓
  3. Child due without parent ✓
  4. Hierarchical suppression 3 levels ✓
  5. Material inheritance ✓
  6. Empty (no schedules due) ✓
  7. Clock recalculation ✓
- [x] **2.9 Commit and push to GitHub**

## Documentation

- [x] **3.1 Update `BACKLOG.md` with schema drift technical debt**
  CRITICAL severity, documents work_orders schema mismatch between production and ISO 14224 repo
- [x] **3.2 Update `docs/architecture/03-pm-rcm-engine.md`**
  Reflects implemented Phase 1 vs originally planned scope

## Verification

- [x] **4.1 CBM trigger tests on production**
  4 pgTAP tests executed: Normal, Warning, Critical, Anti-Spam — ✅ ALL GREEN
- [x] **4.2 PM Engine test file created**
  `supabase/tests/database/pm_engine_test.sql` — 7 tests, 14 assertions (pgTAP)
- [ ] **4.3 PM Engine functional tests execution**
  Pending Supabase branch creation (blocked by schema drift; dry-run code review done)
