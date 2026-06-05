# Proposal: PDF Scheduled Reports

## Intent

Slice 3 of Phase 3 — enable users to configure recurring report schedules (daily, weekly, monthly) that automatically generate PDFs and send them via email without manual intervention.

## Scope

### In Scope
- `report_schedules` table: id, name, template_code, cron_expression, recipients (text[]), subject, params (JSONB), is_active, last_run_at, next_run_at, created_at, updated_at
- pg_net extension enablement migration (idempotent `CREATE EXTENSION IF NOT EXISTS pg_net`)
- `process_due_report_schedules()` SQL function — reads due schedules, calls `send-report` EF via `net.http_post()`
- pg_cron job scheduling the function every 15 minutes
- Internal auth: `X-Internal-Secret` header shared between pg_cron and `send-report` EF (bypasses JWT for internal calls)
- RLS on `report_schedules`: ADMIN CRUD, PLANNER read
- Frontend panel: list, create, edit, delete, toggle active schedules

### Out of Scope
- Email delivery confirmation (Resend handles it)
- Report preview before scheduling
- Complex scheduling UI (plain cron expression input)
- Retry logic beyond what pg_cron provides

## Capabilities

### New Capabilities
- `scheduled-report-delivery`: Automated PDF generation and email delivery on a cron schedule

### Modified Capabilities
- None

## Approach

1. Create migration `20260605100003_pdf_scheduled_reports.sql`: enable `pg_net` extension, create `report_schedules` table with RLS, implement `process_due_report_schedules()` function, schedule pg_cron job every 15 min
2. `process_due_report_schedules()` queries `report_schedules WHERE is_active = true AND next_run_at <= NOW()`, calls `net.http_post()` to the `send-report` EF URL with `X-Internal-Secret` header and schedule params as body
3. Modify `send-report` EF: accept `X-Internal-Secret` as alternative auth (bypass JWT check when secret matches `INTERNAL_SECRET` env var)
4. Add `INTERNAL_SECRET` to `.env.example`
5. Frontend: MUI dialog for schedule CRUD, cron expression text input, toggle switch for is_active

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260605100003_pdf_scheduled_reports.sql` | New | Table, function, cron job |
| `supabase/functions/send-report/index.ts` | Modified | Internal secret auth bypass |
| `src/components/schedules/` | New | Schedule list + CRUD panel |
| `src/hooks/useReportSchedules.js` | New | Data fetching hook |
| `.env.example` | Modified | Add `INTERNAL_SECRET` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| pg_net HTTP call timeout (5s default) | Low | Increase timeout in `net.http_post()` params |
| Internal secret leaked in SQL | Low | Store as `pg_settings` custom GUC, not in migration code |
| Cron fires overlapping runs | Low | Add advisory lock in `process_due_report_schedules()` |

## Rollback Plan

- Unschedule cron job: `cron.unschedule('pdf_scheduled_reports')`
- Drop migration: `DROP TABLE IF EXISTS report_schedules CASCADE`, `DROP EXTENSION IF EXISTS pg_net`
- Revert `send-report/index.ts` changes
- Delete frontend components

## Dependencies

- pg_net extension available in Supabase (confirmed ✅, not yet installed)
- `send-report` EF working (confirmed ✅)
- Resend API key configured (confirmed ✅)
- Browserless API key configured (confirmed ✅)

## Success Criteria

- [ ] Schedule with cron `0 9 * * *` runs daily at 9 AM and delivers PDF to recipients
- [ ] `report_schedules` rows properly store and evaluate `next_run_at` / `last_run_at`
- [ ] Internal secret auth is validated end-to-end (pg_cron → EF bypasses JWT)
- [ ] Frontend panel shows schedules with correct status, create/edit/delete works
- [ ] pgCron log shows `process_due_report_schedules()` executing without error
- [ ] Disabled schedules (is_active=false) are skipped
