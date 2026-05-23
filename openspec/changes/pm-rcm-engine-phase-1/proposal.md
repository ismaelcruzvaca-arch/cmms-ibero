# Proposal: PM/RCM Engine — Phase 1 (Automation Layer)

## Intent

Implement the execution layer of the Preventive & Condition-Based Maintenance engine. Two database components that transform `pm_schedules` and `meter_readings` into actionable work orders automatically, following ADR-03 architecture decisions.

## Scope

### In Scope

- **CBM Alert Trigger**: `BEFORE INSERT` trigger on `meter_readings` that evaluates readings against `measure_points` limits (warning/critical), marks alert flags, and auto-generates work orders for critical thresholds with anti-spam deduplication
- **PM Engine Automata**: PL/pgSQL function `generate_due_preventive_work_orders()` with recursive CTE hierarchical suppression (SAP/Maximo pattern), job plan material inheritance, and fixed-clock recalculation
- Schema extensions: `work_orders.meter_id` (UUID FK → meters), `work_orders.job_plan_id` (UUID FK → job_plans), `meter_readings.is_alert_triggered` (boolean)
- `BACKLOG.md` updated with schema drift documentation (blocker for PM Engine deployment)

### Out of Scope

- pg_cron job scheduling (requires Supabase Cron Jobs or scheduler service)
- Frontend UI for PM schedule management
- Materialized view `pm_due_calendar` (planned for later phase)
- Edge Function `pm-engine` administration interface
- Migration of production schema drift (documented as technical debt)

## Capabilities

### New Capabilities

- `cbm-alert-trigger`: Auto-generates CBM work orders from meter readings exceeding critical limits, with warning-only mode for non-critical thresholds
- `pm-engine-automata`: Scans overdue pm_schedules, suppresses hierarchical duplicates, generates preventive work orders with material inheritance

### Modified Capabilities

- `work-orders-schema`: Added `meter_id` (CBM tracing) and `job_plan_id` (PM tracing) foreign keys
- `meter-readings-schema`: Added `is_alert_triggered` boolean flag

## Risks

| Risk | Mitigation |
|------|------------|
| Production schema drift blocks PM Engine deployment | Documented in BACKLOG.md as CRITICAL debt; migration gated behind schema alignment |
| Anti-spam logic may suppress legitimate re-alerts | Anti-spam only blocks same asset+meter+wo_type while OT is open (WAPPR/APPROVED/INPRG); closed OTs allow new alerts |
| Recursive CTE could loop on circular parent_schedule_id | Cycle detection via `NOT ps.id = ANY(dc.path)` prevents infinite recursion |
