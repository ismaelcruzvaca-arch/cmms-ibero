# Design: OEE Webhook Integration

## Technical Approach

A single Supabase Edge Function (`oee-trigger`) written in Deno/TypeScript. It receives a POST request, validates Bearer auth, parses the payload, resolves `equipment_id` to an `asset_id` via the Supabase Service Role Key, and inserts a `work_orders` row with defaults. UUID v4 is generated client-side to remain compatible with RxDB replication (which uses string IDs without prefixes).

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| ID generation | UUID v4 client-side vs DB `gen_random_uuid()` | Client-side keeps RxDB happy (string PK, no prefix); DB-side would require a round-trip fetch | UUID v4 client-side via `crypto.randomUUID()` |
| Asset lookup | `.limit(1).maybeSingle()` vs `.single()` | `maybeSingle()` safely returns null; `single()` throws on 0 rows | `maybeSingle()` — cleaner 404 handling |
| Supabase client | `@supabase/supabase-js` vs direct fetch | `supabase-js` provides type-safe queries and auth headers | `@supabase/supabase-js` with Service Role Key |
| Default values | Explicit in code vs rely on DB defaults | Explicit defends against schema drift; DB defaults are simpler | Mix: DB defaults for numerics/booleans, explicit for `status`/`wo_type` |
| Error response format | Plain text vs JSON body | JSON is more consistent for API consumers | JSON `{ error: "..." }` with appropriate status codes |

## Data Flow

```
OEE App
   │
   │ POST /functions/v1/oee-trigger
   │ Authorization: Bearer <OEE_SECRET_KEY>
   │ { equipment_id: "...", sintoma: "..." }
   ▼
oee-trigger Edge Function
   │
   ├─→ Auth validation ──→ 401 (missing/invalid)
   │
   ├─→ JSON parse + field check ──→ 400 (malformed/missing)
   │
   ├─→ assets.select('id', 'equipment_id')
   │     .eq('equipment_id', payload.equipment_id)
   │     .maybeSingle() ──→ 404 (not found)
   │
   ├─→ work_orders.insert({
   │       id: crypto.randomUUID(),
   │       asset_id: asset.id,
   │       equipment_id: asset.equipment_id,
   │       description: "[OEE TRIGGER] Síntoma: <sintoma>",
   │       status: 'pending',
   │       wo_type: 'corrective',
   │       ...required_defaults
   │     })
   │
   └─→ 200 { id: "<uuid>" }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/oee-trigger/index.ts` | Create | Edge function entrypoint: auth, validation, asset lookup, insert |
| `supabase/functions/oee-trigger/deno.json` | Create | Deno config with `@supabase/supabase-js` import |
| `supabase/config.toml` | Create | Supabase CLI configuration (if not present) |

## Interfaces / Contracts

### Request
```http
POST /functions/v1/oee-trigger
Authorization: Bearer <OEE_SECRET_KEY>
Content-Type: application/json

{
  "equipment_id": "string",
  "sintoma": "string"
}
```

### Response (200)
```json
{
  "id": "uuid-v4-string"
}
```

### Error Responses
- `401 Unauthorized`: `{ "error": "Unauthorized" }`
- `400 Bad Request`: `{ "error": "Invalid payload" }`
- `404 Not Found`: `{ "error": "Equipment not found" }`
- `500 Internal Error`: `{ "error": "Internal server error" }`

### Work Order Insert Shape
```typescript
interface WorkOrderInsert {
  id: string;                    // crypto.randomUUID()
  asset_id: string;              // resolved asset.id (integer as string)
  equipment_id: string;          // from asset row
  description: string;         // `[OEE TRIGGER] Síntoma: ${sintoma}`
  status: 'pending';
  wo_type: 'corrective';
  planned_hours: 0;
  actual_hours: 0;
  cost_estimate: 0;
  actual_cost: 0;
  percentage_complete: 0;
  _conflict: false;
  _deleted: false;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Payload validation, auth header parsing, UUID generation | Deno `assert` with mocked `Request` objects |
| Integration | Asset lookup + insert round-trip against local Supabase | `supabase start` + `supabase functions serve` + `curl` / `fetch` |
| E2E | Full flow from webhook call to synced RxDB work order | Deploy to staging, invoke with real payload, verify in DB + frontend |

## Migration / Rollout

No database migration required. The function inserts into the existing `work_orders` table using its current schema and defaults.

Rollout steps:
1. Set `OEE_SECRET_KEY` in Supabase Dashboard → Edge Function Secrets.
2. Deploy function: `supabase functions deploy oee-trigger`.
3. Provide OEE team with endpoint URL + secret.

Rollback: delete function and secret. Existing work orders remain.

## Open Questions

- None
