## Exploration: Labor Reporting / Time Tracking

### Current State

**The codebase has ZERO labor tracking today.** No clock-in/out, no time entries, no technician hours against work orders. The mechanic UI (Phase 2 — Execution) allows lifecycle transitions (APPROVED→INPRG→COMP→CLOSED) and technical notes, but does not capture who worked how long on what.

**Relevant existing schema:**

- **`user_profiles`** — id (UUID FK auth.users), full_name (TEXT), role (TEXT: mechanic/supervisor/planner/admin), erp_employee_num (TEXT UNIQUE — EmployeeNum in Epicor). This is the technician identity but has NO labor/qualification data.
- **`work_orders`** — has `planned_hours` (NUMERIC) and `actual_hours` (NUMERIC) as simple aggregate fields on the WO itself. Also has `actual_start_at` and `completed_at` timestamps that hint at actual work windows but are not tied to individual technicians.
- **`job_plans`** — has `estimated_hours` per plan (used by PM Engine to set `planned_hours` on generated WOs).

**Existing mechanic UI flow:**

```
MechanicDashboard (container)
  ├── WorkOrderList (presenter)
  │    └── WorkOrderCard (presenter)
  └── WorkOrderDrawer (container)
       ├── WorkOrderDetail (presenter — read-only)
       ├── WorkOrderNotesForm (presenter — conditional in INPRG)
       └── WorkOrderActions (presenter — phase-driven buttons)
```

The mechanic taps a card → drawer opens → sees WO details → fills notes (if INPRG) → clicks action button → confirms → RxDB updates → drawer closes.

**No labor concept exists anywhere in the UI or backend.** The `actual_hours` field on `work_orders` exists in the schema but is never populated by the mechanic UI. It would need to be auto-calculated from labor records or manually entered.

**FSM lifecycle touch points for labor:**

| Transition | What happens today | What could happen |
|---|---|---|
| APPROVED → INPRG | Click "Iniciar" → confirm → sets lifecycle_phase = INPRG | + Clock-in the technician, create labor_record with start_time |
| INPRG → COMP | Fill notes → click "Completar" → confirm → sets lifecycle_phase = COMP | + Clock-out, set end_time, calculate hours_worked on labor_record |
| COMP → CLOSED | Click "Cerrar" → confirm → sets lifecycle_phase = CLOSED | + Auto-sum labor hours → update work_orders.actual_hours |

**RxDB offline-first architecture:**

All data flows through RxDB with Dexie storage, then syncs to Supabase via manual pull/push replication handlers. The replication pattern is:
- `createPullHandler(tableName, orderField)` — generic pull from Supabase
- `createPushHandler(tableName, fields)` — generic push to Supabase
- `createWorkOrderPushHandler(tableName)` — special handler for work_orders with conflict detection

**Existing test patterns:**
- SQL: pgTAP (BEGIN/ROLLBACK, plan()/finish(), is(), throws_ok())
- JS: Playwright tests with Supabase client authentication

---

### Affected Areas

#### Database (Supabase migrations)
| File | What needs to change |
|---|---|
| `supabase/migrations/202605<next>_labor_records.sql` | **NEW** — Create `labor_records` table, RLS policies, FSM triggers for auto clock-in/out, audit trigger |
| `supabase/migrations/202605<next>_crafts_qualifications.sql` | **NEW** — Create `crafts` and `technician_crafts` tables (separate from labor_records per mandate) |
| `supabase/migrations/202605<next>_labor_analytics.sql` | **NEW** (optional) — Wrench Time views, productivity metrics materialized views |
| `supabase/tests/database/labor_records_test.sql` | **NEW** — pgTAP test suite for labor_records triggers and FSM integration |
| `supabase/tests/database/crafts_test.sql` | **NEW** — pgTAP test suite for crafts data integrity |

#### Backend logic
| File | What needs to change |
|---|---|
| `src/lib/rxdb.js` | **MODIFY** — Add `labor_records` RxDB collection schema, replication handlers, migration strategies |
| `src/lib/fsm.js` | **MODIFY** — Add labor-status-aware transitions or keep as-is (labor is separate) |

#### Frontend — New Components
| File | Description |
|---|---|
| `src/components/mechanic/LaborClockWidget.jsx` | **NEW** — Clock-in/out button rendered inside WorkOrderDrawer (or as a separate prompt) |
| `src/components/mechanic/TimeEntryList.jsx` | **NEW** — Optional: show logged time entries for a WO inside the drawer |
| `src/components/mechanic/LaborSummaryCard.jsx` | **NEW** — Show total logged hours vs planned hours in the drawer |
| `src/lib/adapters/laborAdapter.js` | **NEW** — Adapter for labor_records RxDB → ViewModel (same pattern as workOrderAdapter) |
| `src/hooks/useLaborRecords.js` | **NEW** — Hook for labor_records with RxDB subscription + sync (same pattern as useWorkOrders) |

#### Frontend — Modifications
| File | What needs to change |
|---|---|
| `src/pages/MechanicDashboard.jsx` | **MODIFY** — Wire labor records hook, pass labor state down to drawer |
| `src/components/mechanic/WorkOrderDrawer.jsx` | **MODIFY** — Add clock-in/out button, time entry display, labor validation before COMP |
| `src/components/mechanic/WorkOrderActions.jsx` | **MODIFY** — Optionally disable "Completar" if no clock-in recorded |

#### Analytics / Reports (future)
| File | Description |
|---|---|
| `src/pages/LaborDashboard.jsx` | **NEW** — Wrench Time dashboard, technician productivity, labor cost |
| `src/components/reports/LaborProductivityChart.jsx` | **NEW** — Chart components for labor KPIs |

---

### Approaches

#### Approach 1: Simple labor_records table (just hours against WO, no clock-in/out)

**Description**: A single `labor_records` table where the mechanic manually enters hours worked on a WO. No clock-in/out, no geolocation, no real-time tracking. The mechanic opens the WO drawer, taps a "Log Hours" field, enters the number of hours, and saves.

**Schema:**
```sql
CREATE TABLE labor_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  hours_worked NUMERIC NOT NULL CHECK (hours_worked > 0),
  date_logged DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Pros:**
- Simplest possible implementation — minimal schema, minimal UI
- No FSM coupling — works independently of lifecycle phases
- Easy offline-first support (single RxDB collection, straightforward replication)
- Low risk, fast to build
- The mechanic can log hours at any point (retroactively if needed)

**Cons:**
- No real-time tracking — relies on manual data entry (prone to estimation errors)
- Cannot calculate Wrench Time accurately (no actual start/end, just self-reported hours)
- No way to verify when work actually happened
- Misses the opportunity to tie labor to the FSM lifecycle naturally
- Multiple technicians on one WO requires separate entries (manual)

**Effort**: Low
- Schema: ~50 lines SQL
- RxDB: ~80 lines (schema + replication)
- UI: ~150 lines (input field in drawer + hook)
- Tests: ~100 lines

---

#### Approach 2: Clock-in/out with timestamps (captures actual start/end times)

**Description**: The mechanic clocks in when starting a WO (APPROVED → INPRG) and clocks out when completing it (INPRG → COMP). Each clock event creates a `labor_records` row with start/end timestamps, and hours are auto-calculated from the difference. Supports pausing and multiple technicians on the same WO.

**Schema:**
```sql
CREATE TABLE labor_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  hours_worked NUMERIC GENERATED ALWAYS AS (
    CASE WHEN clock_out_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 3600
      ELSE NULL
    END
  ) STORED,
  pause_minutes NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**FSM Integration:**
- APPROVED → INPRG: Auto clock-in (create labor_record with clock_in_at = NOW() if not already clocked in)
- INPRG → COMP: Auto clock-out (set clock_out_at = NOW() on the active labor_record)
- Optional: pause/resume within INPRG
- After COMP → CLOSED: Auto-sum all labor_records.hours_worked → work_orders.actual_hours

**Pros:**
- Accurate time capture — no estimation, actual wall-clock time
- Natural FSM integration — clock-in/out aligns with lifecycle transitions
- Supports Wrench Time calculation: `SUM(hours_worked) / planned_hours` across technicians
- Audit trail — knows exactly when each technician worked
- Can support geolocation later (store lat/lng on clock_in/out)
- Multiple technicians on same WO = multiple labor_records rows

**Cons:**
- More complex FSM coupling — need to prevent transition without clock-in/out
- Must handle edge cases: forgot to clock in, forgot to clock out, network interruption during clock-in
- Offline clock-in must be handled carefully (clock on device, sync later)
- Auto clock-out on COMP might surprise the mechanic if they need to continue working
- Requires a "clock is still running" awareness in the UI

**Effort**: Medium
- Schema: ~80 lines SQL (with generated columns + FSM trigger adjustments)
- RxDB: ~120 lines (schema + replication + conflict handling for time-sensitive data)
- UI: ~300 lines (clock widget, active timer indicator, pause/resume, safety nets)
- Tests: ~200 lines (FSM edge cases, offline scenarios, multi-technician)

---

#### Approach 3: Full labor reporting (clock-in/out + craft assignment per shift + labor cost rates)

**Description**: Everything from Approach 2, plus:
- **Technician crafts/qualifications** table (as mandated — completely separate from labor_records)
- **Shift management** — technicians assigned to shifts, overtime calculation
- **Labor cost rates** — hourly rate per technician or per craft, cost calculation
- **Wrench Time analytics** — views/function for wrench time %, labor utilization, cost per WO
- **Geolocation on clock-in/out** — verify technician was on-site

**Additional Schema:**
```sql
-- SEPARATE from labor_records — master data, not transactional
CREATE TABLE crafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_hourly_rate NUMERIC
);

CREATE TABLE technician_crafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES user_profiles(id),
  craft_id UUID NOT NULL REFERENCES crafts(id),
  certification_date DATE,
  expiration_date DATE,
  is_primary BOOLEAN DEFAULT false,
  UNIQUE(technician_id, craft_id)
);

-- Cost extension on labor_records
ALTER TABLE labor_records ADD COLUMN craft_id UUID REFERENCES crafts(id);
ALTER TABLE labor_records ADD COLUMN hourly_rate NUMERIC;

-- Analytics views
CREATE VIEW wrench_time_summary AS
SELECT
  technician_id,
  DATE_TRUNC('week', clock_in_at) AS week,
  SUM(hours_worked) AS total_hours,
  AVG(hours_worked / NULLIF(wo.planned_hours, 0)) AS efficiency
FROM labor_records lr
JOIN work_orders wo ON wo.id = lr.work_order_id
GROUP BY technician_id, DATE_TRUNC('week', clock_in_at);
```

**Pros:**
- Complete labor productivity solution — covers all requirements including Wrench Time
- Crafts are properly separated from labor records (mandated architecture)
- Cost tracking enables ROI analysis per asset/technician
- Shift management enables compliance with labor regulations
- Geotagging prevents time theft / verifies site presence
- Future-proof — supports payroll integration with Epicor

**Cons:**
- Significantly more complex — 3+ new tables instead of 1
- High effort for Phase 1 — crafts/qualifications are master data that need administration UI
- Cost rates introduce security concerns (who can see/edit rates)
- Shift management adds another domain dependency
- Risk of over-engineering if Wrench Time is the only KPI needed initially
- Geotagging introduces privacy considerations

**Effort**: High
- Schema: ~200 lines SQL (3+ tables, views, triggers, RLS for cost data)
- RxDB: ~200 lines (multiple collections, careful conflict handling)
- UI: ~600+ lines (clock widget, craft selector, shift UI, admin screens for crafts/cost rates)
- Tests: ~350 lines (crafts, cost calculations, shift rules, geolocation)

---

### Recommendation

**Approach 2 — Clock-in/out with timestamps** is the recommended approach for the first iteration.

**Why:**

1. **Pragmatic middle ground** — Approach 1 is too simple (no accurate tracking, no Wrench Time), Approach 3 is too heavy for a first iteration (crafts admin, cost rates, shifts). Approach 2 gives accurate time data with manageable complexity.

2. **Natural FSM integration** — The clock-in/out events map 1:1 to the existing lifecycle transitions (APPROVED→INPRG = clock-in, INPRG→COMP = clock-out). This makes the UX intuitive: the mechanic starts work = clock in, finishes = clock out.

3. **Wrench Time ready** — With actual start/end times, Wrench Time = `SUM(technician_hours) / planned_hours` is straightforward. Adding a simple analytics view in the same migration is cheap.

4. **Offline-first viability** — Clock events are simple inserts with timestamps. Even if the device is offline, the mechanic can clock in/out, and the records sync when connectivity returns. Conflicts on time records are rare (no concurrent edits expected on the same record).

5. **Path to Approach 3** — Approach 2 is a subset of Approach 3. Adding crafts, cost rates, and shifts later only requires new tables and columns — no migration of existing labor_records data.

**What we do NOT do in Phase 1:**
- No crafts/qualifications table (mandated separate, Phase 2)
- No labor cost rates (Phase 2)
- No shift management (Phase 2 or later)
- No geolocation (Phase 2)
- No separate Labor Dashboard (Phase 2 — reports can use raw data)

**What we DO in Phase 1:**
- `labor_records` table with clock_in_at, clock_out_at, pause_minutes
- Auto clock-in on APPROVED→INPRG (with opt-out — mechanic can clock separately)
- Auto clock-out on INPRG→COMP (with manual override for multi-day WO)
- RxDB collection + replication for offline-first
- Simple FSM hook: validate clock-in exists before allowing COMP transition
- Auto-sum hours → `work_orders.actual_hours` after COMP
- RLS: TECHNICIAN can CRUD own records, PLANNER/ADMIN can see all

---

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Mechanic forgets to clock in** | High | Allow manual time entry as fallback. Show "No active clock-in" warning if APPROVED→INPRG is triggered without clock-in. Add admin override. |
| **Mechanic clocks in but doesn't clock out** | Medium | Open labor_record without clock_out_at is detected on next WO interaction ("You have an active clock from earlier"). Auto-close at midnight with admin notification. |
| **Offline clock-in with wrong device time** | Medium | Store `device_timestamp` alongside `clock_in_at`. On sync, use server time if available, warn if device time differs by >5 min. |
| **Multi-technician on same WO** | Medium | Each technician gets their own labor_record row (design supports this). UI needs to show multiple entries. |
| **Mechanic works on WO across multiple days** | Medium | Support pause/resume (Approach 2). Or allow clock-out at end of day and clock-in next day — but this creates multiple records for the same WO. Decision: multiple records are fine, auto-sum handles aggregation. |
| **FSM trigger prevents transition during network issues** | Low | Keep FSM validation server-side for race conditions, but allow local (RxDB) transitions. If server rejects, set `_conflict = true` on the WO. |
| **Wrench Time calculated incorrectly due to pauses** | Low | `pause_minutes` field on labor_records. Subtract from total. Default 0. |

---

### Ready for Proposal
**Yes.** The exploration is complete. The orchestrator should present the user with the three approaches, recommend Approach 2, and confirm scope before moving to proposal phase.

**Key question for the user before proposal:**
- Confirm single-site operation (no geolocation needed in Phase 1)?
- Confirm no need for crafts/qualifications in Phase 1 (per the mandate)?
- Preferred approach for multi-day WOs: pause/resume or multiple clock-in/out sessions?
