# Proposal: Work Order FSM & Schema Phase 1

## Intent

Upgrade the work_orders data layer from a basic 12-field v1 schema to an enterprise CMMS schema with FSM-enforced status transitions, referential integrity, and audit trail — without breaking offline-first replication or renaming existing states.

## Scope

### In Scope
- Supabase migration: add `updated_at`, enterprise fields, `asset_id` FK, ENUMs, RLS
- RxDB schema v2 with all new fields and explicit v1→v2 migration
- PostgreSQL trigger enforcing FSM transitions on current state names (`pending` → `in_progress`/`cancelled`, `in_progress` → `completed`/`cancelled`)
- Audit table `work_order_status_history` with auto-populating trigger
- Defense-in-depth against infinite retry loops (`_conflict` handling)

### Out of Scope
- UI components, forms, or pages
- Hook changes (`useWorkOrders.js` updates deferred to Phase 2)
- Status rename (`pending`/`in_progress`/`completed`/`cancelled` kept as-is)
- Dropping `equipment_id` (kept as read-only denormalized field)

## Capabilities

### New Capabilities
- `work-order-schema-v2`: RxDB v2 schema, enterprise fields, Dexie migration v1→v2
- `work-order-supabase-migration`: Supabase DDL, `updated_at` alignment, FK, RLS policies
- `work-order-fsm-engine`: PostgreSQL transition trigger + RxDB client pre-validation
- `work-order-status-audit`: `work_order_status_history` table and trigger

### Modified Capabilities
None — no existing OpenSpec specs.

## Approach

1. Add `updated_at` (timestamp) to Supabase `work_orders`, align replication to use it consistently (like `assets`).
2. Add enterprise fields to Supabase and RxDB schema; bump RxDB to v2 with explicit Dexie migration.
3. Create `asset_id` FK → `assets.id`; keep `equipment_id` denormalized.
4. Implement PostgreSQL trigger validating FSM transitions on current status names.
5. Create `work_order_status_history` table with trigger auto-logging changes.
6. Add RLS policies for row-level security.
7. Handle `_conflict: true` in pull handler to break sync retry loops on rejected transitions.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/rxdb.js` | Modified | Schema v2, migration function, push/pull field lists |
| `sql/trigger-work_orders.sql` | Modified | New columns, FK, ENUM, FSM trigger, audit table |
| `supabase/` migrations | New | Migration file for schema changes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| RxDB v1→v2 migration fails in StrictMode | Med | Explicit migration function; recreate fallback preserved |
| Sync loop on rejected invalid status | Low | PostgreSQL rejects + `_conflict` flag in pull handler |
| `asset_id` / `equipment_id` ambiguity in UI | Med | Keep `equipment_id` read-only; UI migration in Phase 2 |

## Rollback Plan

- Revert Supabase migration via down-migration (drop new columns, triggers, tables).
- If RxDB v2 fails, Dexie recreate fallback reverts to empty v2 (data restored from Supabase pull).

## Dependencies

- Supabase project access for DDL execution
- Verification that live `work_orders` table column list matches SQL file (confirm `updated_at` missing)

## Success Criteria

- [ ] Supabase `work_orders` has all enterprise fields and `updated_at`
- [ ] RxDB v2 migrates existing docs without data loss
- [ ] Invalid status transitions rejected by PostgreSQL trigger
- [ ] `work_order_status_history` records every status change
- [ ] RLS policies active on `work_orders`
- [ ] Replication pull handler handles `_conflict` without retry loops
