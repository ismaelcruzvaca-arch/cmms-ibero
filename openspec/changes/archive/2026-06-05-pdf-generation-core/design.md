# Design: PDF Generation Core

## Technical Approach

Server-side PDF via Edge Function `generate-pdf` that: (1) resolves template + data from request, (2) renders HTML via JSR package `@cmms/pdf-engine`, (3) POSTs HTML to Browserless.io `/pdf` API, (4) uploads PDF buffer to `generated_pdfs` bucket, (5) writes `report_history` row with `storage_path`, and (6) returns a signed URL. Frontend calls the EF from `WorkOrderDrawer` and triggers browser download.

The existing client-side `useReport` hook (browser `window.print()`) stays untouched — server-side PDF is additive, not a replacement.

## Architecture Decisions

### Decision: JSR package scope

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Only template engine functions | Cleanest API surface; types inline | ✅ **Chosen** — `resolveTemplate`, `validateTemplate`, `renderSection`, `evaluateCondition` + TypeScript types |
| Include DEFAULT_TEMPLATE_OT | Couples package to specific template | ❌ Rejected — template lives in `report_templates` table |
| Full suite (types + defaults + pipes) | Too much surface; pipes are internals | ❌ Rejected |

**Rationale**: The package exports exactly what the existing `index.js` barrel exports, plus TypeScript type defs for `Template`, `Section`, `SectionType`, `RenderOptions`.

### Decision: Browserless API contract

**Choice**: POST full rendered HTML as JSON body to `https://chrome.browserless.io/pdf` with `{ html, options: { format: "A4", margin: { top, bottom, left, right }, printBackground: true } }`.

**Alternatives**: Send template + data and render on Browserless side (too complex; Browserless just converts HTML→PDF).

**Rationale**: Render happens in the Edge Function using `@cmms/pdf-engine` — Browserless is a pure HTML→PDF converter. This keeps the rendering logic testable independently.

### Decision: report_history migration needed

**Choice**: Add `storage_path TEXT`, `record_id TEXT`, `signed_url_expires_at TIMESTAMPTZ` columns to existing `report_history` table via migration.

**Rationale**: Current schema (from `20260604100030_pdf_report_engine.sql`) lacks any storage reference. Without `storage_path`, there's no way to retrieve the PDF. `record_id` links the report to the source record (e.g., work_order UUID). `signed_url_expires_at` tracks URL expiration for re-generation logic.

### Decision: Signed URL expiry

**Choice**: 1 hour default, configurable via `SIGNED_URL_EXPIRY_SECONDS` env var (range: 300–86400).

**Rationale**: 1 hour is Supabase's default sweet spot — long enough for a download flow, short enough to limit exposure. Env var override covers future batch/email use cases.

## Data Flow

```ascii
WorkOrderDrawer (React)
  │  onClick "Download PDF"
  ▼
usePdfDownload hook
  │  POST /functions/v1/generate-pdf
  │  Body: { template_code: "ot-default", record_id: "wo-uuid" }
  ▼
Edge Function generate-pdf
  │  1. Validate auth (anon key → authenticated user)
  │  2. Fetch template from report_templates WHERE code+is_active
  │  3. Fetch record data (work_order + labor + materials)
  │  4. Render HTML via @cmms/pdf-engine
  │  5. POST HTML → Browserless.io /pdf
  │     ← Returns PDF buffer
  │  6. Upload to storage/generated_pdfs/{tenant}/ot-default/{uuid}-{ts}.pdf
  │  7. INSERT into report_history (with storage_path)
  │  8. Generate signed URL (1h)
  │  ← Returns { signed_url, expires_at, storage_path }
  ▼
usePdfDownload receives signed URL
  │  window.open(signed_url) or <a download>
  ▼
User downloads PDF
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/pdf-engine/mod.ts` | Create | JSR entry: re-exports templateEngine functions + TS types |
| `packages/pdf-engine/templateEngine.ts` | Create | Port of `templateEngine.js` to TS for JSR |
| `packages/pdf-engine/templateDefaults.ts` | Create | Port of `templateDefaults.js` to TS for JSR |
| `packages/pdf-engine/deno.json` | Create | JSR config: `{ name: "@cmms/pdf-engine", version, exports }` |
| `supabase/functions/generate-pdf/index.ts` | Create | Edge Function ~350 lines |
| `supabase/functions/generate-pdf/deno.json` | Create | Import map incl `@cmms/pdf-engine` |
| `supabase/functions/generate-pdf/index_test.ts` | Create | Unit + integration tests |
| `supabase/migrations/20260605000001_generated_pdfs_bucket.sql` | Create | Storage bucket + RLS + report_history columns |
| `src/hooks/usePdfDownload.js` | Create | Hook: call EF + trigger download |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modify | Add "Download PDF" button (besides Print) |
| `src/lib/pdf/templateEngine.js` | Modify | Thin re-export from `@cmms/pdf-engine` |
| `src/lib/pdf/templateDefaults.js` | Modify | Thin re-export from `@cmms/pdf-engine` |
| `src/lib/pdf/index.js` | Modify | Re-exports from the moved files (unchanged API) |
| `.env.example` | Modify | Add `BROWSERLESS_API_KEY`, `SIGNED_URL_EXPIRY_SECONDS` |

## Interfaces / Contracts

### Edge Function Request

```typescript
interface GeneratePdfRequest {
  template_code: string;          // e.g. "ot-default"
  record_id: string;              // UUID of the source record
  record_type: "work_order";      // discriminator for data fetching
  data?: Record<string, unknown>; // optional override, skips DB fetch
}
```

### Edge Function Response (200)

```typescript
interface GeneratePdfResponse {
  signed_url: string;
  expires_at: string;        // ISO 8601
  storage_path: string;      // e.g. "default/ot-default/uuid-20260605T120000Z.pdf"
  report_history_id: string; // UUID
}
```

### Browserless.io `/pdf` POST body

```json
{
  "html": "<!DOCTYPE html>...",
  "options": {
    "format": "A4",
    "margin": { "top": "15mm", "bottom": "15mm", "left": "15mm", "right": "15mm" },
    "printBackground": true,
    "landscape": false
  }
}
```

### Storage path convention

```
generated_pdfs/{tenant}/{template_code}/{record_id}-{timestamp_iso}.pdf
```

Example: `generated_pdfs/default/ot-default/a1b2c3d4-2026-06-05T12-00-00Z.pdf`

### report_history migration

```sql
ALTER TABLE report_history
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS record_id TEXT,
  ADD COLUMN IF NOT EXISTS signed_url_expires_at TIMESTAMPTZ;
```

## Error Handling

| Scenario | HTTP | Response body | Strategy |
|----------|------|---------------|----------|
| Template not found | 404 | `{ error: "template_not_found", code }` | Frontend shows "Template no disponible" |
| Record not found | 404 | `{ error: "record_not_found", record_id }` | Frontend shows "Registro no encontrado" |
| Browserless timeout | 502 | `{ error: "pdf_generation_failed" }` | Retry up to 2x on 503/timeout |
| Template invalid | 400 | `{ error: "invalid_template", details: [...] }` | Validation errors from `validateTemplate()` |
| Auth failed | 401 | `{ error: "unauthorized" }` | Standard Supabase auth |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `validateAuth`, payload validation, `validateTemplate` via `@cmms/pdf-engine` | `deno test` — mock HTTP, isolate functions |
| Integration | Edge Function with Browserless mock (stub return buffer) | Mock fetch to Browserless, assert PDF stored in fake Storage |
| E2E | Full flow: click button → signed URL → file save dialog | Playwright: intercept EF call, verify download start |

## Migration / Rollout

1. **Publish JSR package** — manual first (`npx jsr publish`), then CI (#1)
2. **Migration** — create `generated_pdfs` bucket + add columns (#2)
3. **Edge Function** — deploy, test with curl (#3)
4. **Frontend** — add download button + hook (#4)
5. No feature flag needed — new button only appears in COMP/CLOSED phases alongside existing Print button

## Open Questions

- [ ] What is the tenant resolution strategy? Extract from `auth.users()` metadata, or from `record_type` → `work_orders.tenant_id`?
- [ ] Should signed URLs be revocable or just time-expiring? (If revocable, need a `revoked_at` column)
