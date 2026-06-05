# Tasks: PDF Generation Core

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650-850 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: JSR pkg + migration → PR 2: Edge Function → PR 3: Frontend |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (recommended) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Notes |
|------|------|-----------|------|-------|
| 1 | JSR package + Storage migration | PR 1 | main | ~300 lines; publish `@cmms/pdf-engine`, create bucket, update `.env.example` |
| 2 | Edge Function (generate-pdf) | PR 2 | main | ~465 lines; core server-side PDF logic, auth, Browserless, storage, signed URL |
| 3 | Frontend: hook + button + drawer | PR 3 | main | ~190 lines; re-exports, usePdfDownload, PdfDownloadButton, WireOrderDrawer button |

---

## Phase 1: Foundation (JSR Package + Infrastructure)

- [x] 1.1 Create `packages/pdf-engine/` with `mod.ts` (re-exports), `deno.json` (`@cmms/pdf-engine` v0.1.0), `jsr.jsonc`, `README.md`, `LICENSE` — copies of `.js` source files for JSR package (publication deferred to manual `npx jsr publish`)
- [ ] 1.2 Publish `@cmms/pdf-engine` to JSR (manual `npx jsr publish`) — **deferred**: package structure created in 1.1, `src/lib/pdf/index.js` updated with JSR/local fallback
- [x] 1.3 Create migration `20260605100002_pdf_server_generation.sql` — private `generated_pdfs` bucket, RLS (own/ADMIN), `report_history` columns (`storage_path`, `record_id`, `record_type`, `signed_url_expires_at`)
- [x] 1.4 Update `.env.example` — add `BROWSERLESS_API_KEY`, `SIGNED_URL_EXPIRY_SECONDS`

## Phase 2: Core — Edge Function

- [x] 2.1 Create `supabase/functions/generate-pdf/deno.json` with import map for `jsr:@cmms/pdf-engine` + `@supabase/supabase-js` + `@std/assert`
- [x] 2.2 Create `supabase/functions/generate-pdf/index.ts`: Bearer auth → template fetch from `report_templates` → data resolve (DB or payload) → HTML render → Browserless POST → storage upload → `report_history` insert → signed URL response
- [x] 2.3 Implement error handling per spec: 400 (invalid template), 401 (no auth), 404 (template/record), 502 (Browserless failure after 2 retries)

## Phase 3: Frontend Integration

- [x] 3.1 Convert `src/lib/pdf/templateEngine.js`, `templateDefaults.js`, `index.js` to thin re-exports from `@cmms/pdf-engine` — **current `index.js` uses dynamic import with local fallback (safe while 1.2 pending)**
- [x] 3.2 Create `src/hooks/usePdfDownload.js` — POST to `generate-pdf`, handle loading/error, trigger download via `<a>` click
- [x] 3.3 Create `src/components/pdf/PdfDownloadButton.jsx` — MUI Button with loading spinner, disabled state, error snackbar
- [x] 3.4 Add PdfDownloadButton to `WorkOrderDrawer.jsx` beside existing Print button (visible in COMP/CLOSED phases)

## Phase 4: Testing

- [x] 4.1 Edge Function tests: auth validation, payload validation, Browserless mock (success + 503 retry), storage stub, error cases (401, 404, 502) — 28 test cases covering all error paths
- [x] 4.2 Hook tests: `usePdfDownload` — mock fetch with signed URL, verify download trigger, test loading/error states
- [x] 4.3 Button component tests: render with label, click fires hook, loading spinner shown during fetch, error shows snackbar
