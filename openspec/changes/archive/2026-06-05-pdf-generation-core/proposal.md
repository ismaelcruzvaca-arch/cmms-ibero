# Proposal: PDF Generation Core

## Intent

Enable server-side PDF download from work orders and reports. Users currently only get browser-print output — this adds real server-generated PDFs via a shared template engine (JSR `@cmms/pdf-engine`) + Browserless.io HTML→PDF rendering.

## Scope

### In Scope
- Extract `src/lib/pdf/templateEngine.js` + `templateDefaults.js` → JSR package `@cmms/pdf-engine` (public, MIT)
- Edge Function `generate-pdf` in `supabase/functions/generate-pdf/` — receives template + data, renders HTML via engine, calls Browserless.io for PDF buffer
- Migration: `generated_pdfs` storage bucket (private) + RLS policies
- `report_history` table: metadata, storage_path, signed URL generation
- Signed URL download flow (1-hour expiry via `createSignedUrl`)
- Download button in `WorkOrderDrawer.jsx`
- Tests: unit + integration with Browserless mock

### Out of Scope
- Email delivery (Slice 2 — `pdf-email-delivery`)
- Scheduled/automated reports (Slice 3 — `pdf-scheduled-reports`)
- Report builder UI (future)
- Browserless self-hosting (SaaS free tier first)

## Capabilities

### New Capabilities
- `pdf-server-generation`: Server-side PDF generation via Edge Function, Supabase Storage, and signed URL download.
- `pdf-engine-package`: JSR package `@cmms/pdf-engine` — shared template engine importable from Edge Functions and frontend.

### Modified Capabilities
- `mechanic-work-order-execution`: WorkOrderDrawer gains a download PDF button (UI addition only — no spec-level behavior change).

## Approach

1. **JSR Package**: Extract template engine files to `packages/pdf-engine/`, publish as `@cmms/pdf-engine`. Frontend switches from local import to package import.
2. **Edge Function**: `generate-pdf` validates Bearer auth, resolves template + data from `report_templates`, renders HTML via `@cmms/pdf-engine`, POSTs to `https://chrome.browserless.io/pdf` with HTML body, uploads returned PDF buffer to `generated_pdfs` bucket, writes `report_history` row, returns signed URL.
3. **Migration**: `generated_pdfs` bucket — private, RLS allows authenticated users to `SELECT` their own reports. `report_history` gets `storage_path TEXT` + `signed_url_expires_at TIMESTAMPTZ` columns.
4. **Frontend**: `WorkOrderDrawer` calls Edge Function with `work_order_id`, receives signed URL, triggers `window.open()` or programmatic download.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/pdf/` | Modified (extract) | Files become thin re-exports from `@cmms/pdf-engine` |
| `supabase/functions/generate-pdf/` | New | Edge Function ~350-400 lines |
| `supabase/migrations/` | New | Storage bucket + RLS, `report_history` columns |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modified | Download PDF button |
| `src/hooks/usePdfDownload.js` | New | Signed URL fetch + download trigger |
| `.env.example` | Modified | Add `BROWSERLESS_API_KEY` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Browserless cold start / timeout | Medium | 30s Edge Function timeout, retry 503s |
| JSR publish friction (versioning, CI) | Low | Manual publish first, GH workflow later |
| Signed URL first implementation | Low | Follow SDK: `storage.from().createSignedUrl()` |
| Template engine drift (JSR vs local) | Low | CI check: both use same published version |

## Rollback Plan

- Edge Function: delete `supabase/functions/generate-pdf/` — Supabase stops routing
- Migration: reverse migration drops `generated_pdfs` bucket
- JSR package: unpublish or mark deprecated (no hard dependency until explicitly installed)
- Frontend: `git checkout` on WorkOrderDrawer + hook files

## Dependencies

- Browserless.io account (free tier: 1,000 PDFs/mo)
- JSR account + `@cmms` scope
- `@cmms/pdf-engine` published before Edge Function can import it

## Success Criteria

- [ ] Edge Function generates valid PDF (parseable by PDF.js / Poppler) from a real template + data payload
- [ ] PDF stored in `generated_pdfs` bucket and downloadable via signed URL within 1-hour expiry
- [ ] Download button in WorkOrderDrawer triggers a file-save dialog
- [ ] `deno test` passes (unit + integration with Browserless mock)
- [ ] Frontend `src/lib/pdf/*` still renders templates (no regression after JSR switch)
