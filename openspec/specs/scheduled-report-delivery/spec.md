# scheduled-report-delivery Specification

## Purpose

Automated PDF generation and email delivery on configurable cron schedules. A SQL function polls `report_schedules` every 15 minutes via pg_cron and invokes the `send-report` Edge Function through pg_net with internal auth.

## Requirements

### Requirement: report_schedules Table

The system MUST provide a `report_schedules` table with: `id` (UUID PK), `name` (TEXT NOT NULL), `template_code` (TEXT NOT NULL), `cron_expression` (TEXT NOT NULL), `recipients` (TEXT[] NOT NULL), `subject` (TEXT NOT NULL), `params` (JSONB DEFAULT '{}'), `is_active` (BOOLEAN DEFAULT true), `last_run_at` (TIMESTAMPTZ), `next_run_at` (TIMESTAMPTZ NOT NULL), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `updated_at` (TIMESTAMPTZ DEFAULT NOW()). RLS MUST enforce ADMIN full CRUD, PLANNER read-only, TECHNICIAN no access. No seed data is required.

#### Scenario: Admin creates a schedule

- GIVEN an authenticated ADMIN user
- WHEN they INSERT into `report_schedules` with valid fields
- THEN the row is created with `is_active=true` and `next_run_at` calculated from `cron_expression`

#### Scenario: Planner reads all schedules

- GIVEN an authenticated PLANNER user
- WHEN they SELECT from `report_schedules`
- THEN all rows are returned

#### Scenario: Technician sees no schedules

- GIVEN an authenticated TECHNICIAN user
- WHEN they SELECT from `report_schedules`
- THEN the RLS policy returns zero rows

### Requirement: pg_net Extension

The migration MUST enable `pg_net` idempotently via `CREATE EXTENSION IF NOT EXISTS pg_net`.

#### Scenario: Idempotent enablement

- GIVEN `pg_net` is already installed
- WHEN the migration runs
- THEN no error occurs and the extension remains enabled

### Requirement: process_due_report_schedules() Function

The system MUST provide `process_due_report_schedules()` that queries `report_schedules WHERE is_active=true AND next_run_at <= NOW()`. For each due schedule, it MUST call `net.http_post()` to the `send-report` EF URL with `X-Internal-Secret` header and schedule params/recipients as the POST body. After each schedule, it MUST update `last_run_at=NOW()` and recalculate `next_run_at`. Individual schedule failures MUST be caught and logged without aborting other schedules. The function SHOULD use an advisory lock to prevent concurrent execution.

#### Scenario: Processes all due schedules

- GIVEN two active schedules with `next_run_at` in the past
- WHEN `process_due_report_schedules()` executes
- THEN `net.http_post()` is called twice with the correct headers
- AND both schedules have updated `last_run_at` and a future `next_run_at`

#### Scenario: Skips inactive schedules

- GIVEN a schedule with `is_active=false` and `next_run_at` in the past
- WHEN `process_due_report_schedules()` executes
- THEN the schedule is skipped and `net.http_post()` is NOT called

#### Scenario: Isolated failure handling

- GIVEN three due schedules where the second `net.http_post()` throws
- WHEN `process_due_report_schedules()` executes
- THEN the first and third schedules are processed and updated
- AND the second schedule's error is logged but does not block the third

### Requirement: pg_cron Job

The migration MUST schedule `process_due_report_schedules()` every 15 minutes. The scheduling MUST be idempotent: unschedule then schedule inside a DO block with a pg_cron extension guard (`IF EXISTS`).

#### Scenario: Job runs on interval

- GIVEN pg_cron is enabled and the job `pdf_scheduled_reports` exists
- WHEN 15 minutes elapse
- THEN cron executes `SELECT process_due_report_schedules()`

#### Scenario: Idempotent re-scheduling

- GIVEN the migration has already run and the job exists
- WHEN the migration runs again
- THEN the existing job is unscheduled and recreated without error

### Requirement: Internal Auth on send-report EF

The `send-report` Edge Function MUST accept an optional `X-Internal-Secret` header. If it matches the `INTERNAL_SECRET` env var, JWT validation MUST be bypassed. If missing or incorrect, normal JWT auth MUST apply. The `INTERNAL_SECRET` env var MUST be documented in `.env.example`.

#### Scenario: Internal call bypasses JWT

- GIVEN a request with `X-Internal-Secret` matching `INTERNAL_SECRET`
- WHEN POSTing to `send-report`
- THEN auth succeeds without a JWT and the function processes the request

#### Scenario: Wrong secret falls through to JWT

- GIVEN a request with `X-Internal-Secret` NOT matching `INTERNAL_SECRET`
- WHEN POSTing to `send-report`
- THEN normal JWT auth applies (returns `401` if no valid JWT is present)

### Requirement: Frontend Schedule Management Panel

The system MUST provide an MUI panel (following PolicyManagementPanel patterns) with: a table listing all schedules (name, template, cron, active status, last_run, next_run), and a Create/Edit dialog with fields for name, template selector, cron expression, recipients, subject, and params. ADMIN MUST have full CRUD; PLANNER read-only. Delete MUST require confirmation. Toggling `is_active` via a Switch MUST update the row immediately. The panel MUST show loading, empty, and error states.

#### Scenario: List schedules on load

- GIVEN an authenticated ADMIN user on the schedules panel
- WHEN the panel loads
- THEN a table displays all `report_schedules` with their status and run times

#### Scenario: Create a new schedule

- GIVEN the "New Schedule" dialog is open with all required fields
- WHEN the user fills valid data and clicks Create
- THEN the schedule is inserted and appears in the table

#### Scenario: Delete with confirmation

- GIVEN an existing schedule in the table
- WHEN the admin clicks Delete
- THEN a confirmation dialog appears
- AND on confirm the schedule is deleted and removed from the table

#### Scenario: Toggle active state

- GIVEN an active schedule
- WHEN the admin toggles the `is_active` Switch off
- THEN the row is updated and the table reflects the inactive state

### Requirement: Next Run Calculation

On INSERT or UPDATE of `report_schedules`, the system MUST calculate `next_run_at` from `cron_expression`. On successful execution, `process_due_report_schedules()` MUST set `last_run_at=NOW()` and compute the new `next_run_at`. The calculation MAY use an application-side cron parser or pg_cron's built-in evaluation.

#### Scenario: Calculated on insert

- GIVEN a new schedule with `cron_expression '0 9 * * *'`
- WHEN the row is inserted
- THEN `next_run_at` is set to the next 09:00 UTC from the current time

#### Scenario: Advanced after successful run

- GIVEN a schedule that just ran successfully at 09:00 UTC
- WHEN `process_due_report_schedules()` updates it
- THEN `last_run_at` is set to 09:00 UTC AND `next_run_at` advances to 09:00 UTC the next day
