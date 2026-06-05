# Exploration: PDF Engine Phase 3 — Edge Function + Server-side PDF

## Current State

### Edge Function Architecture
5 Edge Functions exist in `supabase/functions/`, each in its own directory with a consistent pattern:
- **Entry point**: `index.ts` with `if (import.meta.main) { Deno.serve(handleRequest); }` guard
- **Exported handler**: `handleRequest(request: Request): Promise<Response>` — testable, no side effects
- **Config**: Per-function `deno.json` with imports (`jsr:@supabase/supabase-js@2`)
- **No global** `import_map.json` or `deno.json`
- **Auth**: Bearer token validated against env var (Service Role pattern)
- **CORS**: Explicit `corsHeaders()` helper in functions that need it
- **Config**: `supabase/config.toml` minimal — only `verify_jwt = false` for `oee-trigger`

Existing functions: `epicor-webhook`, `ingest-condition`, `ingest-events`, `compute-hi`, `oee-trigger`

### Template Engine Portability
The template engine at `src/lib/pdf/` is **vanilla JS with zero dependencies** — it works identically in browser and Deno:
- `templateEngine.js` — resolveField, evaluateCondition, renderSection, resolveTemplate, validateTemplate
- `templateDefaults.js` — 10 pipes, 13 section renderers, DEFAULT_CSS, DEFAULT_TEMPLATE_OT
- Written as ESM, no Node.js APIs, no DOM APIs, no npm deps

**Veredict**: CAN be imported directly in a Deno Edge Function as-is. The challenge is making the import path work across the frontend/Deno boundary.

### Browserless/HTML→PDF
**No existing infrastructure.** No Docker, no browserless, no puppeteer, no html-pdf libraries. Only Playwright (e2e test tool).

### Storage & Downloads
- **Branding bucket** (`public`) exists for template logos (Phase 2)
- Uses `supabase.storage.getPublicUrl()` — public URLs
- **No signed URL pattern** exists
- **No PDF storage** — need new bucket `reports` or `pdf-exports`

### Email/SMTP
**No email infrastructure.** No Resend, SendGrid, or SMTP. Only `auth.users.email` references in test SQL.

### Scheduling (pg_cron)
**Available** — migration `20260524000005_setup_pm_cron.sql` creates the extension and schedules `pm_engine_daily`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
SELECT cron.schedule('pm_engine_daily', '0 1 * * *', $$SELECT ...$$);
```
Pattern: schedule SQL function directly. For Edge Functions, use `net.http_post()`.

### Testing
Well-established pattern in `*_test.ts` files:
- `jsr:@std/assert` for assertions
- `Deno.test()` with named cases
- Unit tests for exported functions (validateAuth, validatePayload, handleRequest)
- Integration tests gated by `ignore: !Deno.env.get("SUPABASE_URL")`
- Full DB round-trip with seed/cleanup
- Run with: `deno test --allow-env --allow-net`

## Affected Areas

| File | Why Affected |
|------|-------------|
| `supabase/functions/generate-pdf/` | New Edge Function — core PDF generation |
| `src/lib/pdf/templateEngine.js` | Needs to be importable from Deno (shared or copied) |
| `src/lib/pdf/templateDefaults.js` | Same — needed by the Edge Function |
| `supabase/migrations/*.sql` | New migration for `reports` storage bucket + RLS |
| `supabase/migrations/*.sql` | New migration for optional tables (report_schedules) |
| `src/components/mechanic/WorkOrderDrawer.jsx` | Add "Download PDF" button |
| `src/hooks/` | New hook for download/signed URL flow |
| `supabase/config.toml` | Register new Edge Function(s) |
| `package.json` | No changes needed (frontend to Edge Function is HTTP) |
| `.env.example` | Add Browserless URL, Resend API key |

## Approaches

### 1. Monolithic Edge Function — Single `generate-pdf` for everything
One Edge Function handling: HTML→PDF, storage, history logging. Separate functions for email and scheduling.

- **Pros**: Simple, follows existing patterns, easy to test
- **Cons**: Single responsibility principle stretched, harder to extend
- **Effort**: Medium

### 2. Modular Split — Multiple specialized Edge Functions
- `generate-pdf`: HTML→PDF + storage + signed URL (core)
- `send-report`: Email delivery (calls generate-pdf internally or via webhook)
- `scheduler-trigger`: pg_cron hook (leans on DB)

- **Pros**: Clear SRP, testable in isolation, easier to deploy independently
- **Cons**: More files, inter-function coordination
- **Effort**: Medium-High

### 3. Progressive Delivery — Build core first, add features iteratively
Phase 3 split into 4 SDD changes:
1. `pdf-generation-core`: generate-pdf Edge Function + storage bucket + download UI
2. `pdf-email-delivery`: send-report Edge Function + Resend integration
3. `pdf-scheduled-reports`: report_schedules table + pg_cron + batch Edge Function
4. `pdf-admin-dashboard`: (optional) history viewer, re-send, manage schedules

- **Pros**: Small PRs, clear review boundaries, delivers value incrementally
- **Cons**: More SDD cycles, chained PRs
- **Effort**: Medium (per slice)

## Recommendation

**Approach 3 — Progressive Delivery** is the best fit for this project's SDD workflow. Phase 3 is large enough (~900-1200 lines across all features) that it needs chained PRs to stay within the 400-line review budget.

**Slice 1 — Core (`pdf-generation-core`):**
- Edge Function `generate-pdf` in `supabase/functions/generate-pdf/`
    - Accepts `{ template_code: string, version?: number, data: object }`
    - Fetches template from `report_templates` table via Service Role client
    - Resolves HTML using template engine (either shared import or bundled copy)
    - Sends HTML to Browserless API (`POST https://chrome.browserless.io/pdf` with HTML body)
    - Receives PDF buffer, uploads to `reports` storage bucket
    - Creates `report_history` entry with generated_at, storage_path
    - Generates signed URL (e.g., 1-hour expiry) and returns it
    - ~350-400 lines
- Storage: New `reports` bucket (private, no public access)
- Migration: `CREATE TABLE IF NOT EXISTS` for any new columns on `report_history` (e.g., `storage_path TEXT`, `signed_url_expires_at`)
- Frontend: Add download button in WorkOrderDrawer that calls the Edge Function
- Tests: Unit + integration with Browserless mock

**Slice 2 — Email (`pdf-email-delivery`):**
- Edge Function `send-report` (or extend `generate-pdf` with an optional `email_to` parameter)
- Resend API integration via `fetch`
- PDF generated, attached as email, stored+logged
- ~200-250 lines

**Slice 3 — Scheduled Reports (`pdf-scheduled-reports`):**
- New `report_schedules` table: id, template_code, cron_expression, params (JSONB), recipients (text[]), is_active
- pg_cron job using `net.http_post()` to trigger an Edge Function
- Edge Function `execute-scheduled-reports`: queries due schedules, generates PDFs, sends emails
- ~250-300 lines

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Template engine import path** — Deno Edge Function can't directly import `src/lib/pdf/templateEngine.js` if it uses relative paths outside its directory | Blocking | Option A: Copy files to function dir (simple, drifts). Option B: Use Deno's `--allow-read` with relative path from monorepo root. Option C: Extract to JSR package |
| **Browserless cost/timing** — SaaS pricing, cold starts, request timeout | Medium | Set 30s timeout in Edge Function, cache Browserless connection, monitor costs |
| **No existing signed URL pattern** — first time implementing, need to test | Low | Follow Supabase JS docs: `supabase.storage.from('reports').createSignedUrl(path, 3600)` |
| **Email setup from scratch** — no Resend account, no verified domain, no templates | Medium | Start with download-only (Slice 1), defer email to Slice 2 |
| **pg_cron + net.http_post** — first time triggering Edge Function from cron | Low | Follow existing Supabase patterns, use `pg_net` extension if available |
| **Deno compatibility** — template engine uses ESM `import` which Deno supports, but need to verify no subtle differences | Low | Port template engine to `.ts` with explicit types, add Deno CI check |

## Ready for Proposal

**Yes.** All areas have been investigated. The recommendation is 3 progressive SDD changes starting with `pdf-generation-core`.

Key open decision for the proposal: **How to handle the template engine import** (copy vs shared vs package). Each has concrete tradeoffs to discuss.
