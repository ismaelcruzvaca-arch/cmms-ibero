## Verification Report

**Change**: advanced-reports-slice1
**Version**: N/A
**Mode**: Standard

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Build**: ✅ Passed
```text
npm test — all 25 test files passed, 228 tests passed
```

**Tests**: ✅ 228 passed / ❌ 0 failed / ⚠️ 0 skipped
```text
Test Files  25 passed (25)
Tests       228 passed (228)
```

**Coverage**: ➖ Not available (no coverage threshold configured)

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Report Page Navigation | Navigate to Reports | `ReportsPage.test.jsx > renderiza los tabs` | ✅ COMPLIANT |
| Report Page Navigation | Report type selected | `ReportsPage.test.jsx > renderiza los tabs` | ✅ COMPLIANT |
| Filters and Controls | Asset filter changes report data | (no direct test — covered via hook tests) | ✅ PARTIAL |
| Filters and Controls | Date range filter | `ReportsPage.test.jsx > muestra filtros de fecha` | ✅ COMPLIANT |
| Maintenance History | Renders with data | `MaintenanceHistoryReport.test.jsx > renderiza chart y tabla` | ✅ COMPLIANT |
| Maintenance History | No data | `MaintenanceHistoryReport.test.jsx > mensaje vacío` | ✅ COMPLIANT |
| Maintenance History | Asset filter empty | (UI shows empty state — tested) | ✅ COMPLIANT |
| KPI Dashboard | Renders with data | `KpiDashboardReport.test.jsx > renderiza metric cards y charts` | ✅ COMPLIANT |
| KPI Dashboard | Insufficient data | `KpiDashboardReport.test.jsx > datos insuficientes` | ✅ COMPLIANT |
| Labor Hours | Renders with data | `LaborHoursReport.test.jsx > renderiza chart y tabla` | ✅ COMPLIANT |
| Labor Hours | No records | `LaborHoursReport.test.jsx > mensaje vacío` | ✅ COMPLIANT |
| PDF Export | Export with all widgets | `useReportExport.test.jsx > captura widgets, ensambla PDF` | ✅ COMPLIANT |
| PDF Export | Export with selected widgets | `useReportExport.test.jsx > solo captura seleccionados` | ✅ COMPLIANT |
| PDF Export | Export with no data | `ReportExportButton > disabled tooltip` | ✅ PARTIAL |
| PDF Export | Export error handling | `useReportExport.test.jsx > maneja error con placeholder` | ✅ COMPLIANT |
| Print Styles | Browser print | `ReportsPage.css — @media print rules present` | ✅ COMPLIANT |
| UI States | Loading | Each component test verifies spinner | ✅ COMPLIANT |
| UI States | Error | Each component test verifies Alert + Reintentar | ✅ COMPLIANT |
| UI States | 4 states per component | All hooks and components tested for 4 states | ✅ COMPLIANT |
| KPI Formulas | MTBF formula | `kpi_metrics_test.sql — within() assertion` | ❌ FAILING |
| KPI Formulas | MTTR formula | `kpi_metrics_test.sql — within() assertion` | ❌ FAILING |
| KPI Formulas | Availability formula | `kpi_metrics_test.sql — within() assertion` | ❌ FAILING |
| Dependencies | html2canvas + jspdf | `package.json` has both | ✅ COMPLIANT |
| Navigation Modified | Reportes tab visible | `App.jsx` has `<Tab label="Reportes" />` | ✅ COMPLIANT |

**Compliance summary**: 21/24 scenarios compliant (3 KPI formula scenarios have formula deviation, handled below)

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| DB migration: 5 views | ✅ Implemented | 3 KPI views + 2 report views created |
| html2canvas + jspdf in package.json | ✅ Implemented | `^1.4.1` and `^2.5.2` present |
| useMaintenanceHistory hook | ⚠️ Partial | Exists with 4 states BUT queries `assets(name)` — column doesn't exist |
| useKpiMetrics hook | ❌ Broken | Queries KPI views for `month` column that doesn't exist; references `mtbf_days` but column is `mtbf_hours` |
| useLaborHoursReport hook | ⚠️ Partial | Exists with 4 states BUT queries `user_profiles(name)` — column is `full_name` |
| useReportExport hook | ✅ Implemented | Full capture→assemble→download flow with error placeholders |
| MaintenanceHistoryReport component | ✅ Implemented | BarChart + Table, all 4 states, data-widget-id |
| KpiDashboardReport component | ✅ Implemented | MetricCards + BarChart + LineChart, all 4 states |
| LaborHoursReport component | ✅ Implemented | BarChart + grouped Table, all 4 states |
| ReportExportButton | ✅ Implemented | Opens WidgetSelector, disabled tooltip when no data |
| WidgetSelector | ✅ Implemented | Checkbox modal, progress overlay, all-off disables Export |
| ReportsPage | ⚠️ Partial | Tabs + filters + export, BUT widget refs never populate |
| ReportsPage.css | ✅ Implemented | `@media print` rules with hide-chrome, full-width, single-column |
| App.jsx Reports tab | ✅ Implemented | Tab after Monitoreo de Condición, lazy-loaded |
| App.css .report-widget | ✅ Implemented | Print break-inside rules |
| Hook tests (4) | ✅ Implemented | 4 states + refetch, mock supabase |
| Component tests (4) | ✅ Implemented | Loading/error/empty/success, Mock Recharts |
| WidgetSelector test | ✅ Implemented | Check/uncheck, all-off disabled, progress overlay |
| ReportsPage test | ✅ Implemented | Tab switching, filter integration, smoke test |
| DB pgTAP tests | ✅ Implemented | 19 assertions across 5 groups |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Tab-based nav (no React Router) | ✅ Yes | Reports tab in App.jsx, reportSubTab pattern |
| PostgreSQL views for KPI | ⚠️ Partial | 3 KPI views created but WITHOUT `month` grouping specified in design |
| Security invoker on views | ✅ Yes | All 5 views use `WITH (security_invoker = true)` |
| Per-widget html2canvas | ⚠️ Partial | Uses refs but refs never populate — widget selection broken |
| Scale 2 for print quality | ✅ Yes | `scale: 2` in html2canvas call |
| 4 states per component | ✅ Yes | All components implement loading/error/empty/success |
| Filters in URL via useSearchParams | ✅ Yes | `useUrlParams` hook, all filters reflect in URL |
| KPI formulas via views | ❌ No | Formulas deviate from spec (MTTR uses wrong columns, no monthly grouping) |
| Use existing tables | ✅ Yes | Queries work_orders, labor_records, assets, user_profiles |

### Issues Found

**CRITICAL**:

1. **useMaintenanceHistory — `assets(name)` column does not exist** — The `assets` table has `description` and `equipment_id` but no `name` column. Supabase PostgREST will return a 400 error for `.select('*, assets(name)')`. The hook will always fail at runtime when data exists.
   - File: `src/hooks/useMaintenanceHistory.js`, line 37
   - Fix: Change to `.select('*, assets(description)')` and read `items[0].assets?.description`

2. **useLaborHoursReport — `user_profiles(name)` column does not exist** — The `user_profiles` table has `full_name` (not `name`). PostgREST will return a 400 error for `.select('*, user_profiles(name)')`. The hook will always fail at runtime.
   - File: `src/hooks/useLaborHoursReport.js`, line 36
   - Fix: Change to `.select('*, user_profiles(full_name)')` and read `lr.user_profiles?.full_name`

3. **useKpiMetrics — KPI views have no `month` column** — `kpi_mtbf`, `kpi_mttr`, `kpi_availability` only GROUP BY `asset_id`, not by month. The hook queries `.order('month')`, `.gte('month', ...)`, `.lte('month', ...)` and merges data by `r.month`. All these operations will fail at runtime because the column doesn't exist in the views.
   - File: `src/hooks/useKpiMetrics.js`, lines 42-81
   - Fix: Rebuild KPI views with monthly grouping, adding `DATE_TRUNC('month', completed_at)::date AS month` and `GROUP BY asset_id, month`

4. **useKpiMetrics — references `mtbf_days` but view column is `mtbf_hours`** — The hook reads `r.mtbf_days` at line 77 but the `kpi_mtbf` view returns `mtbf_hours`. All MTBF values will be `null` at runtime. Additionally, the design specified MTBF in days (÷86400) but the view computes it in hours (÷3600).
   - Files: `src/hooks/useKpiMetrics.js:77`, `supabase/migrations/20260608000001_kpi_views.sql:25`
   - Fix: Either rename the view column to `mtbf_days` and divide by 86400, or update the hook to read `mtbf_hours`

5. **MTTR formula deviation from spec** — The `kpi_mttr` view computes `AVG(completed_at - actual_start_at)` which measures "repair duration" (time from actual start to completion). The spec requires `AVG(machine_up_at - machine_down_at)` which measures "downtime duration" (time machine was down). These measure different things and will produce different values.
   - File: `supabase/migrations/20260608000001_kpi_views.sql`, line 49
   - Fix: Change to `AVG(EXTRACT(EPOCH FROM (machine_up_at - machine_down_at)) / 3600)` per spec

6. **Availability formula deviation from spec** — The `kpi_availability` view computes `MTBF/(MTBF+MTTR)*100` which is a valid Availability formula but NOT the one specified. The spec requires `(Uptime / (Uptime + Downtime)) × 100` where downtime is `SUM(machine_up_at - machine_down_at)` and uptime is `period_total - downtime`. These produce different results when applied to the same dataset because the view chains two views with different filtering criteria.
   - File: `supabase/migrations/20260608000001_kpi_views.sql`, line 75
   - Fix: Rebuild availability view using direct computation from work_orders with the spec formula

**WARNING**:

1. **Widget refs never populate** — `widgetRefs` in `ReportsPage.jsx` uses `useMemo` with `[reportType]` dependency and checks `ref.current`. Since ref changes don't trigger re-render and useMemo deps don't include ref state, the refs always evaluate as null. The export widget selector will always show 0 widgets available. Export still works as a no-op but widget selection is non-functional.
   - File: `src/pages/ReportsPage.jsx`, lines 87-104
   - Fix: Use callback refs or a state-driven approach to track mounted widgets

2. **Only one widget ref per report** — Each report type is wrapped in a single `<Box ref={...}>` instead of per-widget refs. The inner `data-widget-id` attributes (e.g., `kpi-bar-chart`, `kpi-line-chart`) aren't individually accessible for export. The `data-widget-id` attributes exist in child components but the parent doesn't surface them as separate exportable widgets.
   - File: `src/pages/ReportsPage.jsx`, `renderReport()` at lines 126-160
   - Fix: Surface each child widget with its own ref

3. **kpi_mtbf uses wo_type filter instead of lifecycle_phase** — The design specifies filtering by `lifecycle_phase IN ('COMP','CLOSED')` but the view filters by `wo_type IN ('CM', 'EM')`. This changes which WOs contribute to MTBF.
   - File: `supabase/migrations/20260608000001_kpi_views.sql`, line 27
   - Fix: Align with design or document the decision

4. **kpi_mttr has no wo_type filter** — Unlike kpi_mtbf which filters by wo_type, kpi_mttr only filters by lifecycle_phase but accepts all wo_types including PMs and other planned work. This is inconsistent between the two views and may inflate MTTR values with planned maintenance durations.
   - File: `supabase/migrations/20260608000001_kpi_views.sql`, line 51

5. **Missing column mapping inconsistency** — The `report_maintenance_history` view correctly uses `a.description AS asset_description` and `a.equipment_id`, confirming the assets table has no `name` column. The `report_labor_hours` view correctly uses `up.full_name AS technician_name`, confirming user_profiles uses `full_name`. The hooks should align with these views or the correct column names.

**SUGGESTION**:

1. **Extra views created** — The migration creates 5 views (kpi_mtbf, kpi_mttr, kpi_availability, report_maintenance_history, report_labor_hours) instead of the spec'd 3. The extra 2 views (`report_maintenance_history`, `report_labor_hours`) are unused by the hooks but are available for future use.

2. **Consider using the report views** — Instead of joining work_orders→assets and labor_records→user_profiles in hooks, consider querying the `report_maintenance_history` and `report_labor_hours` views directly. This would centralize the join logic and avoid the column name mismatch issues.

3. **Month filter on KPI views** — Even if the views don't group by month, they could accept a date range filter if implemented as parameterized functions instead of views. Consider switching to `supabase.rpc()` for filtered KPI queries.

4. **Test coverage gap** — All vitest tests mock Supabase responses, so they don't catch the column mismatch issues. Consider integration tests against a real Supabase instance or stricter type validation.

### Verdict

**FAIL** — 6 CRITICAL issues found

The implementation structure is solid (components, hooks, page wiring, CSS, tests) but the CRITICAL issues involve runtime-breaking column name mismatches in 3 hooks and fundamental formula deviations in all 3 KPI views. Without fixing these, the reports page will fail at runtime when connected to real data:

- `useMaintenanceHistory` and `useLaborHoursReport` will throw PostgREST 400 errors on column lookups
- `useKpiMetrics` will fail when ordering/filtering by non-existent `month` column
- KPI calculations will produce wrong values due to formula deviations

The component tests all pass because they mock the data layer, which masks these underlying data contract mismatches.
