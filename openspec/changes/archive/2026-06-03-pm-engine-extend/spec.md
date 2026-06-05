# Spec: PM Engine — Extend Structured Job Plans

## Purpose

Extend `generate_due_preventive_work_orders()` beyond material inheritance to clone labor, safety, and checklist data from job plans, compute estimated costs, and support floating-clock recalculation for floating PM schedules.

## Requirements

### R1: Clone job_plan_labor → work_order_labor_estimates

When a PM WO is generated, the system MUST copy every `job_plan_labor` row for the schedule's job plan into `work_order_labor_estimates` as a frozen snapshot. Columns cloned: `trade`, `estimated_hours`, `head_count`, `hourly_rate`.

### R2: Clone job_plan_safety → work_order_safety_requirements

When a PM WO is generated, the system MUST copy every `job_plan_safety` row for the schedule's job plan into `work_order_safety_requirements` as a frozen snapshot. Columns cloned: `safety_type`, `description`, `is_mandatory`. `is_fulfilled` defaults to `false`.

### R3: Attach plan-level checklist templates → checklist_instances (PENDING)

When a PM WO is generated, the system MUST create `checklist_instances` from active `checklist_templates` that match the asset's module, the job plan, or both. Template matching uses OR logic:

- `module_id = asset.module_id AND job_plan_id IS NULL` — module-level templates
- `job_plan_id = schedule.job_plan_id AND module_id IS NULL` — job-plan-level templates
- `module_id = asset.module_id AND job_plan_id = schedule.job_plan_id` — both must match

Instances MUST be created with `status = 'PENDING'`, `technician_id = '00000000-0000-0000-0000-000000000000'` (system placeholder), no `started_at`, and an auto-generated note referencing the source job plan code.

### R4: Compute estimated costs on work_orders

After cloning labor and materials, the system MUST UPDATE the new work order with:

| Column | Formula |
|--------|---------|
| `estimated_hours` | `SUM(work_order_labor_estimates.estimated_hours × head_count)` |
| `estimated_parts_cost` | `SUM(job_plan_materials.planned_qty × COALESCE(spare_parts.unit_cost, 0))` |
| `estimated_labor_cost` | `SUM(work_order_labor_estimates.estimated_hours × head_count × hourly_rate)` |

If no labor rows exist, `estimated_hours` and `estimated_labor_cost` MUST be 0.
If no materials exist, `estimated_parts_cost` MUST be 0.

### R5: Floating-clock recalculation for `is_floating = true`

When a PM schedule has `is_floating = true`, the function MUST advance `next_target_date` from `last_completion_date` instead of from the current `next_target_date`. The fixed-clock behavior (`is_floating = false`) is unchanged — advance from `next_target_date`.

## Scenarios

#### Scenario: PM WO generated with labor snapshot

- GIVEN a job_plan with 2 labor rows (ELECTRICIAN 4h × 1, MECHANIC 8h × 2)
- WHEN `generate_due_preventive_work_orders()` creates a WO for that job plan
- THEN `work_order_labor_estimates` has 2 rows linked to the new WO
- AND `trade`, `estimated_hours`, `head_count`, `hourly_rate` match the source

#### Scenario: PM WO generated with safety snapshot

- GIVEN a job_plan with 1 safety row (LOTO mandatory)
- WHEN a WO is generated
- THEN `work_order_safety_requirements` has 1 row linked to the WO
- AND `is_fulfilled = false`

#### Scenario: Checklist instances attached by module + job plan match

- GIVEN a checklist_template with `module_id = X` and `job_plan_id = Y`
- WHEN a WO is generated for a schedule with `asset.module_id = X` and `job_plan_id = Y`
- THEN a `checklist_instance` is created with `status = 'PENDING'`, linked to the WO and template

#### Scenario: Module-only template attached

- GIVEN a checklist_template with `module_id = X` and `job_plan_id IS NULL`
- WHEN a WO is generated for ANY schedule whose asset belongs to module X
- THEN a `checklist_instance` is created

#### Scenario: Job-plan-only template attached

- GIVEN a checklist_template with `job_plan_id = Y` and `module_id IS NULL`
- WHEN a WO is generated for schedule with `job_plan_id = Y`
- THEN a `checklist_instance` is created

#### Scenario: Task-level templates excluded

- GIVEN a checklist_template with `job_plan_task_id IS NOT NULL` and matching module
- WHEN a WO is generated
- THEN NO checklist_instance is created from that template

#### Scenario: Estimated costs computed correctly

- GIVEN a job plan with 2 labor rows (ELECTRICIAN 4h × 1 @ 50/hr, MECHANIC 8h × 2 @ 60/hr) and 1 material (qty 3 @ $100/unit)
- WHEN a WO is generated
- THEN `estimated_hours = 20` (4×1 + 8×2)
- AND `estimated_parts_cost = 300` (3 × 100)
- AND `estimated_labor_cost = 1160` (4×1×50 + 8×2×60)

#### Scenario: Floating-clock schedule advances from last_completion_date

- GIVEN a pm_schedule with `is_floating = true`, `next_target_date = 2026-06-01`, `last_completion_date = 2026-05-25`, `time_frequency_days = 30`
- WHEN `generate_due_preventive_work_orders()` processes it
- THEN `next_target_date = 2026-05-25 + 30 days` (not 2026-06-01 + 30 days)

#### Scenario: Fixed-clock schedule unchanged

- GIVEN a pm_schedule with `is_floating = false` (or NULL), `next_target_date = 2026-06-01`, `time_frequency_days = 30`
- WHEN the function processes it
- THEN `next_target_date = 2026-06-01 + 30 days` (original behavior preserved)

#### Scenario: Task-level checklists are NOT cloned

- GIVEN a checklist_template with `job_plan_task_id` set (task-specific), matching the asset module
- WHEN a WO is generated
- THEN NO checklist_instance is created from that template — only plan-level (`job_plan_task_id IS NULL`) templates are cloned

#### Scenario: Empty job plan (no labor, no safety, no checklists, no materials)

- GIVEN a job_plan with NO labor, NO safety, NO materials, and no matching checklist_templates
- WHEN a WO is generated
- THEN the WO exists with `estimated_hours = 0`, `estimated_parts_cost = 0`, `estimated_labor_cost = 0`
- AND no rows in `work_order_labor_estimates` or `work_order_safety_requirements`

#### Scenario: System user placeholder exists for auto-generated checklists

- GIVEN no user with `id = '00000000-0000-0000-0000-000000000000'` in `user_profiles`
- WHEN the migration is applied
- THEN a system user is inserted into `auth.users` and `user_profiles` with that ID (idempotent, `ON CONFLICT DO NOTHING`)

## States Machine

```
generate_due_preventive_work_orders()
│
├── a. INSERT work_orders (PM, WAPPR)
├── b. INSERT material_requests FROM job_plan_materials
├── c. INSERT work_order_labor_estimates FROM job_plan_labor
├── d. INSERT work_order_safety_requirements FROM job_plan_safety
├── e. INSERT checklist_instances FROM checklist_templates
├── f. UPDATE work_orders SET estimated_* costs
└── g. UPDATE pm_schedules (last_completion_date, next_target_date)
```

Steps a–b are preserved from the original function. Steps c–f are new. Step g has modified floating-clock logic.

## Non-Functional Requirements

- **Idempotency**: The migration uses `INSERT ... ON CONFLICT DO NOTHING` for the system user seed; the function itself is deterministic per schedule state
- **Snapshot semantics**: `work_order_labor_estimates` and `work_order_safety_requirements` are frozen at WO creation time — later job plan edits do NOT change historical WO estimates
- **Checklist `status` includes `PENDING`**: Relies on `checklist_instances.status` CHECK constraint already altered in `20260531000001` to accept `'PENDING'`
- **System user**: Well-known UUID `00000000-0000-0000-0000-000000000000` is seeded as a real user in `auth.users` + `user_profiles` to satisfy FK constraints on `checklist_instances.technician_id`
- **Task-level exclusion**: Only `checklist_templates` where `job_plan_task_id IS NULL` are cloned — task-specific templates are excluded per scope

## Acceptance Criteria

- [ ] Labor cloning: labor rows from job_plan appear in work_order_labor_estimates with correct columns
- [ ] Safety cloning: safety rows from job_plan appear in work_order_safety_requirements with correct columns
- [ ] Checklist attachment: matching templates create checklist_instances with status='PENDING'
- [ ] Task-level templates excluded from cloning
- [ ] Cost calculation produces correct estimated_hours, estimated_parts_cost, estimated_labor_cost
- [ ] Floating-clock: next_target_date advances from last_completion_date when is_floating = true
- [ ] Fixed-clock: next_target_date advances from current next_target_date (unchanged behavior)
- [ ] System user seed row exists in auth.users and user_profiles
- [ ] No regression on material inheritance or hierarchical suppression from the original function
