# Tasks: Advanced Reports — Slice 2 (Materials, Compliance & Checklists)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: DB + Materials → PR 2: Compliance → PR 3: Checklists |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB view + Materials report | PR 1 → main | migration, hook, component, tests, page wiring for 1 tab |
| 2 | Compliance report | PR 2 → main | hook, component, tests, page wiring; depends on PR 1 infra |
| 3 | Checklists report + full page | PR 3 → main | hook, component, tests, page wiring finalization + ReportsPage test |

Each PR adds one functional tab. Page always renders all accumulated tabs.

## Phase 1: DB — Materials View

- [ ] 1.1 Create `supabase/migrations/*_materials_view.sql` — `CREATE OR REPLACE VIEW report_materials_consumed` with `security_invoker=true`, JOIN `inventory_transactions` + `spare_parts` + `work_orders`, filter `ISSUE`/`DIRECT_ISSUE`, `ABS(qty)`, GROUP BY part/WO

## Phase 2: Hooks

- [ ] 2.1 Create `src/hooks/useMaterialsConsumed.js` — query view with date/asset/part filters, returns `{items, partSummary, grandTotal, loading, error, refetch}`
- [ ] 2.2 Create `src/hooks/useComplianceReport.js` — `Promise.all` for 3 sub-queries (permits, LOTO, certs), partial-error per spec, returns `{expiringPermits, expiredPermits, activeLoto, techCerts, loading, error, refetch}`
- [x] 2.3 Create `src/hooks/useChecklistEvidence.js` — query instances + responses w/ photo_url, compute PASS/FAIL/NA stats via `computeSummary()`, returns `{instances, summary, loading, error, refetch}` (note: returns `summary` not `stats` per design.md)

## Phase 3: Report Components

- [ ] 3.1 Create `src/components/reports/MaterialsConsumedReport.jsx` — Recharts BarChart + MUI Table, `data-widget-id` refs, 4-state pattern
- [ ] 3.2 Create `src/components/reports/ComplianceReport.jsx` — MetricCards + 3 MUI Tables, per-section error fallback, 4-state pattern
- [x] 3.3 Create `src/components/reports/ChecklistEvidenceReport.jsx` — MetricCards + `<img crossOrigin="anonymous">` gallery + MUI table with photo placeholder, 4-state pattern

## Phase 4: Page Wiring

- [x] 4.1 Modify `src/pages/ReportsPage.jsx` — add `materiales|compliance|checklists` tabs, 3 new hook calls, conditional filters per tab, widget refs, `hasNoData` extension, import 3 new components
- [ ] 4.2 Verify `html2canvas ^1.4.1` + `jspdf ^2.5.2` in `package.json` — no npm install needed

## Phase 5: Tests

- [ ] 5.1 `src/hooks/__tests__/useMaterialsConsumed.test.js` — 4 states + filter + refetch
- [ ] 5.2 `src/hooks/__tests__/useComplianceReport.test.js` — 4 states + partial sub-query failure + all-3 failure
- [x] 5.3 `src/hooks/__tests__/useChecklistEvidence.test.js` — 4 states + PASS/FAIL/NA stats + photo_url + SKIPPED handling + null responses edge case
- [ ] 5.4 `src/components/reports/__tests__/MaterialsConsumedReport.test.jsx` — loading/error/empty/success + bar + table
- [ ] 5.5 `src/components/reports/__tests__/ComplianceReport.test.jsx` — 4 states + 3 sub-tables + partial error
- [x] 5.6 `src/components/reports/__tests__/ChecklistEvidenceReport.test.jsx` — 8 tests: loading, error, empty, mixed data, with photos, without photos, data-widget-id, no retry button
- [x] 5.7 Modify `src/components/reports/__tests__/ReportsPage.test.jsx` — mock useChecklistEvidence + assert Checklists tab

## Migration Safety Cross-Check

- View uses `CREATE OR REPLACE` (idempotent, safe to re-run)
- No `ALTER TABLE`, no new columns, no data migration
- Rollback: `DROP VIEW IF EXISTS report_materials_consumed` + revert `ReportsPage.jsx` + delete 6 new files
- RLS preserved via `security_invoker = true`
- Compliance partial-error: one failing sub-query does not block others
- No npm dependency changes needed
