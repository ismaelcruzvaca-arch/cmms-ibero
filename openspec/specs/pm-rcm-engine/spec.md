# Spec: PM/RCM Engine — Phase 1 (Automation Layer)

## Part A: CBM Alert Trigger

### Requirement: `meter_id` on work_orders

The system MUST add a `meter_id` column to `work_orders` for tracing which sensor/sensor triggered a condition-based work order.

| Column | Type | Constraints |
|--------|------|-------------|
| meter_id | UUID | FK → meters(id), nullable, only set for CBM work orders |

#### Scenario: CBM work order links to meter

- GIVEN a meter reading exceeds a critical limit
- WHEN the trigger creates a work order
- THEN `work_orders.meter_id` = the meter that triggered the alert

### Requirement: `is_alert_triggered` on meter_readings

The system MUST add an `is_alert_triggered` boolean to `meter_readings` that marks rows where the reading crossed any threshold (warning or critical).

#### Scenario: Warning reading flagged

- GIVEN a measure_point with upper_limit_warning = 100
- WHEN inserting a reading with value = 105
- THEN `is_alert_triggered` = true
- AND NO work order is created

#### Scenario: Critical reading creates work order

- GIVEN a measure_point with upper_limit_critical = 120
- WHEN inserting a reading with value = 130
- THEN `is_alert_triggered` = true
- AND a work order is created with `wo_type = 'CBM'`
- AND the work order has `lifecycle_phase = 'WAPPR'`

#### Scenario: Anti-spam suppresses duplicate alerts

- GIVEN an existing CBM work order for asset A1 + meter M1 in WAPPR status
- WHEN inserting a new critical reading for A1 + M1
- THEN the reading is flagged `is_alert_triggered = true`
- BUT no new work order is created
- AND the existing work order is reused

#### Scenario: Normal reading below all thresholds

- GIVEN a measure_point with warning = 100, critical = 120
- WHEN inserting a reading with value = 50
- THEN `is_alert_triggered` remains FALSE
- AND no work order is created

#### Scenario: Lower limit critical

- GIVEN a measure_point with lower_limit_critical = 10
- WHEN inserting a reading with value = 5
- THEN `is_alert_triggered` = true
- AND a work order is created with `symptom_note` describing the low-limit breach

## Part B: PM Engine Automata

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
