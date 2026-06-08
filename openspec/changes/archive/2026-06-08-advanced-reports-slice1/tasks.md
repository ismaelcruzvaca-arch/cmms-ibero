# Tasks: Advanced Reports — Slice 1

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: DB + deps + hooks → PR 2: Components + page + wiring |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB views + deps + 4 hooks + hook tests | PR 1 | base=main; includes pgTAP tests |
| 2 | 5 report components + ReportsPage + wiring + tests | PR 2 | base=main; depends on hooks from PR 1 |

### Migration Safety Cross-Check

- `CREATE OR REPLACE VIEW` — idempotent, no data loss
- No column drops or table alters
- Rollback: `DROP VIEW IF EXISTS kpi_mtbf, kpi_mttr, kpi_availability;`

## Phase 1: DB + Dependencies

- [x] 1.1 Create `supabase/migrations/20260608000001_kpi_views.sql` — 3 views (`kpi_mtbf`, `kpi_mttr`, `kpi_availability`) with `SECURITY INVOKER`, filtered `lifecycle_phase IN ('COMP','CLOSED')`, grouped by `asset_id, month`. Accept: queryable via `supabase.from('kpi_mtbf').select().eq('asset_id',...)`.
- [x] 1.2 Add `html2canvas@^1.4.1` + `jspdf@^2.5.2` to `package.json` dependencies. Accept: `npm install` resolves without peer warnings.

## Phase 2: Hooks

- [x] 2.1 Create `src/hooks/useMaintenanceHistory.js` — fetch `work_orders` + `assets` by assetId + dateRange; returns `{ wos, timeline, assetName, loading, error, refetch }`. Accept: 4 states (loading/error/empty/success) per MechanicDashboard pattern.
- [x] 2.2 Create `src/hooks/useKpiMetrics.js` — fetch 3 KPI views, aggregate monthly; returns `{ current, monthly, loading, error, refetch }`. Accept: MTBF days, MTTR hours, Availability % match formulas from spec.
- [x] 2.3 Create `src/hooks/useLaborHoursReport.js` — fetch `labor_records` + `user_profiles`, aggregate client-side by tech×activity_code; returns `{ records, grandTotal, loading, error, refetch }`. Accept: grouped data matches spec contracts.
- [x] 2.4 Create `src/hooks/useReportExport.js` — html2canvas capture each widget ref `{ scale: 2, useCORS: true }`, jsPDF A4 portrait assembly, sequential pages; returns `{ state, progress, error, exportPdf, reset }`. Accept: error placeholder if capture fails (no crash).

## Phase 3: Components

- [x] 3.1 Create `src/components/reports/MaintenanceHistoryReport.jsx` — BarChart (WOs/month) + MUI Table (WO details); `data-widget-id` refs; 4 states. Accept: empty state "No se encontraron órdenes".
- [x] 3.2 Create `src/components/reports/KpiDashboardReport.jsx` — MetricCards + BarChart (MTBF/MTTR) + LineChart (Availability); 4 states. Accept: insufficient-data state "Datos insuficientes".
- [x] 3.3 Create `src/components/reports/LaborHoursReport.jsx` — BarChart (hrs/tech) + grouped MUI Table (tech×activity_code); 4 states. Accept: empty state "No hay registros de labor".
- [x] 3.4 Create `src/components/reports/ReportExportButton.jsx` — opens WidgetSelector modal, triggers `exportPdf`. Accept: button disabled + tooltip when no data.
- [x] 3.5 Create `src/components/reports/WidgetSelector.jsx` — checkbox modal + progress overlay; all-off disables Export. Accept: progress shows "Capturando widget X de Y".

## Phase 4: Page + Wiring

- [x] 4.1 Create `src/pages/ReportsPage.jsx` — report type tabs, filter bar (date range, asset, tech), renders active report + ExportButton; states. Accept: filters reflected in URL via `useSearchParams`.
- [x] 4.2 Create `src/pages/ReportsPage.css` — `@media print` rules (hide chrome, full-width, single column, print-color-adjust). Accept: Ctrl+P shows content-only layout.
- [x] 4.3 Modify `src/App.jsx` — Add Reports tab after Monitoreo de Condición for all roles. Accept: tab visible, switches to ReportsPage.
- [x] 4.4 Modify `src/App.css` — add `.report-widget` print classes. Accept: widgets avoid page breaks in print.

## Phase 5: Tests

- [x] 5.1 Create `supabase/tests/database/kpi_metrics_test.sql` — pgTAP tests verifying KPI views vs known data within 0.001 tolerance. Accept: all tests pass.
- [x] 5.2 Create `src/hooks/__tests__/useMaintenanceHistory.test.js` — 4 states; mock `supabase.from('work_orders')`. Accept: loading/error/empty/success covered.
- [x] 5.3 Create `src/hooks/__tests__/useKpiMetrics.test.js` — 4 states; mock 3 KPI views. Accept: `current` and `monthly` data shapes match spec.
- [x] 5.4 Create `src/hooks/__tests__/useLaborHoursReport.test.js` — 4 states; mock `labor_records` + `user_profiles`. Accept: aggregation matches expected.
- [x] 5.5 Create `src/hooks/__tests__/useReportExport.test.js` — capture→assemble→download; mock html2canvas/jsPDF. Accept: error handling, no-data guard.
- [x] 5.6 Create `src/components/reports/__tests__/MaintenanceHistoryReport.test.jsx` — render w/ mock data, empty state, loading state. Accept: charts + table visible.
- [x] 5.7 Create `src/components/reports/__tests__/KpiDashboardReport.test.jsx` — render w/ mock data, insufficient-data state. Accept: metric cards + charts visible.
- [x] 5.8 Create `src/components/reports/__tests__/LaborHoursReport.test.jsx` — render w/ mock data, empty state. Accept: chart + grouped table visible.
- [x] 5.9 Create `src/components/reports/__tests__/WidgetSelector.test.jsx` — check/uncheck, all-off disabled, progress overlay. Accept: Export disabled when all unchecked.
- [x] 5.10 Create `src/components/reports/__tests__/ReportsPage.test.jsx` — tab switching, filter integration, export trigger. Accept: smoke test for page integrity.
