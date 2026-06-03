# Design: Safety & Permits — Phase 1 (PTW + LOTO)

## Technical Approach

Single-migration, DB-only. Five tables (`permit_types`, `work_permits`, `permit_tasks`, `lockout_tagout`, `tagout_devices`) with FSM triggers, RLS, and audit — no frontend, no RxDB. Follows existing patterns: UUID PKs, Spanish COMMENTS, `audit_trigger_func()`, `get_user_role()` RLS, forward-only BEFORE UPDATE triggers.

## Architecture Decisions

### PTW FSM: Trigger-Based (same as work_orders)
| Option | Tradeoff | Decision |
|--------|----------|----------|
| **BEFORE UPDATE trigger** | Single source of truth, client-agnostic | ✅ Chosen |
| App-enforced only | Each client must re-implement; RxDB sync race | Rejected |

Rationale: Battle-tested in `validate_lifecycle_fsm()`. Essential for offline-first where RxDB could replay stale transitions.

### LOTO Two-Person Rule: Trigger-Enforced
| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Trigger checks** `verified_by != locked_by` | DB-level enforcement, audit-proof | ✅ Chosen |
| App-level only | Bypassable via direct DB writes | Rejected |

### Auto-Expiry: BEFORE UPDATE Trigger (not pg_cron)
Inline check `expires_at < NOW()` on any write. No cron dependency. Acceptable caveat: purely passive permits (no writes) stay ACTIVE until next write. Future pg_cron pass can sweep orphans.

### No Auto-Creation Triggers
Same client-driven philosophy as `labor-reporting`. Server VALIDATES, never creates. Prevents phantom duplicates on RxDB sync.

## Data Flow

```
Dashboard → INSERT work_permits (REQUESTED)
           → UPDATE → APPROVED → ACTIVE (gas test gate)
           → INSERT/UPDATE LOTO → LOCKED → VERIFIED (two-person) → REMOVED
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260527000001_safety_permits.sql` | Create | ENUMs, 5 tables, FSM, RLS, audit, seeds |
| `supabase/tests/database/safety_permits_test.sql` | Create | pgTAP: schema, FSM, RLS, gas test, two-person, expiry |

## Interfaces

```sql
CREATE TYPE permit_status AS ENUM ('REQUESTED','APPROVED','ACTIVE','COMPLETED','REJECTED','CANCELLED','EXPIRED');
CREATE TYPE loto_status AS ENUM ('PLANNED','LOCKED','VERIFIED','REMOVED');
CREATE TYPE device_type AS ENUM ('LOCK','TAG','HASPS','CHAIN');
```

**PTW FSM** (BEFORE UPDATE): REQUESTED→APPROVED|CANCELLED|REJECTED, APPROVED→ACTIVE|CANCELLED|EXPIRED, ACTIVE→COMPLETED|EXPIRED. Gas test gate: `gas_test_required=true` AND transitioning to ACTIVE requires `gas_test_result='PASS'`. Auto-expire: ACTIVE + `expires_at < NOW()` → EXPIRED. Set `issued_at=NOW()` on APPROVED→ACTIVE.

**LOTO FSM** (BEFORE UPDATE): PLANNED→LOCKED, LOCKED→VERIFIED (`verified_by != locked_by`), VERIFIED→REMOVED.

**SAFETY_OFFICER**: `ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check; ADD CONSTRAINT CHECK (role IN ('TECHNICIAN','PLANNER','ADMIN','SAFETY_OFFICER'));`

**RLS Matrix** (all via `get_user_role()`):

| Role | All Tables |
|------|-----------|
| ADMIN / SAFETY_OFFICER | ALL |
| PLANNER | SELECT, INSERT, UPDATE (no DELETE) |
| TECHNICIAN | SELECT only |

**Audit**: `audit_trigger_func()` via AFTER INSERT OR UPDATE OR DELETE on all 5 tables.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| DB | PTW 7-state FSM, backward rejections, gas test gate | `throws_ok()` + SAVEPOINT |
| DB | LOTO 4-state FSM, skip rejection, two-person rule | `throws_ok()` with equal IDs |
| DB | Auto-expiry on ACTIVE past expires_at | `UPDATE` + `is()` |
| DB | RLS: TECHNICIAN read-only, SAFETY_OFFICER ALL | `SET ROLE` + JWT context |
| DB | SAFETY_OFFICER role CHECK constraint | `throws_ok()` invalid role |
| DB | 7 seed permit_types | `is(count(*) = 7)` |

## Migration / Rollout

Sequence in single file: create ENUMs → add SAFETY_OFFICER to role CHECK → create 5 tables (with FK order) → FSM triggers → audit triggers → RLS → seed permit_types → indexes.

Rollback: Drop tables reverse-order, drop ENUMs, revert role CHECK.

## Open Questions

- [ ] Auto-expiry trigger-only is sufficient for Phase 1; pg_cron sweep may be added later for orphaned ACTIVE permits
- [ ] Confirm `work_permits.work_order_id` FK matches TEXT type of `work_orders.id`

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SAFETY_OFFICER CHECK drops existing constraint | High | `DROP IF EXISTS` + `ADD` in same migration |
| PTW 7 states too rigid | Med | ENUM extensible; HOLD/SUSPENDED via `ALTER TYPE` later |
| Existing `user_profiles` has different role CHECK | Med | Handle both paths via conditional DROP |
