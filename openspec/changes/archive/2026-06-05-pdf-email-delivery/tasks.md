# Tasks: PDF Email Delivery

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 380–450 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

> **Note**: ~400 lines is borderline but the change is cohesive — backend EF and frontend UI are tightly coupled by contract. Splitting would create an incomplete review. The `ask-on-risk` strategy means you decide before apply.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full feature — EF + frontend + tests | PR 1 (single) | All-in-one; base = main |

## Phase 1: Foundation

- [x] 1.1 Create `supabase/functions/send-report/deno.json` — import map mirroring `generate-pdf`'s (`@cmms/pdf-engine`, `@supabase/supabase-js`)
- [x] 1.2 Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to `.env.example` under a new `# Email Delivery (Resend)` section

## Phase 2: Backend — Edge Function Handler

- [x] 2.1 Create `supabase/functions/send-report/index.ts` — boilerplate: CORS, `jsonResponse()`, `validateAuth()` and helper imports from `../generate-pdf/index.ts`
- [x] 2.2 Implement `validatePayload()` for `send-report` schema — validate `to` (email or email[]), `subject`, `template_code`, `record_id`; return 400 with field-level details
- [x] 2.3 Implement PDF generation reuse — call imported `resolveTemplateFromDB()`, `resolveDataFromDB()`, render via `@cmms/pdf-engine`, call `callBrowserless()` → `ArrayBuffer`; base64-encode the buffer
- [x] 2.4 Implement `sendEmailViaResend()` — `fetch()` POST to `https://api.resend.com/emails` with Bearer token auth (`RESEND_API_KEY`), `from` = `RESEND_FROM_EMAIL`, PDF as base64 attachment; return `{ messageId }` on 2xx, surface Resend `429` / `502` upstream errors
- [x] 2.5 Wire `handleRequest()`: OPTIONS preflight → POST only → auth → payload validation → PDF gen → Resend send → return `{ messageId }` or proper error codes

## Phase 3: Frontend — Hook + Dialog

- [x] 3.1 Create `src/hooks/usePdfEmail.js` — POST to `/functions/v1/send-report` with `{ to, subject, message?, template_code, record_id }`, manage `idle → loading → success | error` state, inline validation passthrough (follows `usePdfDownload` pattern)
- [x] 3.2 Create `src/components/pdf/PdfEmailButton.jsx` — MUI Dialog with `to` (email input), `subject` (text), `message` (multiline, optional) fields; loading spinner on Send button; success snackbar "Reporte enviado"; error snackbar; inline validation errors below fields (follows `PdfDownloadButton` pattern)
- [x] 3.3 Wire `PdfEmailButton` into `WorkOrderDrawer.jsx` — import and render next to `PdfDownloadButton` inside the `['COMP', 'CLOSED'].includes(...)` block

## Phase 4: Testing

- [x] 4.1 Create `supabase/functions/send-report/index_test.ts` — payload validation tests: invalid email, missing `subject`, missing `template_code` → 400; missing auth → 401; unknown `record_id` → 404
- [x] 4.2 Write Resend API mock test — verify correct request body shape (from, to, subject, attachments), Bearer auth header, base64 PDF content type; simulate 429 → 502 propagation
- [x] 4.3 Write full handler integration test — inject mocks for auth, template resolution, data resolution, Browserless, and Resend; assert `200 { messageId }` on success
