# Design: PDF Email Delivery

## Technical Approach

New `send-report` Edge Function that reuses `generate-pdf`'s template+data resolution and Browserless pipeline via direct Deno imports, generates a PDF buffer, base64-encodes it, and sends it as a Resend API attachment. Frontend gets a new `PdfEmailButton` component + `usePdfEmail` hook following the same pattern as `PdfDownloadButton` + `usePdfDownload`.

## Architecture Decisions

| # | Decision | Options (tradeoffs) | Decision |
|---|----------|---------------------|----------|
| 1 | PDF source for email | **A** — `send-report` calls Browserless inline (reuses modules, no storage overhead) / **B** — caller passes signed URL (adds roundtrip, signed URL expiry complexity) / **C** — duplicates PDF gen logic | **A**: inline PDF gen, same `callBrowserless` + `@cmms/pdf-engine` |
| 2 | Duplicated code vs shared lib | Extract shared helpers to a lib/ file (cleaner but touches working code) vs import directly from `generate-pdf/index.ts` (minimal change, Deno supports it) | **Import from `../generate-pdf/index.ts`** — shared: `validateAuth`, `resolveTemplateFromDB`, `resolveDataFromDB`, `callBrowserless`, `jsonResponse`, `CORS_HEADERS` |
| 3 | Resend attachment | Base64 from `ArrayBuffer` — `Uint8Array` → `String.fromCharCode` → `btoa()` | **Standard base64**, single `filename: "report.pdf"` |
| 4 | To field | Free text input vs mechanic selector dropdown | **Free text** — simplest; comma-separated for multiple |
| 5 | Email dialog | MUI Dialog (matches existing confirm dialog pattern) vs inline form | **MUI Dialog** — consistent with WorkOrderDrawer's pattern |
| 6 | Error feedback | Snackbar (matches PdfDownloadButton) vs inline | **Snackbar** for API errors; inline validation for form fields |

## Data Flow

```
PdfEmailButton
  │ usePdfEmail({ to, subject, message, templateCode, recordId, recordType })
  │ POST /functions/v1/send-report  { to, subject, message?, template_code, record_id, record_type }
  ▼
send-report EF
  ├─ 1. validateAuth (JWT)                    ← import from ../generate-pdf/index.ts
  ├─ 2. validatePayload (to, subject required)
  ├─ 3. resolveTemplateFromDB                  ← import from generate-pdf
  ├─ 4. resolveDataFromDB                      ← import from generate-pdf
  ├─ 5. render HTML via @cmms/pdf-engine
  ├─ 6. callBrowserless(html) → ArrayBuffer   ← import from generate-pdf
  ├─ 7. base64 encode buffer
  ├─ 8. POST api.resend.com/emails
  │    { from, to, subject, text?, attachments: [{ filename, content }] }
  └─ 9. Return { messageId }
  ▼
Frontend: Snackbar "Reporte enviado" / error
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/send-report/index.ts` | Create | Handler: auth, payload validation, template/data resolution, PDF gen, Resend send |
| `supabase/functions/send-report/index_test.ts` | Create | Unit tests: payload validation, Resend API mock, integration flow |
| `supabase/functions/send-report/deno.json` | Create | Import map mirroring generate-pdf's |
| `src/hooks/usePdfEmail.js` | Create | Hook: POST to send-report EF, manages loading/error/success state |
| `src/components/pdf/PdfEmailButton.jsx` | Create | MUI Dialog with to/subject/message fields + send button |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Modify | Import and render PdfEmailButton next to PdfDownloadButton for COMP/CLOSED |
| `.env.example` | Modify | Add `RESEND_API_KEY` |

## Interfaces / Contracts

```typescript
// POST /functions/v1/send-report — Request
interface SendReportRequest {
  to: string | string[];
  subject: string;
  message?: string;           // Optional text body
  template_code: string;
  record_id?: string;
  record_type?: string;
  data?: Record<string, unknown>;
}

// Response — Success
interface SendReportResponse {
  messageId: string;
}

// Response — Error
interface SendReportError {
  error: string;
  details?: string[];
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — payload validation | `validatePayload` — valid/invalid `to`, `subject`, missing fields | Mock `Request`, assert error shapes |
| Unit — Resend API call | `sendEmailViaResend` — base64 attachment, correct body, auth header | Mock `globalThis.fetch` |
| Unit — handler errors | 401, 400, 502 — error propagation from imported helpers | Injected mock supabase |
| Integration | Full flow with mocks (auth + template + data + Browserless + Resend) | All injected mocks, assert `{ messageId }` |

## Migration / Rollout

No migration required. Deploy EF via `supabase functions deploy send-report`, add `RESEND_API_KEY` to Supabase secrets, verify DNS domain in Resend dashboard.

## Open Questions

- [ ] Resend `from` address — use a fixed address like `"CMMS Ibero <reports@dominio.com>"` or make configurable?
- [ ] Should `send-report` also write to `report_history` for email sends (audit trail)?
