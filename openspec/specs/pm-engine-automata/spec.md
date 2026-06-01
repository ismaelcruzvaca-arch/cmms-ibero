# PM Engine Automata — Specification

## Purpose

Automation layer for Preventive Maintenance (PM) work order generation. Defines the database function that scans `pm_schedules`, applies hierarchical suppression to avoid duplicate work orders, generates PM work orders with material inheritance from job plans, and recalculates the maintenance clock using fixed-clock mode.

## Requirements

### Requirement: `job_plan_id` on work_orders

The system MUST add a `job_plan_id` column to `work_orders` for tracing which job plan template originated a preventive work order.

| Column | Type | Constraints |
|--------|------|-------------|
| job_plan_id | UUID | FK → job_plans(id), nullable, only set for PM work orders |

### Requirement: `generate_due_preventive_work_orders()` function

The system MUST provide a function that scans `pm_schedules`, finds overdue entries, and generates work orders. It returns the count of work orders created (INT).

#### Scenario: Basic PM work order generation

- GIVEN a pm_schedule with `next_target_date = yesterday` and `time_frequency_days = 30`
- WHEN calling `generate_due_preventive_work_orders()`
- THEN 1 work order is created
- AND `wo_type = 'PM'`
- AND `lifecycle_phase = 'WAPPR'`
- AND `job_plan_id` matches the schedule's job_plan

#### Scenario: Hierarchical suppression (parent + child both due)

- GIVEN a parent schedule due today with child schedule also due today
- WHEN calling `generate_due_preventive_work_orders()`
- THEN only 1 work order is created (for the parent)
- AND the child is suppressed

#### Scenario: Child due, parent not due

- GIVEN a parent schedule not yet due, with a child schedule due today
- WHEN calling `generate_due_preventive_work_orders()`
- THEN 1 work order is created (for the child)
- AND the child is NOT suppressed

#### Scenario: Three-level hierarchy (grandparent → parent → child)

- GIVEN grandparent, parent, and child all due today
- WHEN calling `generate_due_preventive_work_orders()`
- THEN only 1 work order is created (for grandparent)
- AND both parent and child are suppressed

#### Scenario: Material inheritance from job plan

- GIVEN a job_plan with 2 materials linked
- WHEN a work order is generated for that job_plan
- THEN `material_requests` contains 2 rows linked to the new work order
- AND `part_num`, `line_desc`, `requested_qty` match the job_plan_materials

#### Scenario: No schedules due

- GIVEN NO pm_schedules have `next_target_date <= CURRENT_DATE`
- WHEN calling `generate_due_preventive_work_orders()`
- THEN the function returns 0

#### Scenario: Schedule with NULL time_frequency_days

- GIVEN a pm_schedule due today but with `time_frequency_days = NULL`
- WHEN calling `generate_due_preventive_work_orders()`
- THEN the function processes it (NULLS LAST ordering)
- AND a work order is generated
- AND `next_target_date` recalculation evaluates the NULL frequency

#### Scenario: Fixed-clock recalculation

- GIVEN a pm_schedule with `time_frequency_days = 30` and `next_target_date = 2026-05-01`
- WHEN calling `generate_due_preventive_work_orders()`
- THEN the schedule's `next_target_date` is updated to `2026-05-01 + 30 days`
- AND `last_completion_date` is set to `NOW()`

## Non-Functional Requirements

- **Idempotency**: The function MUST be safe to call repeatedly — calling it twice on the same data SHALL NOT generate duplicate work orders for already-processed schedules
- **Cycle safety**: Recursive CTE MUST include cycle detection (`NOT ps.id = ANY(dc.path)`) to prevent infinite recursion on circular `parent_schedule_id`
- **Ordering**: Schedules SHALL be processed by `time_frequency_days DESC NULLS LAST` to ensure parents are evaluated before children
- **Fixed-clock mode**: `next_target_date` SHALL advance by `time_frequency_days` from the current `next_target_date`, regardless of when the work order was completed (`is_floating = false`)
- **Security**: Function MUST use `SECURITY DEFINER SET search_path = public` for safe execution

## Acceptance Criteria

- [ ] `work_orders.job_plan_id` column added (nullable FK → job_plans(id)) for PM tracing
- [ ] `generate_due_preventive_work_orders()` deployed and syntactically valid
- [ ] Basic PM work order generation — overdue schedule produces 1 WO with correct fields
- [ ] Hierarchical suppression — parent + child due → only parent WO created
- [ ] Child without parent — child due, parent not due → child WO created
- [ ] Three-level hierarchy — grandparent due → only grandparent WO, children suppressed
- [ ] Material inheritance — materials from job_plan copied to material_requests
- [ ] Empty schedules — no due dates → function returns 0
- [ ] NULL time_frequency_days — schedule processed (NULLS LAST)
- [ ] Fixed-clock recalculation — `next_target_date` advances by frequency from previous target
- [ ] Function tested via pgTAP — 7 tests, 14 assertions
