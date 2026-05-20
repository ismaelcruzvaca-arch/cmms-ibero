# Tasks: Work Order FSM & Schema Phase 1

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Supabase DDL → PR 2: RxDB + FSM client layer |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Supabase schema, triggers, RLS, audit | PR 1 | Base = main; idempotent SQL only |
| 2 | FSM module, RxDB v2 schema, migration, hooks, replication | PR 2 | Base = main; depends on PR 1 for e2e validation |

## Phase 1: Supabase Foundation

- [ ] 1.1 Create `sql/migration-work_orders-v2.sql`: idempotent DDL for columns, ENUM, FK, backfill
- [ ] 1.2 Rewrite `sql/trigger-work_orders.sql`: unified timestamp, FSM, audit triggers + RLS policies
- [ ] 1.3 Execute migration in Supabase SQL Editor; verify columns, triggers, constraints

## Phase 2: Core Client Implementation

- [ ] 2.1 Create `src/lib/fsm.js`: `isValidTransition`, `getAllowedTransitions`, `isTerminal`
- [ ] 2.2 Bump `workOrderSchema` to version 2 in `src/lib/rxdb.js`; add all v2 fields and update `required`
- [ ] 2.3 Add `migrationStrategies: { 2: ... }` in `rxdb.js`; resolve `asset_id` from local `assets`, backfill defaults
- [ ] 2.4 Register `db.work_orders.preUpdate` hook in `rxdb.js`; throw on invalid FSM transition
- [ ] 2.5 Update work_orders `createPullHandler` to order by `updated_at_ms`
- [ ] 2.6 Expand work_orders `createPushHandler` field list to all v2 fields
- [ ] 2.7 Add permanent-error handling in push handler: catch constraint/FSM errors, set `_conflict: true`, revert `status`, return `[]`

## Phase 3: Testing & Verification

- [ ] 3.1 Unit test `fsm.js`: exhaust 4×4 transition matrix plus identity transitions
- [ ] 3.2 Unit test RxDB v1→v2 migration: assert defaults, `asset_id` resolution, no data loss
- [ ] 3.3 Integration test valid transition `pending → in_progress`: assert audit row created
- [ ] 3.4 Integration test invalid transition rejected by `preUpdate` hook and PostgreSQL trigger
- [ ] 3.5 Integration test push FSM rejection: `_conflict: true` set locally and retry loop breaks
- [ ] 3.6 Integration test replication pull orders by `updated_at_ms` with checkpoint
- [ ] 3.7 Smoke test offline→online sync: create, transition, reconnect, verify push and audit

## Phase 4: Cleanup & Docs

- [ ] 4.1 Mark `_last_modified` deprecated in `sql/trigger-work_orders.sql` comments; do not drop
- [ ] 4.2 Verify no UI files modified (`src/hooks/useWorkOrders.js` untouched)
