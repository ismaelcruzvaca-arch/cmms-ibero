# Exploration: work-order-fsm-schema-phase-1

## Current State

The CMMS frontend uses an offline-first architecture with RxDB (Dexie storage) synced bidirectionally to Supabase via custom pull/push handlers. Three collections exist: `work_orders`, `assets`, and `asset_hierarchy`.

**Current `work_orders` RxDB schema (v1)** has only 12 fields: `id`, `equipment_id`, `description`, `location`, `criticality` (A/B/C), `status` (pending/in_progress/completed/cancelled), `priority` (low/medium/high/critical), `assigned_to`, `scheduled_date`, `completed_date`, `created_at`, `updated_at` (number). Required: `id`, `equipment_id`, `description`, `status`.

**Supabase table** (from `sql/trigger-work_orders.sql`) mirrors this with `_deleted` and `_last_modified` BIGINT columns plus a trigger that updates `_last_modified` on every write. No foreign keys, no CHECK constraints beyond `criticality IN ('A','B','C')`, no ENUMs, no RLS, no audit trail.

**Replication** uses generic `createPullHandler`/`createPushHandler`. Work orders pull orders by `updated_at`, but the Supabase table does not have an `updated_at` column — it has `_last_modified`. The push handler sends `updated_at` as ISO string but never sets `updated_at_ms`. Assets use `updated_at_ms` for ordering; work orders do not. This inconsistency suggests the work order replication may be ordering by a non-existent column or relying on an undeclared field.

**Asset relationship** is loose: `work_orders.equipment_id` (string, maxLength 50) references `assets.equipment_id` (string, maxLength 50), while `assets.id` (string, maxLength 100) is the actual primary key. There is no referential integrity at either layer.

**Hooks**: `useWorkOrders.js` provides CRUD (create, update, soft-delete) with no validation beyond RxDB schema. Status changes are free-form; any enum value can be written at any time. No state-machine logic exists.

## Affected Areas

| File | Why Affected |
|------|-------------|
| `src/lib/rxdb.js` | Schema bump v1→v2, new fields, FSM helpers, replication field lists |
| `src/hooks/useWorkOrders.js` | Must validate transitions before `updateWorkOrder`, add status history helpers |
| `sql/trigger-work_orders.sql` | New Supabase columns, ENUM type, transition validation trigger, audit history |
| `src/lib/supabaseClient.js` | Possibly RLS policy testing; no code change needed |
| `openspec/changes/work-order-fsm-schema-phase-1/` | Design and spec artifacts |

## Approaches

### 1. Minimal FSM — Enum + App-level validation only
- Add `paused` to status enum, rename `pending`→`open`, `completed`→`closed` in both layers.
- Implement a plain JS transition matrix in `useWorkOrders.js` that rejects invalid status changes before calling RxDB.
- Supabase gets only an ENUM and basic CHECK; no transition trigger.
- **Pros**: Fastest to implement, no complex PostgreSQL code, works offline immediately.
- **Cons**: Data integrity relies on frontend code; direct Supabase writes or future mobile clients can bypass rules. No audit trail.
- **Effort**: Low

### 2. Full FSM — PostgreSQL trigger + RxDB mirror + audit table
- Define PostgreSQL ENUM `wo_status` and `wo_type`.
- Add a PostgreSQL trigger/function that validates every `status` update against a transition matrix; raise exception on invalid move.
- Create `work_order_status_history` table auto-populated by trigger with `changed_at`, `old_status`, `new_status`, `changed_by`.
- Add matching RxDB fields and a lightweight client-side validator that pre-checks transitions for UX (fail-fast before push).
- **Pros**: Strong data integrity, audit trail, enterprise-ready, safe for multi-client writes.
- **Cons**: More SQL to maintain, migration must backfill existing rows, offline clients can still write invalid states locally until sync (sync will then fail and enter retry loop).
- **Effort**: Medium

### 3. Hybrid deferred — App validation now, Supabase trigger later
- Do Approach 1 immediately.
- Leave a TODO/spec for Approach 2 in a follow-up migration.
- **Pros**: Unblocks UI/UX work, reduces batch size for review.
- **Cons**: Two migrations, temporary weak integrity.
- **Effort**: Low → Medium (split)

## Recommendation

**Adopt Approach 2 (Full FSM)** in a single phase if review budget allows (~300–400 lines across SQL + JS), otherwise split into **Approach 3**.

Specific recommendations:
1. **Fix replication ordering**: change `createPullHandler('work_orders', 'updated_at')` to use `_last_modified` (or add an `updated_at` column to Supabase and keep the trigger populating it). The current mismatch is a latent bug.
2. **Normalize the asset FK**: introduce `asset_id` in `work_orders` referencing `assets.id`. Keep `equipment_id` as a display/legacy field during a deprecation window, then drop it in Phase 2.
3. **Status migration map**: `pending` → `open`, `completed` → `closed`, `cancelled` → `cancelled`, `in_progress` → `in_progress`.
4. **FSM transition matrix** (recommended):
   - `open` → `in_progress`, `cancelled`
   - `in_progress` → `paused`, `closed`, `cancelled`
   - `paused` → `in_progress`, `closed`, `cancelled`
   - `closed` → *(terminal)*
   - `cancelled` → *(terminal)*
5. **Add enterprise fields** (prioritized):
   - `wo_type` (corrective / preventive / predictive / emergency)
   - `planned_hours`, `actual_hours`
   - `cost_estimate`, `actual_cost`
   - `requested_by`, `approved_by`, `approval_date`
   - `start_date`, `end_date` (actual work dates, distinct from `scheduled_date`)
   - `hold_reason`, `close_reason`, `cancel_reason`
   - `work_center`, `planner_group`
   - `downtime_hours`
   - `percentage_complete`
6. **Add audit table** `work_order_status_history` with trigger population.
7. **Add RLS** policies on `work_orders` at least for `is_deleted = false` visibility.

## Risks

| Risk | Detail |
|------|--------|
| RxDB schema migration failure | Bumping to v2 requires `RxDBMigrationSchemaPlugin`. Dexie storage sometimes fails on migration in StrictMode; the code already has a recreate fallback, but data loss is possible if migration functions are not provided. |
| Replication stall on invalid status | If a client writes an invalid status offline and Supabase rejects it on push, the replication will retry indefinitely. Need a conflict/error handler in `replicateRxCollection`. |
| Equipment_id vs asset_id ambiguity | Changing the FK pattern touches UI components that currently filter by `equipment_id`. A coordinated rename is needed to avoid broken lookups. |
| Status rename breaks external reports | If Supabase is used by BI/reporting tools, renaming `pending`→`open` and `completed`→`closed` is a breaking change. Coordinate with downstream consumers. |
| _last_modified vs updated_at mismatch | The current pull handler for work orders may already be broken. Verify the actual Supabase column list before changing anything. |

## Open Questions

1. Does the live Supabase `work_orders` table already have an `updated_at` column (undeclared in the SQL file), or is the current replication ordering by a missing column?
2. Are there external consumers (Power BI, Metabase, mobile apps) writing directly to Supabase that would be broken by ENUM/transition triggers?
3. Should `cancelled` be a terminal state, or should we allow reopening (e.g., `cancelled` → `open`)?
4. Should the audit/history table also live in RxDB for offline viewing, or only in Supabase?
5. Do we need a separate `work_order_tasks` checklist collection, or can tasks be a JSON array inside the work order document?
6. Is the 400-line PR budget sufficient for SQL + schema + hook changes + tests, or should this be split into two chained PRs?

## Ready for Proposal

**Yes** — with the caveat that the `updated_at` / `_last_modified` mismatch should be verified against the live Supabase schema before the Design phase commits to a specific replication fix.
