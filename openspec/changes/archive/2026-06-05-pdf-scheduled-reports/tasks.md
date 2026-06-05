# Tasks: PDF Scheduled Reports (Slice 3, Phase 3)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1100–1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Backend (migration + EF) → PR 2: Frontend (hook + panel + wiring) → PR 3: Tests |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration + config + EF internal auth | PR 1 | ~293 lines, base = main |
| 2 | Frontend hook + component + App.jsx wiring | PR 2 | ~530 lines, base = main |
| 3 | Frontend hook + component tests | PR 3 | ~330 lines, depends on PR 2 |

## Phase 1: Foundation — Database Migration & Config

- [x] 1.1 Create migration `supabase/migrations/20260605100003_pdf_scheduled_reports.sql`: CREATE EXTENSION pg_net, report_schedules table, report_schedule_config table (seeded with `change-me-in-production`), RLS (ADMIN full CRUD, PLANNER read-only, TECHNICIAN denied), cron_next() SQL function, process_due_report_schedules() with BEGIN/EXCEPTION isolation + advisory lock, pg_cron job every 15 min
- [x] 1.2 Add `INTERNAL_SECRET=genera-un-secreto-aleatorio-aqui` to `.env.example`

## Phase 2: Backend — Edge Function Modification

- [x] 2.1 Modify `supabase/functions/send-report/index.ts`: add `X-Internal-Secret` bypass before JWT validation — if header matches `Deno.env.get('INTERNAL_SECRET')`, skip auth; otherwise (wrong secret → 401, missing → JWT fallback) (Design: Internal Auth Option B)
- [x] 2.2 Add internal auth tests to `supabase/functions/send-report/index_test.ts`: valid secret bypass (200), wrong secret returns 401, missing secret falls through to JWT (401), full integration flow with internal secret (200)

## Phase 3: Frontend — Hook, Component & Wiring

- [x] 3.1 Create `src/hooks/useReportSchedules.js`: expose `{ schedules, loading, error, create, update, remove, toggleActive, refresh }` — uses supabase client directly, computes `next_run_at` via `cron-parser` on insert (Design: Next Run Calculation Option B)
- [x] 3.2 Create `src/components/schedules/ScheduleManagementPanel.jsx`: MUI CRUD panel following PolicyManagementPanel pattern — table (name, template, cron, recipients, active switch, last_run, next_run, actions), create/edit dialog (name, template_code select, cron with parser preview, email chips, subject, JSON params, active switch), delete confirmation, loading/error/empty states (Spec: Frontend Schedule Management Panel)
- [x] 3.3 Modify `src/App.jsx`: add `'schedules'` to `adminSubTab` state union, import and render `ScheduleManagementPanel` when `adminSubTab === 'schedules'` alongside existing `'templates'`/`'editor'` branches (Design: Frontend Placement Option B)

## Phase 4: Testing

- [x] 4.1 Create `src/hooks/__tests__/useReportSchedules.test.js`: Vitest tests with mocked supabase — fetch schedules, create (computes next_run_at), update, toggleActive, remove, error states, empty state (Spec: all CRUD scenarios)
- [x] 4.2 Create `src/components/schedules/__tests__/ScheduleManagementPanel.test.jsx`: Vitest + @testing-library/react — renders list, create dialog flow, toggle active, delete confirmation, loading skeleton, error alert, empty state with CTA (Spec: List/Create/Delete/Toggle scenarios)
