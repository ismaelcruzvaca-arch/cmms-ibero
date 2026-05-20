# Proposal: OEE Webhook Integration

## Intent

Enable an external OEE application to automatically create corrective work orders in the CMMS by calling a secure webhook. This removes manual data entry and ensures maintenance requests triggered by OEE alerts flow directly into the work order pipeline.

## Scope

### In Scope
- Supabase Edge Function (`oee-trigger`) that receives `equipment_id` + `sintoma`
- Asset lookup by `equipment_id` and work order insert with required defaults
- Bearer token auth via `OEE_SECRET_KEY`
- Directory scaffolding for future edge functions

### Out of Scope
- OEE application changes (they provide the payload)
- Frontend UI changes to display OEE origin
- Updating or deleting work orders via webhook
- PostgreSQL UNIQUE constraint on `assets.equipment_id` (assumed resolved in ETL)

## Capabilities

### New Capabilities
- `oee-webhook`: Secure endpoint to create work orders from external OEE triggers

### Modified Capabilities
- None

## Approach

Standard Supabase Edge Function (Deno). The function:
1. Validates `Authorization: Bearer <OEE_SECRET_KEY>` against `Deno.env.get('OEE_SECRET_KEY')` → 401 if missing/invalid.
2. Parses JSON payload (`equipment_id`, `sintoma`).
3. Queries `assets` by `equipment_id` using `.limit(1).maybeSingle()` → 404 if not found.
4. Generates a UUID v4 `id` (no prefix) to stay compatible with RxDB replication.
5. Inserts into `work_orders` with `description = "[OEE TRIGGER] Síntoma: <sintoma>"`, `status = 'pending'`, `wo_type = 'corrective'`, and all required defaults (numeric = 0, boolean = false).
6. Returns 200 with the created work order `id`.

Uses Service Role Key to bypass RLS.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/oee-trigger/index.ts` | New | Edge function entrypoint |
| `supabase/config.toml` | New | Supabase CLI config (if not present) |
| Supabase Dashboard Secrets | New | `OEE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `equipment_id` duplicate returns wrong asset | Low | ETL enforces uniqueness; `.limit(1)` defends |
| Service Role Key misuse | Low | Function is minimal (single insert), no dynamic SQL |
| Missing Supabase CLI for local testing | Med | Document `supabase functions serve` setup |
| RxDB replication conflict on ID format | Low | UUID v4 with no prefix, same as frontend |

## Rollback Plan

1. Delete the edge function from the Supabase project via Dashboard or CLI (`supabase functions delete oee-trigger`).
2. Remove `OEE_SECRET_KEY` from Supabase Secrets.
3. No database migration required; created work orders remain but new OEE requests will fail (expected).

## Dependencies

- Supabase project with Edge Functions enabled
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` available as environment variables
- `assets.equipment_id` values populated and unique (ETL responsibility)

## Success Criteria

- [ ] `POST` to `/functions/v1/oee-trigger` with valid Bearer token and payload returns 200 + work order ID
- [ ] Missing or invalid Bearer token returns 401
- [ ] Nonexistent `equipment_id` returns 404
- [ ] Created work order appears in Supabase `work_orders` with `status = 'pending'` and correct `asset_id`
- [ ] RxDB clients sync the new work order without ID conflicts
