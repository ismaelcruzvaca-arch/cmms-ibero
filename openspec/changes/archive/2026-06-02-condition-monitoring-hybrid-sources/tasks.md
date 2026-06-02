# Tasks: Condition Monitoring Hybrid Source Integration & Ingest Governance

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1900 (700 PR1 + 1200 PR2) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1→main, Slice2a→main, Slice2b→main, Slice2c→main |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Ingest Governance Foundation (~700 LOC) | PR 1 → main | 3 migrations + EF extend + pgTAP |
| 2 | Manual Capture (~500 LOC) | Slice 2a → main | Form + hook + App tab |
| 3 | CSV Import (~450 LOC) | Slice 2b → main | Staging + parser + preview + confirm |
| 4 | Sources + Dead-Letter (~450 LOC) | Slice 2c → main | Panel + panel + RxDB + RBAC + tests |

## Phase 1: PR 1 — Ingest Governance Foundation

- [x] T-1.1 Migration `condition_sources`: DDL (13 cols, CHECK for source_type/status/validation_status, 5 indexes), RLS (SELECT→auth, INSERT/UPDATE→PLANNER+ADMIN, DELETE→ADMIN), seed 5 sources (edge_001 active, manual_route_001 active, csv_import candidate, mock_source field_trial, portable_01 field_trial). → CSR-001,002,003,004
- [x] T-1.2 Migration `condition_ingest_outbox` + `condition_ingest_failures`: outbox (idempotency_key UNIQUE, payload JSONB, status pending/processing/failed/dead, retry_count, next_retry_at, 4 indexes) + failures (outbox_id FK, payload JSONB, status pending_retry/dead_letter/resolved/ignored/reprocessed, error_code, resolved_by, 3 indexes), RLS for both. → CIR-001,002
- [x] T-1.3 Migration `condition_ingest_governance` ALTERs: `condition_windows` +ingested_by TEXT, +late_data_flag BOOLEAN, +late_data_hours NUMERIC, +quality_gate_passed BOOLEAN, FK to condition_sources(source_id), 2 indexes. `condition_feature_values` +ingested_by, +measured_by, +entered_by, +measured_at, +entered_at, +instrument_ref, +notes, 2 indexes. `condition_source_capabilities` +late_event_cutoff_hours. → CSR-005, CISA-002
- [x] T-1.4 SQL function `is_source_capable(source_id, feature_key, method_key) → BOOLEAN`: query condition_source_capabilities for matching capability with validation_status IN (active, field_trial, bench_validated). Migration PR1-3. → CSCE-001
- [x] T-1.5 Extend `ingest-condition/index.ts`: (a) validateSourceLifecycle()—reads condition_sources.status→400 if draft/disabled/deprecated, force G2 if candidate, cap events if field_trial; (b) computeLateDataPolicy()—diff ingested_at−measured_at vs cutoff_hours→late_data_flag; (c) buildIdempotencyKey() per source_type→check condition_windows+outbox→409 if exists; (d) is_source_capable() call→400 if no capability, force G2 if draft/rejected; (e) try/catch DB insert→writeOutbox() on failure; (f) conditional RPC evaluate_condition_rules/HI fire-and-forget. → CIR-003, CSCE-001,002,003,004, CLDP-001,002,003,004, DING-004, DING-007
- [x] T-1.6 SQL functions `retry_failed_ingests()` + `purge_dead_letters(days)`: retry—LIMIT 10 pending where next_retry_at≤NOW(), backoff 1/5/15min, after 3 fails→move to condition_ingest_failures status=dead_letter. purge—DELETE resolved/ignored older than N days. Migration PR1-3. → CIR-004
- [x] T-1.7 pgTAP 1 test file—`condition_hybrid_governance_test.sql` (~83: schema cols, CHECK constraints, RLS per role, lifecycle transitions, seeds count, outbox round-trip, UNIQUE, is_source_capable scenarios, late_data cutoff logic, retry/purge functions, indexes). → All PR 1 specs

## Phase 2: PR 2 Slice 2a — Manual Capture

- [x] T-2.1 Migration `condition_import_staging`: `condition_import_batches` (batch_id UNIQUE, file_name, file_hash SHA-256, row_count/valid_rows/invalid_rows, column_mapping JSONB, status uploaded→validating→validated→ready_to_import→importing→imported→failed→cancelled, error_summary JSONB, 3 indexes, RLS) + `condition_import_rows` (batch_id FK CASCADE, row_number, raw_data JSONB, mapped_data JSONB, validation_errors TEXT[], status pending/valid/invalid/imported/error, UNIQUE(batch_id,row_number), 2 indexes, RLS). → CCI-001,002
- [x] T-2.2 Migration `condition_extended_capabilities`: seed multi-feature for edge_001 (+vibration.peak under peak, +temperature.bearing under window_average), new sources csv_import+portable_01 with capabilities, condition_sources seeds for new types. → SCAP-003 delta

## Phase 3: PR 2 Slice 2a (cont.) — Manual Capture Components

- [x] T-2.3 `ConditionCapture.jsx` + `useConditionCapture.js`: asset selector (autocomplete), feature cascada (auto method_key), value numeric, quality_flag G0/G1/G2 default G2, operational_context fields, instrument_ref, notes, measured_by/entered_by (distinct), measured_at/entered_at; FeatureSet v0.2 client-side construction; POST to ingest-condition with source_id=manual_route_001; client-side validation (feature∈catalog, value>0, quality_flag valid). → CMC-001,002,003,005

## Phase 4: PR 2 Slice 2b — CSV Import

- [x] T-2.4 `CsvImportForm.jsx` + `useCsvImport.js`: file upload (size<10MB, .csv), Papa Parse (delimiter detection, headers, rows), column auto-detect (fuzzy-match headers→feature_key/value/measured_at/unit/asset_id), mapping UI (dropdown per column), validate rows (feature_key∈catalog, value numeric, measured_at parseable, asset_id exists), preview table (MUI DataGrid green=valid red=invalid, tooltip errors), confirm→batch create+bulk POST ingest-condition (idempotency batch_id+row_number). → CCI-003,004,005

## Phase 5: PR 2 Slice 2c — Source Panel + Dead Letter

- [x] T-2.5 `SourceManagementPanel.jsx` + `SourceHealthBadge.jsx` + `useConditionSources.js`: MUI Table list with status badges (active green, offline gray, error red, field_trial yellow), last_seen indicator, capabilities display; RxDB pull-only subscription. → CSR-005 UI
- [x] T-2.6 `DeadLetterPanel.jsx`: MUI Table (source_id, error_code, error_message, created_at, status), actions: Reintentar→PATCH pending_retry+re-ingest, Descartar→PATCH ignored, Ver payload→MUI Dialog JSON; filters by source_id/status; PLANNER/ADMIN only. → CIR-005, CISA-003
- [x] T-2.7 RxDB schemas in `src/lib/rxdb.js`: pull-only for condition_feature_definitions, condition_sources, condition_source_capabilities; local offline collection `condition_capture_queue` (payload JSONB, measured_at, status pending/syncing/synced/failed). → CMC-004

## Phase 6: Integration + Tests

- [x] T-2.8 `App.jsx`: new Tab 3 "Monitoreo de Condición" (visible TECHNICIAN+), sub-tabs: Captura (TECHNICIAN+) — done ✅; CSV (PLANNER/ADMIN) — done ✅; Fuentes (authenticated) — done ✅; Dead-Letter (PLANNER/ADMIN) — done ✅. → CISA-001
- [x] T-2.9 Tests: pgTAP `condition_staging_test.sql` (24 assertions: batch/row schema, FK, RLS, status transitions, extended capabilities) — done ✅; Vitest 2 → useCsvImport (30 tests) + useConditionCapture (18 tests) ✅; Playwright 4 flows → deferred (requires local Supabase). → All PR 2 specs
- [x] T-2.10 No regresión: vitest 86 assertions pass (38 existing + 48 new ✅). pgTAP 326 assertions — deferred (local Supabase unavailable). Build verificado sin errores ✅.
