# Archive Report: core-iso14224

**Change name**: Core — Security, Audit & ISO 14224 Schema

**Date archived**: 2026-05-20

**Archive path**: `openspec/changes/archive/2026-05-20-core-iso14224/`

---

## Summary

Refactorización completa del esquema de datos a nivel enterprise-predictivo: implementación de Supabase Auth con RBAC (4 roles), Audit Trail inmutable con trigger genérico, y alineación de `work_orders` con ISO 14224 incluyendo FSM de lifecycle, taxonomía de falla, timestamps event-driven y notas estructuradas.

La migración fue destructiva (DROP + CREATE de `work_orders`) para evitar deuda técnica, y se actualizó la Edge Function `oee-trigger` para alinearse al nuevo schema.

## Tasks Completed

**15/15 tasks completed**

### Phase 1: Auth & RBAC (5/5)
- [x] 1.1 Create `user_profiles` table
- [x] 1.2 Create `sync_user_profile()` trigger function on `auth.users` INSERT
- [x] 1.3 Create `get_user_role()` helper function for RLS policies
- [x] 1.4 Enable RLS on `work_orders` per role matrix
- [x] 1.5 Enable RLS on `assets` per role matrix

### Phase 2: Audit Trail (4/4)
- [x] 2.1 Create `audit_logs` table
- [x] 2.2 Create generic `audit_trigger_func()` using TG_TABLE_NAME
- [x] 2.3 Attach `work_orders_audit` trigger
- [x] 2.4 Enable RLS on `audit_logs`

### Phase 3: work_orders ISO 14224 (5/5)
- [x] 3.1 Create ENUMs: `lifecycle_phase`, `block_reason`
- [x] 3.2 DROP old `work_orders` CASCADE, CREATE new ISO 14224 table
- [x] 3.3 Create `validate_lifecycle_fsm()` BEFORE UPDATE trigger
- [x] 3.4 Re-attach `work_orders_audit` trigger
- [x] 3.5 Enable RLS on new `work_orders`

### Phase 4: Edge Function Update (4/4)
- [x] 4.1 Update `insertWorkOrder()` — add `lifecycle_phase`, `block_reason`, `symptom_note`
- [x] 4.2 Remove legacy fields from INSERT object
- [x] 4.3 Update `index_test.ts` assertions
- [x] 4.4 Run `deno test` locally

## Files Changed

| File | Action |
|------|--------|
| `supabase/config.toml` | Modified |
| `supabase/functions/oee-trigger/index.ts` | Modified — new schema fields |
| `supabase/functions/oee-trigger/index_test.ts` | Modified — updated assertions |
| `supabase/functions/oee-trigger/deno.lock` | Modified — dependency resolution |
| `supabase/migrations/20260520000001_rbac_audit.sql` | Added — ENUMs, user_profiles, audit_logs, RLS |
| `supabase/migrations/20260520000002_work_orders_iso14224.sql` | Added — DROP old + CREATE ISO 14224, FSM trigger |

## Main Specs Updated

| Domain | Action | Path |
|--------|--------|------|
| auth-rbac | **Created** (NEW) | `openspec/specs/auth-rbac/spec.md` |
| work-order-database | **Replaced** (ISO 14224 + Audit Trail) | `openspec/specs/work-order-database/spec.md` |
| oee-webhook | **Modified** (work order creation fields) | `openspec/specs/oee-webhook/spec.md` |

## Archive Contents

- `proposal.md` ✅
- `spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (15/15 tasks complete)

## Implementation Commit

`fd2f6e6` — `feat(core): ISO 14224 schema, RBAC, audit trail, and edge function update`

## Archiver Notes

- La migración fue destructiva (Opción A) — DROP + CREATE de `work_orders` con CASCADE. No hay datos de producción, no hay riesgo.
- RxDB ya no forma parte del schema de `work_orders` — la app ahora trabaja directamente con Supabase REST.
- La especificación `work-order-database` fue completamente reemplazada para reflejar el schema actual.
- El archive previo `work-order-fsm-schema-phase-1` preserva el diseño anterior como histórico.
