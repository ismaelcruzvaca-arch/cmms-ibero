# Tasks: PM Due Calendar View

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

| Field | Value |
|-------|-------|
| Estimated changed lines | ~60 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

## Phase 1: Foundation

- [x] 1.1 Create migration `20260525000001_pm_due_calendar.sql` with `CREATE OR REPLACE VIEW pm_due_calendar` joining `pm_schedules`, `assets`, `job_plans`
- [x] 1.2 Add `COMMENT ON VIEW` and `COMMENT ON COLUMN` documentation (5 columns)

## Phase 2: Testing

- [x] 2.1 Write pgTAP test: verify view exists and returns rows with seed data
- [x] 2.2 Write pgTAP test: verify all 10 columns are present
- [x] 2.3 Write pgTAP test: verify `projected_date` ascending order

## Phase 3: Deploy

- [x] 3.1 Apply migration to Supabase production database
- [x] 3.2 Run pgTAP test suite against deployed migration
- [x] 3.3 Verify `SELECT * FROM pm_due_calendar` returns correct OVERDUE/PENDING status
