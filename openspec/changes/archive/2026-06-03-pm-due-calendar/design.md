# Design: PM Due Calendar View

## Technical Approach

Single idempotent PostgreSQL view (`CREATE OR REPLACE VIEW`) deployed as a Supabase migration. The view projects three joined tables (`pm_schedules`, `assets`, `job_plans`) with a computed `status` column and ascending date sort.

## Architecture Decisions

### Decision: View vs Materialized View

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `CREATE VIEW` | Always fresh; no stale data; negligible overhead for a simple join | ✅ Chosen |
| `MATERIALIZED VIEW` | Stale without refresh; adds cron maintenance | Rejected — no benefit for a trivial read-only join |

### Decision: Status classification in SQL vs application layer

| Option | Tradeoff | Decision |
|--------|----------|----------|
| CASE WHEN in view | Self-contained; any consumer sees the same status | ✅ Chosen |
| Compute in app | Duplicates logic per consumer | Rejected — violates DRY |

### Decision: Exclusion of NULL next_target_date

- **Choice**: `WHERE ps.next_target_date IS NOT NULL`
- **Rationale**: Meter-driven schedules have no time-based target date and cannot appear in a calendar view. Silent exclusion rather than error.

## Data Flow

```
pm_schedules ──┐
               ├──→ pm_due_calendar (VIEW) ──→ Supabase REST/GraphQL
assets ────────┤
job_plans ─────┘
```

Simple left-to-right: source tables feed the view, consumed by Supabase auto-generated API for `GET /pm_due_calendar`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260525000001_pm_due_calendar.sql` | Create | DDL for the view + column comments |
| `supabase/tests/database/pm_due_calendar_test.sql` | Create | pgTAP tests (exists, columns, order) |

## Interfaces / Contracts

```sql
CREATE OR REPLACE VIEW pm_due_calendar AS
SELECT
  ps.id                 AS schedule_id,
  ps.asset_id,
  a.equipment_id        AS asset_name,
  jp.code               AS job_plan_title,
  ps.next_target_date   AS projected_date,
  'PM'::text            AS wo_type,
  jp.intervention_type,
  ps.time_frequency_days,
  ps.parent_schedule_id,
  CASE
    WHEN ps.next_target_date <= CURRENT_DATE THEN 'OVERDUE'
    ELSE 'PENDING'
  END                   AS status
FROM pm_schedules ps
JOIN assets a        ON a.id = ps.asset_id
JOIN job_plans jp    ON jp.id = ps.job_plan_id
WHERE ps.next_target_date IS NOT NULL
ORDER BY ps.next_target_date ASC;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (pgTAP) | View exists and returns rows | `SELECT ok(COUNT(*) > 0 FROM pm_due_calendar)` |
| Unit (pgTAP) | Column contract | `SELECT columns_are(...)` with all 10 columns |
| Unit (pgTAP) | Sort order | `LEAD(projected_date)` to verify ascending order |

## Migration / Rollout

No migration required beyond the idempotent DDL. Rollback: `DROP VIEW IF EXISTS pm_due_calendar CASCADE;`.

## Open Questions

None — already deployed and verified.
