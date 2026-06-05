# PM Due Calendar — Specification

## Purpose

Read-only projection of upcoming preventive work orders. Cross-references `pm_schedules`, `job_plans`, and `assets` into a flat calendar view with computed OVERDUE/PENDING status.

## Requirements

### Requirement: View projection

The system MUST provide a `pm_due_calendar` view that joins `pm_schedules` with `assets` and `job_plans`.

#### Scenario: All columns present

- GIVEN seed data with pm_schedules, assets, and job_plans
- WHEN querying `pm_due_calendar`
- THEN the view MUST expose 10 columns: schedule_id, asset_id, asset_name, job_plan_title, projected_date, wo_type, intervention_type, time_frequency_days, parent_schedule_id, status

#### Scenario: Meter-driven schedules excluded

- GIVEN a pm_schedule with `next_target_date IS NULL`
- THEN it MUST NOT appear in `pm_due_calendar` results

### Requirement: Status classification

The system MUST compute a `status` column classifying each row as `OVERDUE` or `PENDING`.

#### Scenario: Overdue schedule

- GIVEN a pm_schedule with `next_target_date <= CURRENT_DATE`
- WHEN querying the view
- THEN `status` MUST be `'OVERDUE'`

#### Scenario: Pending schedule

- GIVEN a pm_schedule with `next_target_date > CURRENT_DATE`
- WHEN querying the view
- THEN `status` MUST be `'PENDING'`

### Requirement: Ordering

The view MUST order results by `projected_date` ascending (soonest-first).

#### Scenario: Sort order

- GIVEN multiple pm_schedules with different next_target_date values
- WHEN querying `pm_due_calendar`
- THEN rows MUST be ordered by `projected_date ASC`
