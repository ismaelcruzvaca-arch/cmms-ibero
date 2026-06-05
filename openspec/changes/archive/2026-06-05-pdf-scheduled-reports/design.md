# Design: PDF Scheduled Reports (Slice 3, Phase 3)

## Technical Approach

pg_cron fires `process_due_report_schedules()` every 15 min. That SQL function reads due rows from `report_schedules`, calls `send-report` EF via `net.http_post()` with an internal secret header, then updates `last_run_at`/`next_run_at`. Frontend CRUD via a new Admin sub-tab, following `PolicyManagementPanel` patterns.

## Architecture Decisions

### Decision: Internal Auth (send-report bypass)

| Option | Tradeoff |
|--------|----------|
| A: SR key in SQL | Simple, but key lives in migration SQL (git history) |
| B: X-Internal-Secret env var on EF, stored in DB config table | Clean separation; secret readable only by SECURITY DEFINER function |
| C: Separate internal-only EF | More to deploy, auth is implicit |

**Choice**: B. Secret seeded via `gen_random_uuid()` in `report_schedule_config` table. SQL function reads it at runtime → passes as `X-Internal-Secret` header → EF compares with `INTERNAL_SECRET` env var. Post-deployment rotate via supabase CLI.

### Decision: Next Run Calculation

| Option | Tradeoff |
|--------|----------|
| A: PL/pgSQL cron parser | Complex, error-prone, custom code |
| B: Frontend JS cron-parser + SQL fallback | Simple, shared lib available, minimal SQL helper |
| C: Always via EF callback | Extra round-trip, coupling |

**Choice**: B. Frontend uses `cron-parser` npm package on INSERT/UPDATE to compute `next_run_at`. SQL function `cron_next(cron_expr, from)` advances by period (daily→1d, weekly→7d, hourly→1h, fallback→1d). This gives accurate initial value and auto-advance without a JS runtime in SQL.

### Decision: Error Isolation

| Option | Tradeoff |
|--------|----------|
| A: RAISE + abort all | Simple but one bad schedule blocks others |
| B: BEGIN/EXCEPTION per schedule | Isolated failures, audit via WARNING log |

**Choice**: B. Each schedule wrapped in `BEGIN/EXCEPTION`. On error: `RAISE WARNING` + continue. Only success triggers `last_run_at`/`next_run_at` update.

### Decision: Frontend Placement

| Option | Tradeoff |
|--------|----------|
| A: New top-level tab | More navigation clutter |
| B: Admin sub-tab (`schedules`) | Follows existing pattern, role-gated automatically |

**Choice**: B. Add `'schedules'` as another `adminSubTab` value alongside `'templates'`/`'editor'`. Visible only to ADMIN (PLANNER read-only).

## Data Flow

```
pg_cron (every 15 min)
  │
  ▼
process_due_report_schedules()
  │  SELECT * FROM report_schedules
  │  WHERE is_active AND next_run_at <= NOW();
  │  FOR EACH row:
  │    ├─ BEGIN
  │    │   SELECT value FROM report_schedule_config WHERE key='internal_secret'
  │    │   net.http_post(
  │    │     url = '<EF-URL>',
  │    │     headers = '{"X-Internal-Secret":"<secret>","Content-Type":"application/json"}',
  │    │     body = jsonb_build_object(
  │    │       'to', recipients,
  │    │       'subject', subject,
  │    │       'template_code', template_code,
  │    │       'data', params
  │    │     )
  │    │   );
  │    │   UPDATE SET last_run_at=NOW(), next_run_at=cron_next(cron_expression, NOW());
  │    ├─ EXCEPTION WHEN OTHERS → RAISE WARNING + continue
  │    └─ END;
  │
  ▼
send-report Edge Function
  │  Check X-Internal-Secret header
  │  ├─ matches INTERNAL_SECRET → skip JWT
  │  └─ missing/wrong → normal JWT auth
  │  Resolve template → Render HTML → Browserless PDF → Resend API
  │
  ▼
Resend → Email with PDF attachment
```

## Component Design

### Database: `report_schedules`

```sql
CREATE TABLE report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_code TEXT NOT NULL,
  cron_expression TEXT NOT NULL,     -- standard 5-field cron
  recipients TEXT[] NOT NULL,        -- email addresses
  subject TEXT NOT NULL,
  params JSONB DEFAULT '{}',         -- passed as `data` to send-report
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- report_schedule_config: single-row key/value for internal secret
CREATE TABLE report_schedule_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

RLS: ADMIN full CRUD, PLANNER read-only, TECHNICIAN denied. Same pattern as `report_templates`.

### SQL: `cron_next(cron_expr TEXT, from_time TIMESTAMPTZ)`

Parses the first 3 fields (minute, hour, day-of-month) to determine period. Returns `from_time + INTERVAL '1 day'` for daily, `+ '7 days'` for weekly, `+ '1 month'` for monthly, `+ '1 hour'` for sub-daily. Unrecognized patterns default to +1 day. Pure SQL, STABLE.

### SQL: `process_due_report_schedules()`

```sql
CREATE OR REPLACE FUNCTION process_due_report_schedules()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sched RECORD;
  secret TEXT;
  ef_url TEXT;
BEGIN
  -- Advisory lock: prevent overlapping runs
  IF NOT pg_try_advisory_xact_lock(hashtext('process_due_report_schedules')) THEN
    RAISE WARNING 'process_due_report_schedules: concurrent run skipped';
    RETURN;
  END IF;

  -- Read config
  SELECT value INTO secret FROM report_schedule_config WHERE key = 'internal_secret';
  ef_url := current_setting('app.report_ef_url', true);
  IF ef_url IS NULL THEN
    ef_url := current_setting('supabase_url') || '/functions/v1/send-report';
  END IF;

  FOR sched IN
    SELECT * FROM report_schedules
    WHERE is_active AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := ef_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Internal-Secret', secret
        ),
        body := jsonb_build_object(
          'to', sched.recipients,
          'subject', sched.subject,
          'template_code', sched.template_code,
          'data', sched.params
        )
      );
      UPDATE report_schedules
      SET last_run_at = NOW(),
          next_run_at = cron_next(sched.cron_expression, NOW())
      WHERE id = sched.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'process_due_report_schedules: schedule % failed: %', sched.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
```

### Edge Function: send-report modification

In `handleRequest()`, before JWT validation:

```typescript
// 0. Internal auth bypass
const internalSecret = request.headers.get('X-Internal-Secret');
if (internalSecret && internalSecret === Deno.env.get('INTERNAL_SECRET')) {
  // Bypass JWT — internal call via pg_cron
} else {
  // Normal JWT validation
  const authResult = await validateAuth(request, supabase);
  if (!authResult.ok) return authResult.response;
}
```

### Frontend: `ScheduleManagementPanel.jsx`

Same structure as `PolicyManagementPanel`:
- **Table columns**: Name, Template, Cron, Recipients, Active (Switch), Last Run, Next Run, Actions
- **Create/Edit dialog**: Name (text), Template Code (select from `report_templates`), Cron Expression (text with helper), Recipients (email chips), Subject (text), Params (JSON editor), Active (Switch)
- **Delete**: confirmation dialog, ADMIN only
- **Toggle active**: Switch calls `UPDATE report_schedules SET is_active = $1 WHERE id = $2`
- **Cron helper**: uses `cron-parser` to preview `next_run_at` as user types

### Frontend: `useReportSchedules.js`

Exposes `{ schedules, loading, error, create, update, remove, toggleActive, refresh }`. Uses `supabase` client directly (same pattern as `useTemplates`). Computes `next_run_at` client-side via `cron-parser` before insert.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260605100003_pdf_scheduled_reports.sql` | Create | Table, config seed, cron_next(), process_due_report_schedules(), pg_cron job |
| `supabase/functions/send-report/index.ts` | Modify | Add X-Internal-Secret auth bypass before JWT check |
| `supabase/functions/send-report/index_test.ts` | Modify | Add 2 tests: valid internal secret bypasses JWT, wrong secret falls through to 401 |
| `src/components/schedules/ScheduleManagementPanel.jsx` | Create | MUI CRUD panel following PolicyManagementPanel pattern |
| `src/components/schedules/ScheduleManagementPanel.test.jsx` | Create | Vitest tests: renders list, create dialog, toggle, delete confirm |
| `src/hooks/useReportSchedules.js` | Create | Data hook with cron-parser for next_run_at |
| `src/hooks/useReportSchedules.test.js` | Create | Hook tests: fetch, create, toggle, error states |
| `src/App.jsx` | Modify | Add `'schedules'` to `adminSubTab` states, render `ScheduleManagementPanel` when active |
| `.env.example` | Modify | Add `INTERNAL_SECRET=genera-un-secreto-aleatorio-aqui` |

## Interfaces / Contracts

### Internal send-report contract (from pg_cron)

POST to send-report EF with headers:
```json
{
  "Content-Type": "application/json",
  "X-Internal-Secret": "<shared-secret>"
}
```

Body:
```json
{
  "to": ["admin@planta.com", "supervisor@planta.com"],
  "subject": "Reporte Diario - Órdenes de Trabajo",
  "template_code": "ot-default",
  "data": { "scope": "all_active" }
}
```

Note: `data`/`params` are schedule-specific JSON passed at creation time. The template engine resolves template variables against this data. If `record_id` was used instead, the EF fetches from the DB — but for scheduled reports, static params are safer (no dependency on live records).

### report_schedule_config schema

| key | value | purpose |
|-----|-------|---------|
| `internal_secret` | UUID string | Shared secret for pg_cron→EF auth |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (SQL) | `cron_next()` edge cases, `process_due_report_schedules()` with mock data | pgTAP via `supabase/db` test runner |
| Unit (Deno) | `handleRequest` internal auth bypass | Mock env + request headers, existing test pattern |
| Integration (Deno) | Full flow with mock fetch (auth→template→browserless→resend) | Existing `index_test.ts` pattern, add internal auth variant |
| Unit (Vitest) | `useReportSchedules` hook with mocked supabase | `vi.mock('../../lib/supabaseClient')` |
| Component (Vitest) | `ScheduleManagementPanel` render + CRUD flows | `@testing-library/react`, follow existing test patterns |

## Migration / Rollout

1. **Pre-deploy**: Set `INTERNAL_SECRET` env var on send-report EF via `supabase secrets set INTERNAL_SECRET=<uuid>` or Supabase dashboard
2. **Deploy EF**: `supabase functions deploy send-report`
3. **Run migration**: `supabase db push` — creates table, seeds config, creates function, schedules cron job
4. **Post-deploy**: Verify `SELECT process_due_report_schedules()` runs without error, check `cron.job` table
5. **Frontend**: Deploy new components alongside existing App.jsx changes

**Rollback**: `cron.unschedule('pdf_scheduled_reports')` → drop migration → revert EF → remove frontend components.

## Open Questions

- [ ] **resolved**: Internal auth approach chosen (Option B)
- [ ] **resolved**: Next run calculation (Option B — hybrid frontend/SQL)
- [ ] Should we add a `report_history` entry for each scheduled run? Proposal didn't mention it, but it would help audit. Decision: **no** — the schedule's `last_run_at` tracks execution. If needed, add in a future slice.
- [ ] `net.http_post()` default timeout is 5s — may need to increase via `net.http_set_timeout()` for complex reports. Decision: **monitor after launch** — if timeout errors appear, increase to 30s in a follow-up.
- [ ] The `INTERNAL_SECRET` EF env var must be set BEFORE deploying the modified EF, otherwise internal calls will fail auth. Include a deploy checklist step.
