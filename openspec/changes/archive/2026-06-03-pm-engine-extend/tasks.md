# Tasks: PM Engine — Extend Structured Job Plans (pm-engine-extend)

> 6 tasks — single migration extending `generate_due_preventive_work_orders()`.
> Design ref: `design.md`. Spec ref: `spec.md`. Original function spec: `openspec/specs/pm-engine-automata/spec.md`.

---

### [x] 1. Seed system user for auto-generated checklist instances

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: None
- **Acceptance**:
  - `INSERT INTO auth.users (id, email, encrypted_password, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000000', 'system@gema.local', '$2a$10$x', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`
  - `INSERT INTO user_profiles (id, role) VALUES ('00000000-0000-0000-0000-000000000000', 'ADMIN') ON CONFLICT (id) DO NOTHING`
  - Running the migration twice does not error (idempotent)

---

### [x] 2. Scaffold extended function + preserve original WO insert and material inheritance

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Task 1 (same file, but no code dependency)
- **Acceptance**:
  - `CREATE OR REPLACE FUNCTION generate_due_preventive_work_orders()` with same signature (`RETURNS INT`)
  - `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
  - Recursive CTE `due_chain` preserved: hierarchical suppression, `NOT ps.id = ANY(dc.path)` cycle detection, `WHERE NOT dc.suppressed`
  - Step a: `INSERT INTO work_orders (id, asset_id, equipment_id, wo_type, lifecycle_phase, job_plan_id, reported_at, estimated_hours, symptom_note)` with `gen_random_uuid()::text`
  - Step b: `INSERT INTO material_requests SELECT ... FROM job_plan_materials WHERE job_plan_id = r.job_plan_id`
  - No regression: original material inheritance and hierarchical suppression work identically

---

### [x] 3. Add labor and safety cloning blocks

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Task 2 (function body scaffolded)
- **Acceptance**:

  **Step c — Labor clone** (after step b):
  ```sql
  INSERT INTO work_order_labor_estimates (work_order_id, job_plan_id, trade, estimated_hours, head_count, hourly_rate)
  SELECT v_wo_id, r.job_plan_id, jpl.trade, jpl.estimated_hours, jpl.head_count, jpl.hourly_rate
  FROM job_plan_labor jpl
  WHERE jpl.job_plan_id = r.job_plan_id;
  ```

  **Step d — Safety clone** (after step c):
  ```sql
  INSERT INTO work_order_safety_requirements (work_order_id, job_plan_id, safety_type, description, is_mandatory)
  SELECT v_wo_id, r.job_plan_id, jps.safety_type, jps.description, jps.is_mandatory
  FROM job_plan_safety jps
  WHERE jps.job_plan_id = r.job_plan_id;
  ```

  - `work_order_labor_estimates` includes `job_plan_id` for audit traceability
  - `work_order_safety_requirements` includes `job_plan_id` for audit traceability
  - If job plan has no labor/safety rows, 0 rows inserted (no error)

---

### [x] 4. Add checklist template attachment block

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Task 2 (function body scaffolded), Task 1 (system user exists)
- **Acceptance**:
  - After step d, iterate matching checklist_templates:
  ```sql
  FOR v_template IN
    SELECT ct.id AS template_id, ct.block_type, ct.description
    FROM checklist_templates ct
    WHERE ct.is_active = true
      AND ct.job_plan_task_id IS NULL
      AND (
        (ct.module_id = r.module_id AND ct.job_plan_id IS NULL)
        OR (ct.job_plan_id = r.job_plan_id AND ct.module_id IS NULL)
        OR (ct.module_id = r.module_id AND ct.job_plan_id = r.job_plan_id)
      )
  LOOP
    INSERT INTO checklist_instances (
      id, work_order_id, checklist_template_id, technician_id,
      asset_id, evaluator_source, evaluated_by, status,
      started_at, created_at, notes
    ) VALUES (
      gen_random_uuid(), v_wo_id, v_template.template_id,
      v_system_user_id, r.asset_id::text,
      'SELF', v_system_user_id, 'PENDING',
      NULL, NOW(),
      'Generado automáticamente desde job_plan ' || r.code
    );
  END LOOP;
  ```
  - `technician_id` uses system user placeholder (`00000000-0000-0000-0000-000000000000`)
  - Templates with `job_plan_task_id IS NOT NULL` are excluded (task-level)
  - OR matching logic: module-level only, plan-level only, or both
  - If no templates match, 0 instances created (no error)

---

### [x] 5. Add cost calculation UPDATE + floating-clock schedule update

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Tasks 3, 4 (cost data must be in the snapshot tables before calculation)
- **Acceptance**:

  **Step f — Cost calculation** (after step e):
  ```sql
  UPDATE work_orders
  SET
    estimated_hours = COALESCE((
      SELECT SUM(wole.estimated_hours * wole.head_count)
      FROM work_order_labor_estimates wole
      WHERE wole.work_order_id = v_wo_id
    ), 0),
    estimated_parts_cost = COALESCE((
      SELECT SUM(jpm.planned_qty * COALESCE(sp.unit_cost, 0))
      FROM job_plan_materials jpm
      LEFT JOIN spare_parts sp ON sp.part_num = jpm.part_num
      WHERE jpm.job_plan_id = r.job_plan_id
    ), 0),
    estimated_labor_cost = COALESCE((
      SELECT SUM(wole.estimated_hours * wole.head_count * wole.hourly_rate)
      FROM work_order_labor_estimates wole
      WHERE wole.work_order_id = v_wo_id
    ), 0)
  WHERE id = v_wo_id;
  ```
  - `estimated_hours` is recalculated from labor snapshot (overwrites the `jp.estimated_hours` set at WO insert — intentional, more accurate)
  - `estimated_parts_cost` reads directly from `job_plan_materials` (not the cloned `material_requests`) to avoid relying on the snapshot for cost
  - If no labor rows exist, `estimated_hours` and `estimated_labor_cost` are 0
  - If no materials exist, `estimated_parts_cost` is 0

  **Step g — Schedule update** (after step f):
  ```sql
  UPDATE pm_schedules
  SET
    last_completion_date = NOW(),
    next_target_date = CASE
      WHEN is_floating THEN last_completion_date + (r.time_frequency_days || ' days')::INTERVAL
      ELSE next_target_date + (r.time_frequency_days || ' days')::INTERVAL
    END
  WHERE id = r.schedule_id;
  ```
  - When `is_floating = true`: `next_target_date` advances from `last_completion_date`
  - When `is_floating = false` or `NULL`: `next_target_date` advances from itself (fixed-clock, original behavior preserved)
  - `last_completion_date` is always set to `NOW()` regardless of floating/fixed

---

### [x] 6. Update function comment

- **Files**: `supabase/migrations/20260531000002_pm_engine_extend.sql`
- **Depends on**: Tasks 2–5 (function complete)
- **Acceptance**:
  ```sql
  COMMENT ON FUNCTION generate_due_preventive_work_orders IS
    'Genera work orders desde pm_schedules vencidos. Extendido para clonar labor, safety, checklists y calcular costos estimados. Usa UUID placeholder 00000000-0000-0000-0000-000000000000 para checklist_instances sin técnico asignado.';
  ```
  - Comment is in Spanish (project convention)
  - Documents the new cloning, cost, and system user behavior

---

## Summary

| Task | Artifact | Key Behavior |
|------|----------|--------------|
| 1 | System user seed | `INSERT ON CONFLICT DO NOTHING` for nil UUID |
| 2 | Function scaffold | Preserved original WO + material inheritance |
| 3 | Labor + safety cloning | `INSERT ... SELECT FROM` snapshot tables |
| 4 | Checklist attachment | OR-matching templates → checklist_instances PENDING |
| 5 | Cost calculation + floating clock | UPDATE from estimates + `is_floating` branch |
| 6 | Function comment | Document in Spanish |

### Dependency Graph

```
Task 1 ──┐  (independent)
Task 2 ──┤
         ├── Task 3 (needs function body from 2)
         ├── Task 4 (needs function body from 2, system user from 1)
         ├── Task 5 (needs data from 3, 4)
         └── Task 6 (needs complete function)
```

All tasks write to: `supabase/migrations/20260531000002_pm_engine_extend.sql`

### Edge Cases Covered

| Edge Case | Task | Mechanism |
|-----------|------|-----------|
| Job plan has no labor rows | 3 | 0 rows inserted, cost = 0 |
| Job plan has no safety rows | 3 | 0 rows inserted |
| No checklist templates match | 4 | 0 instances created |
| Job plan has no materials | 5 | estimated_parts_cost = 0 |
| `hourly_rate` is 0 | 5 | estimated_labor_cost = 0 (no craft_rate table yet) |
| Floating schedule with NULL last_completion_date | 5 | Falls back to NOW() (set in same UPDATE) |
| Migration run twice | 1 | `ON CONFLICT DO NOTHING` + `CREATE OR REPLACE` |
| Task-level checklist templates exist | 4 | Filtered by `job_plan_task_id IS NULL` |
| System user FK violation | 1 | Seeded before function uses it (same migration file order) |
