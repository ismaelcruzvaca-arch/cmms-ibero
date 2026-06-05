# Delta for PM Engine — Preventive Maintenance Automata

## ADDED Requirements

### Requirement: Clone job_plan_labor on WO Generation

The `generate_due_preventive_work_orders()` function MUST clone `job_plan_labor` rows into `work_order_labor_estimates` when generating a preventive WO from a job plan.

#### Scenario: Labor estimates cloned to WO

- GIVEN a job plan with labor rows: ELECTRICIAN 2h × 1 head_count, MECHANIC 1h × 2 head_count
- WHEN `generate_due_preventive_work_orders()` creates a WO from this plan
- THEN `work_order_labor_estimates` SHALL contain two rows with matching trade, estimated_hours, and head_count, linked to the new WO

### Requirement: Clone job_plan_safety on WO Generation

The function MUST clone `job_plan_safety` rows into `work_order_safety_requirements` when generating a preventive WO.

#### Scenario: Safety requirements cloned to WO

- GIVEN a job plan with safety rows: LOTO, PTW
- WHEN a WO is generated
- THEN `work_order_safety_requirements` SHALL contain LOTO and PTW rows with the same safety_type, description, and is_mandatory, linked to the new WO

### Requirement: Attach Checklist Templates on WO Generation

The function MUST instantiate `checklist_templates` into `checklist_instances` in PENDING status when generating a preventive WO. If a template has a `job_plan_task_id`, it SHALL be linked to the task in the WO.

#### Scenario: Plan-level checklist instantiated

- GIVEN a checklist_template with job_plan_task_id=NULL linked to a job plan
- WHEN a WO is generated
- THEN a checklist_instance SHALL be created with status='PENDING', linked to the WO

#### Scenario: Task-level checklist instantiated

- GIVEN a checklist_template with job_plan_task_id set for a specific task in a job plan
- WHEN a WO is generated
- THEN a checklist_instance SHALL be created with status='PENDING', linked to the WO AND referencing the task

### Requirement: Set Work Order Estimated Costs

The function MUST set `work_order.estimated_hours`, `work_order.estimated_parts_cost`, and `work_order.estimated_labor_cost` based on the cloned data.

#### Scenario: Estimated costs computed from cloned data

- GIVEN a job plan with 1 ELECTRICIAN × 2h, materials planned_qty=3 × unit_cost=10
- WHEN a WO is generated
- THEN work_order.estimated_hours = 2, estimated_parts_cost = 30, estimated_labor_cost = 2 × default_rate
