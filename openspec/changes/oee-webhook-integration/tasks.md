# Tasks: OEE Webhook Integration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250–320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation / Infrastructure

- [x] 1.1 Create `supabase/config.toml` with project reference and edge function settings
- [x] 1.2 Create `supabase/functions/oee-trigger/deno.json` with `@supabase/supabase-js` import map
- [x] 1.3 Verify local Supabase CLI can serve edge functions (`supabase functions serve`)

## Phase 2: Core Implementation

- [x] 2.1 Create `supabase/functions/oee-trigger/index.ts` with Deno serve handler scaffold
- [x] 2.2 Implement Bearer auth validation against `Deno.env.get("OEE_SECRET_KEY")` returning 401
- [x] 2.3 Implement JSON payload parsing and `equipment_id`/`sintoma` presence checks returning 400
- [x] 2.4 Add asset lookup via Service Role client: `assets.select('id','equipment_id').eq('equipment_id', ...).maybeSingle()` returning 404
- [x] 2.5 Add work order insert with `crypto.randomUUID()`, `[OEE TRIGGER] Síntoma: <sintoma>`, `status='pending'`, `wo_type='corrective'`, and required defaults
- [x] 2.6 Return 200 JSON `{ id: "..." }` on success and 500 on unexpected errors

## Phase 3: Testing / Verification

- [x] 3.1 Write unit tests for auth validation (valid/missing/invalid token) per spec scenarios
- [x] 3.2 Write unit tests for payload validation (valid/missing field/malformed JSON) per spec scenarios
- [x] 3.3 Write integration test for successful end-to-end flow: asset lookup + insert + 200 response
- [x] 3.4 Run `supabase functions serve` locally and invoke with `curl` to verify 200/401/400/404 responses

## Phase 4: Cleanup / Documentation

- [x] 4.1 Add inline comments for auth, lookup, and insert logic in `index.ts`
- [x] 4.2 Document `OEE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` secret setup in rollout notes
- [x] 4.3 Verify `work_orders` row created by integration test has correct `asset_id`, `description`, `status`, and `wo_type`
