# Proposal: PDF Email Delivery

## Intent

Slice 2 of Phase 3 — enable sending generated PDFs via email from the app. Users currently download and manually forward PDFs; this removes that friction with a "send by email" flow via Resend.

## Scope

### In Scope
- EF `send-report` at `supabase/functions/send-report/`:
  - Input: `{ to: string | string[], subject: string, template_code: string, record_id: string, message?: string }`
  - Generates PDF via internal `generate-pdf` pipeline (template + data + Browserless)
  - Sends email with PDF attachment via Resend REST API
  - Returns `{ messageId }` on success
- Frontend: "Enviar por email" button next to PdfDownloadButton — MUI dialog: `to`, `subject`, optional `message`
- `deno test` suite (unit + Resend mock)
- `.env.example` — add `RESEND_API_KEY`

### Out of Scope
- Scheduled/automated reports (Slice 3)
- HTML email body templates
- Email history tracking beyond Resend dashboard
- Batch email (list upload)

## Capabilities

### New Capabilities
- `pdf-email-delivery`: Send generated PDFs via email using Resend API

### Modified Capabilities
- None

## Approach

1. Create `send-report` EF following `generate-pdf` pattern: CORS, auth JWT, payload validation, handler dispatch
2. Reuse `@cmms/pdf-engine` + Browserless pipeline internally to produce PDF buffer (import shared modules from `generate-pdf` or extract `lib/pdf-generation.ts`)
3. Attach PDF as base64 to Resend `POST https://api.resend.com/emails` — no SDK, plain `fetch()`
4. Frontend: email-send dialog added near PdfDownloadButton — generates PDF first, then calls send EF
5. Auth: same JWT `Authorization: Bearer` + service role key pattern

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/functions/send-report/` | New | EF ~250-300 lines |
| `supabase/functions/generate-pdf/` | Minor | Optionally extract shared helpers |
| `src/components/pdf/` | Modified | Email send dialog + button |
| `src/hooks/` | New | `usePdfEmail` hook |
| `.env.example` | Modified | Add `RESEND_API_KEY` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Resend domain verification required | High | Document in setup guide |
| PDF exceeds Resend 10 MB limit | Low | WOs are < 1 MB; add size check |
| Resend free tier rate limit (100/day) | Low | Document; surface 429 to user |

## Rollback Plan

- Delete `supabase/functions/send-report/` — routing stops
- `git checkout` on `src/components/pdf/` and `src/hooks/`
- Revert `.env.example` addition

## Dependencies

- Resend account (free tier: 100/day, 10 MB per attachment)
- Domain verified in Resend dashboard for `from` address

## Success Criteria

- [ ] EF sends email with PDF attachment and returns `{ messageId }`
- [ ] Frontend dialog sends email with correct attachments
- [ ] `deno test` passes (unit + Resend mock)
- [ ] Recipient receives email with valid, renderable PDF
