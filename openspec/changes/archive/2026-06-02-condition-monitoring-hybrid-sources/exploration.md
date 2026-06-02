# Exploration: Condition Monitoring Hybrid Sources (SDD 2)

## Current State

### What Already Exists (from SDD 1 — COMPLETED & ARCHIVED)

SDD 1 delivered the full condition monitoring foundation. Key assets relevant to SDD 2:

| Layer | Artifact | What it provides |
|-------|----------|-----------------|
| **Schema** | `condition_feature_definitions` (12 features) | EAV catalog: vibration.rms, temperature.bearing, manual.noise_score, etc. |
| **Schema** | `condition_analysis_methods` (12 methods) | Method catalog with categories: time_domain, frequency_domain, statistical, model_based, hybrid |
| **Schema** | `condition_source_capabilities` (3 seeds) | Declares what each source can produce: edge_001 (active), manual_route_001 (active), mock_source_001 (candidate) |
| **Schema** | `condition_windows` | Time windows for batch ingest with external_window_id uniqueness |
| **Schema** | `condition_feature_values` | Quality-gated feature values with full traceability (method_key, method_version, quality_flag G0-G3, uncertainty, confidence) |
| **Schema** | `condition_threshold_catalog` (13 ISO rows) | ISO 10816/20816 thresholds per asset_class × mounting_type × regime |
| **Schema** | `condition_events` | Event log with lifecycle (open → linked_to_wo → closed/dismissed) |
| **Schema** | `condition_rules` | Versioned rules engine (threshold, trend, compound, residual) |
| **Schema** | `condition_analysis_results` | HI, dHI/dt, residuals, Kalman placeholder |
| **EFs** | `ingest-condition` (617 LOC) | POST FeatureSet v0.2 → validate 11 fields → validate catalogs → validate source capability → upsert window → insert feature_values → return 200 |
| **EFs** | `ingest-events` (415 LOC) | POST event payload → validate → insert condition_events + event_sources |
| **EFs** | `compute-hi` (303 LOC) | POST → calls compute_health_index(), compute_degradation_velocity(), evaluate_condition_rules() per asset |
| **Tests** | 8 pgTAP test files | 326 assertions across catalogs, ingest, compute, triggers, rules, views |

### Old CBM System (Legacy)

The original `meter_readings` table (from `preventive-condition-core-phase-1`) still exists:
- `meter_readings(id, meter_id, reading_value, reading_date, is_alert_triggered)` — 5 columns
- `measure_points(id, meter_id, upper_limit_warning, upper_limit_critical, lower_limit_warning, lower_limit_critical)` — 6 columns
- `meters(id, asset_id, code, meter_type, uom)` — 5 columns
- **No FeatureSet contract, no quality flags, no method traceability, no multi-feature support**
- CBM trigger (`trg_meter_reading_cbm`) fires on simple threshold comparison only
- This system is **not** currently used by any frontend component

### Source Capabilities Currently Registered

Exactly 3 seed rows in `condition_source_capabilities`:

| source_id | source_type | can_produce | method_key | quality_expected | validation_status |
|-----------|------------|-------------|------------|-----------------|-------------------|
| edge_001 | edge | vibration.rms | rms_velocity_window | G0 | active |
| manual_route_001 | manual | manual.composite | manual_observation | G2 | active |
| mock_source_001 | api | vibration.rms | rms_velocity_window | G2 | candidate |

**Key observation**: Only 3 sources, each producing ONE feature. A real "hybrid" system needs sources producing multiple features (e.g., edge_001 should declare vibration.rms + vibration.peak + temperature.bearing under appropriate methods).

### Frontend Structure

**Tech Stack**: React 19, MUI v9, RxDB v17 + Dexie.js (offline-first), Vite 8, Playwright + Vitest

**Current pages**: Only `MechanicDashboard.jsx` exists as a page component. Everything else is inline in `App.jsx` via Tab-based routing:
- Tab 0: Work Orders (MechanicDashboard)
- Tab 1: Assets (AssetTree + details panel)
- Tab 2: Bandeja FMEA (Planner/Admin only)

**No routing library** (react-router not installed) — navigation is purely Tab-based.

**State Management**: RxDB reactive subscriptions via custom hooks pattern. Examples:
- `useWorkOrders()` — subscribes to work_orders collection
- `useFmeaRepository()` — CRUD hook with reactive subscriptions to 4 FMEA collections
- `useAssets()` — assets + hierarchy tree construction

**Component Patterns**: FMEA wizard uses pattern of `useFmeaRepository()` hook → reactive data → MUI form components (Select, RadioGroup, FormControl, Button). Form state lives in React useState at the wizard container level.

**RBAC**: `get_user_role()` returns `ADMIN`, `PLANNER`, `TECHNICIAN`, `STOREKEEPER`. App.jsx checks `userRole === 'PLANNER' || userRole === 'ADMIN'` for Tab visibility.

### Edge Function Patterns

All 3 EFs share identical structure:
1. CORS preflight handler (OPTIONS → 204)
2. Bearer auth validation (currently dev-mode: accepts any Bearer token)
3. JSON body parsing with type validation
4. Catalog cross-validation against Supabase tables
5. Transactional insert with rollback on error
6. Structured error responses: `{ error: string, details?: string[] }`

**Critical gap**: No idempotency key, no retry queue, no outbox pattern. The only dedup mechanism is `external_window_id` UNIQUE constraint in `condition_windows` (returns 409 on duplicate).

---

## Gap Analysis: What's Missing for True Hybrid Support

### 1. Source Registry Table (CRITICAL)

`condition_source_capabilities` declares WHAT a source can produce but has NO operational metadata. Missing:
- Source status (online/offline/error)
- Owner/responsible person
- Physical location (plant, line, cell)
- Last seen timestamp
- Health metrics (error rate, uptime, success count)
- Metadata JSONB (calibration dates, firmware versions, serial numbers, IP addresses)
- No concept of a "source" as a first-class entity — the source_id is just a string in capabilities

**Impact**: Impossible to build a source management panel without querying sources list. Can't show which sources are healthy/failing.

### 2. Manual Capture UI (CRITICAL)

No frontend exists for a technician to manually record condition readings. Need:
- Asset selector (reuse AssetSearchBar pattern)
- Feature selector pulling from `condition_feature_definitions` (filtered to manual-applicable: manual.noise_score, manual.visual_score, temperature.*, pressure.* from gauge readings)
- Value input fields with unit display
- Quality flag auto-assignment: G2 for manual readings (no sensor, no continuous monitoring)
- method_key auto-set to `manual_observation`
- Operational context capture (regime: STARTUP/IDLE/FULL_LOAD, load_pct if available)
- Submit → construct FeatureSet v0.2 payload → POST to `ingest-condition` EF (or direct Supabase insert bypassing EF)

**Current gap**: The only EF for ingest is `ingest-condition` which expects a full FeatureSet payload. There's NO "manual-capture" endpoint that wraps the FeatureSet construction. The frontend would need to construct the FeatureSet object client-side and POST to ingest-condition directly (since it uses supabase-js, could also insert directly with service_role if using RPC).

### 3. CSV Import Workflow (HIGH)

No CSV import mechanism exists. Need complete pipeline:
- File upload component (MUI Dropzone or simple file input)
- Client-side CSV parsing (Papa Parse or built-in)
- Column mapping UI: user maps CSV columns → feature_keys
- Validation pass against `condition_feature_definitions` (reject unknown feature_keys)
- Preview table showing parsed rows with validation errors highlighted
- Bulk ingest: one window per CSV row, or batch all rows into one window with multiple features
- Edge Function or client-side construction of FeatureSet payloads
- Error handling: partial success (some rows valid, some not)

**Architectural decision needed**: Should CSV parsing happen client-side (browser) or server-side (new EF)? 
- Client-side: faster feedback, works offline, needs Papa Parse dependency. Risk: large files (10k+ rows) may block UI.
- Server-side: handles large files, but adds latency for preview, requires new EF deployment.

### 4. Mock/Test Sources Management (MEDIUM)

`mock_source_001` exists as a seed but has no:
- UI to enable/disable it
- UI to configure what data it generates
- Way to inject test events through the UI
- Sandboxed testing environment

**Impact**: Developers can't easily test the CBM pipeline end-to-end without real sensors.

### 5. Robust Ingest (CRITICAL)

Current `ingest-condition` has basic dedup (external_window_id UNIQUE → 409) but lacks:
- **Idempotency key**: client-supplied key to prevent duplicate processing
- **Retry logic**: if supabase is temporarily unavailable, the EF fails permanently (no queued retry)
- **Outbox pattern**: failed ingests should be stored in an outbox table for later retry, not silently lost
- **Batch processing**: current EF processes one window at a time; multi-window batches are not supported
- **Rate limiting**: no protection against flood from malfunctioning sources
- **Dead letter queue**: permanently failed messages need storage for operator inspection

### 6. Source Type Diversity (MEDIUM)

All 8 source types from the CHECK constraint are defined but only `edge`, `manual`, and `api` have seed data. Types like `csv`, `modbus`, `mqtt`, `portable`, `scada` are defined but untested. While SDD 2 is about "hybrid" support, the actual protocol adapters for Modbus/MQTT/SCADA are out of scope (those live in the edge/gateway layer, not in CMMS). What SDD 2 SHOULD provide is:
- The ability to register sources of these types
- The contract that any source implements FeatureSet v0.2
- No custom protocol adapters in CMMS

---

## Affected Areas

### Backend — New Migrations

- `supabase/migrations/YYYYMMDDHHMMSS_condition_source_registry.sql` — New table: `condition_source_registry` (source_id PK, source_name, source_type FK?, status, owner, location, last_seen, health_metrics JSONB, metadata JSONB, created_at, updated_at)
- `supabase/migrations/YYYYMMDDHHMMSS_condition_ingest_outbox.sql` — New table: `condition_ingest_outbox` (id, external_window_id, payload JSONB, status: pending/processing/failed/dead, retry_count, error_message, created_at, next_retry_at)
- `supabase/migrations/YYYYMMDDHHMMSS_condition_source_extensions.sql` — Extend `condition_source_capabilities` with additional seed data (multi-feature capabilities, csv/modbus/mqtt source types)

### Backend — Edge Functions

- `supabase/functions/ingest-condition/index.ts` — Extend: add idempotency key support, outbox write on failure, batch window support
- `supabase/functions/csv-parse-validate/index.ts` — New EF: accepts CSV file, parses, validates feature_keys, returns validated FeatureSet array or errors
- `supabase/functions/ingest-batch/index.ts` — New EF (optional): accepts array of FeatureSet payloads, processes with retry/outbox
- `supabase/functions/source-health/index.ts` — New EF: checks source health, updates last_seen, computes health metrics

### Backend — SQL Functions

- `compute_source_health(source_id TEXT)` — aggregates error rate, uptime, last_seen from windows+events
- `retry_failed_ingests()` — scans outbox, retries pending items with exponential backoff
- `purge_dead_letters(days INT)` — cleanup for permanently failed outbox entries

### Frontend — New Pages/Components

- `src/pages/ConditionCapture.jsx` — Manual condition reading form (technician captures vibration/temperature/noise scores)
- `src/components/condition/ConditionFeatureForm.jsx` — Individual feature input row (feature selector + value + unit)
- `src/components/condition/SourceManagementPanel.jsx` — List all sources, show capabilities, change validation_status
- `src/components/condition/CsvImportForm.jsx` — File upload → column mapping → preview → submit
- `src/components/condition/SourceHealthBadge.jsx` — Visual indicator of source status (online/offline/error)
- `src/hooks/useConditionSources.js` — RxDB-based reactive hook for source_registry + capabilities
- `src/hooks/useConditionCapture.js` — Hook for manual capture logic (FeatureSet construction, validation, submit)

### Frontend — Navigation

- `src/App.jsx` — Add new Tab: "Monitoreo de Condición" (visible to TECHNICIAN, PLANNER, ADMIN)
- Or add sub-navigation within the Condition tab to switch between: Manual Capture | Sources | CSV Import | Events

### Frontend — RxDB

- `src/lib/rxdb.js` — Add new schemas: `condition_source_registry`, `condition_ingest_outbox`, `condition_feature_definitions`, `condition_source_capabilities` (pull-only for catalogs). Add replications.
- `src/lib/adapters/conditionAdapter.js` — View model adapters for condition sources, features, capabilities

### Testing

- `supabase/tests/database/condition_source_registry_test.sql` — pgTAP: schema, constraints, RLS
- `supabase/tests/database/condition_ingest_outbox_test.sql` — pgTAP: outbox schema, retry logic
- `tests/condition-manual-capture.spec.js` — Playwright: manual capture flow end-to-end
- `tests/condition-csv-import.spec.js` — Playwright: CSV import flow end-to-end
- `tests/condition-source-management.spec.js` — Playwright: source panel CRUD + filter
- `src/components/condition/__tests__/ConditionFeatureForm.test.js` — Vitest: unit tests

---

## Approaches

### Approach A: Full-Feature Frontend + Backend (Recommended)

Build everything in one SDD: source registry, manual capture page, CSV import, source management panel, robust ingest with outbox.

| Pros | Cons | Complexity |
|------|------|------------|
| Complete hybrid support in one delivery | Large change (~2500 LOC including EFs, migrations, tests) | High |
| All frontend components share the same hooks and adapters | Risk of scope creep (too many features at once) | |
| Source registry enables management panel immediately | Requires careful PR splitting for review budget | |
| Outbox pattern resolves a real production concern | Outbox retry logic needs careful edge case handling | |

**PR Split Strategy**: 3 chained PRs using stacked-to-main:
- **PR A (Backend Foundation)**: source_registry DDL + seed data, outbox DDL, extended capabilities seed, pgTAP → ~500 LOC
- **PR B (Frontend)**: Manual capture page + source management panel + CSV import + Playwright tests → ~1200 LOC
- **PR C (Robust Ingest)**: Extend ingest-condition for idempotency/outbox/batch, csv-parse-validate EF, source-health EF → ~800 LOC

### Approach B: Backend-First, Frontend Later

Focus SDD 2 on backend infrastructure only: source registry, outbox, idempotency, retry. Defer all frontend to a separate change or SDD 3.

| Pros | Cons | Complexity |
|------|------|------------|
| Smaller scope, lower risk | Frontend is where the "hybrid" value actually materializes | Medium |
| Outbox/retry is infrastructure that enables future reliability | Without UI, can't validate the manual/CSV flows end-to-end | |
| Faster to deliver, unblocks SDD 3 sooner | Splits the roadmap — roadmap says SDD 2 includes "captura manual y rutas híbridas" | |

### Approach C: Minimal Viable Hybrid

Only build what's strictly necessary:
1. Manual capture page (POSTs directly to ingest-condition via supabase client)
2. Source registry table (DDL only, no management UI)
3. CSV import as a pure client-side feature (no new EF)
4. Skip outbox/retry (defer to SDD 5 governance)

| Pros | Cons | Complexity |
|------|------|------------|
| Fastest to deliver | Technical debt on ingest reliability | Low-Medium |
| Proves the FeatureSet v0.2 contract with real manual/CSV data | Outbox/retry missing means production ingest may silently lose data | |
| All frontend in one deliverable | Source management without UI means DB-only operations | |

---

## Recommendation

**Approach A with pragmatic scoping** — build the full hybrid system, but with these guardrails:

1. **Source Registry is MANDATORY** — without it, there's no way to list/manage sources. This must be the first migration.
2. **Manual Capture is MANDATORY** — it's the single most impactful feature for operators who need to record vibration/temperature/noise scores during inspections.
3. **CSV Import as client-side only** — use Papa Parse in the browser for parsing, construct FeatureSet payloads client-side, POST to ingest-condition. No new EF needed for CSV parsing (avoids 200+ lines of EF code).
4. **Outbox pattern: basic implementation only** — `condition_ingest_outbox` table + `retry_failed_ingests()` SQL function + db cron. Defer the full outbox EF processor to SDD 5.
5. **Source Management panel: read-only first** — show source list with capabilities and health status. Defer validation_status editing to a privileged admin-only workflow.
6. **Split into 2 PRs** (not 3) to keep review manageable:
   - **PR 1 (Backend + Ingest Robustness)**: source_registry, outbox, extended capabilities seed, enhanced ingest-condition, new csv endpoint, pgTAP → ~800 LOC
   - **PR 2 (Frontend)**: Manual capture page, CSV import form, source management panel, condition hooks/adapters, Playwright + Vitest → ~1200 LOC

### Why not Approach B or C?

- **Approach B** defers the frontend but the whole point of "hybrid sources" is to give operators a UI to capture data. Without it, SDD 2 delivers nothing visible.
- **Approach C** skips outbox/retry which directly contradicts the roadmap's "ingesta robusta (idempotencia, outbox, retry, deduplicación, validación)" requirement.

---

## Risks

1. **ingest-condition refactoring risk**: Adding idempotency and batch support to the existing 617-LOC EF may introduce regressions if not carefully tested. Mitigation: export all validation functions for unit testing; add Deno tests for the EF.
2. **FeatureSet v0.2 client-side construction**: The manual capture page must construct a valid FeatureSet payload. If the frontend makes a mistake in payload format, ingest-condition will reject it. Mitigation: share the TypeScript interfaces between EF and frontend; validate client-side before POST.
3. **CSV column mapping UX**: Non-technical users may struggle with mapping CSV columns to feature_keys. Mitigation: auto-detect column names that match feature_keys; provide clear error messages for unrecognized columns; show preview before submit.
4. **RxDB sync for condition tables**: Currently, condition tables are NOT replicated to RxDB. Adding them to the offline DB increases complexity and local storage usage. Mitigation: condition_feature_definitions and source_registry should be pull-only (catalogs); condition_feature_values and windows should NOT be replicated (they're write-heavy, read via Supabase queries directly).
5. **Outbox retry amplification**: If a failing window has 500 features and retries 3 times, that's 1500 failed INSERT attempts. Mitigation: outbox stores the full raw payload, not individual features; retry with exponential backoff; max 3 retries before dead-letter.
6. **400-line review budget**: PR 2 (frontend) at ~1200 LOC far exceeds the 400-line budget. Mitigation: split PR 2 into 3 stacked frontend slices (manual capture → CSV import → source panel) each at ~400 LOC.
7. **No routing library**: Frontend navigation is Tab-based in App.jsx. Adding complex sub-navigation (3 forms under one tab) without a router will make App.jsx bloated. Mitigation: Use a sub-tab pattern within the Condition tab (similar to how FMEA wizard uses LevelSelector); keep each "page" as a standalone component.

---

## Required Schema: `condition_source_registry`

This table does NOT exist yet. Proposed DDL:

```sql
CREATE TABLE IF NOT EXISTS public.condition_source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT UNIQUE NOT NULL,              -- matches condition_source_capabilities.source_id
  source_name TEXT NOT NULL,                   -- human-readable name
  source_type TEXT NOT NULL CHECK (source_type IN (
    'edge', 'manual', 'portable', 'csv', 'modbus', 'mqtt', 'api', 'scada'
  )),
  status TEXT DEFAULT 'unknown' CHECK (status IN (
    'unknown', 'online', 'offline', 'error', 'maintenance', 'disabled'
  )),
  owner TEXT,                                  -- responsible person/user_id
  location TEXT,                               -- physical location (plant, line, cell)
  last_seen TIMESTAMPTZ,                       -- last successful ingest timestamp
  health_metrics JSONB DEFAULT '{}',           -- {error_rate, uptime_pct, total_windows, failed_windows, avg_latency_ms}
  metadata JSONB DEFAULT '{}',                 -- {firmware_version, serial_number, ip_address, calibration_due, ...}
  notes TEXT,
  validation_status TEXT DEFAULT 'draft' CHECK (validation_status IN (
    'draft', 'candidate', 'bench_validated', 'field_trial', 'active', 'deprecated', 'rejected'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**RLS**: SELECT → authenticated; INSERT/UPDATE/DELETE → PLANNER, ADMIN

**Indexes**: source_id, source_type, status, validation_status

**Seed data**: Register all 3 existing sources (edge_001, manual_route_001, mock_source_001) from capabilities into registry with status='unknown'.

---

## Required Schema: `condition_ingest_outbox`

```sql
CREATE TABLE IF NOT EXISTS public.condition_ingest_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE,                 -- client-supplied dedup key
  external_window_id TEXT,                     -- optional, if window already created but features failed
  payload JSONB NOT NULL,                      -- full FeatureSet payload (compressed if large)
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'failed', 'dead'
  )),
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  next_retry_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 minute'),
  last_retry_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);
```

---

## Ready for Proposal

**Yes** — proceed to proposal. The investigation is complete with a clear picture of:

1. **What SDD 1 delivered**: Full foundation with 10 condition tables, FeatureSet v0.2 contract, 3 EFs, 326 pgTAP assertions, RLS patterns.
2. **What's missing for hybrid support**: Source registry table, manual capture UI, CSV import workflow, robust ingest (outbox/retry/idempotency), source management frontend.
3. **Recommended approach**: Full-feature build (Approach A) split into 2 PRs (backend infra + frontend), with pragmatic scoping (CSV client-side, outbox basic, source panel read-only).
4. **Frontend impact is substantial**: 3 new forms/pages, new RxDB hooks, new Tab in App.jsx, Playwright tests.
5. **Backend impact is moderate**: 2 new migrations, 1 new EF (csv-parse-validate), 1 extended EF (ingest-condition), 2 new SQL functions.
6. **Testing strategy**: pgTAP for schema, Playwright for UI flows, Vitest for unit tests.
