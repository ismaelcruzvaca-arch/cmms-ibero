# Proposal: Advanced Reports — Slice 1 (Maintenance History + KPI Dashboard + Labor Hours)

## Intent

Phase 4 targets 6 report types. This first slice delivers the 3 core reports with charts: asset maintenance history (multi-WO timeline), KPI dashboard (MTBF/MTTR/Availability), and labor hours by technician/period. Instead of extending the server-side Edge Function, reports are **client-side React pages** using **Recharts** (already in the project) + **html2canvas + jsPDF** for PDF export, following the industry pattern validated in Limble, UpKeep, and Tractian.

## Background — Industry Research

Major CMMS platforms handle chart reporting differently:

| Product | Approach |
|---------|----------|
| **Limble CMMS** | ✅ **Best pattern**: Dashboard → Download PDF with selectable widgets, print-optimized layout (single column), email as PDF attachment. |
| **Tractian** | ⚠️ Chart-by-chart PNG download + print-to-PDF of pre-defined reports. No report builder. |
| **UpKeep** | ⚠️ Dashboard → ZIP with CSVs. Charts → PNG individual. No PDF of dashboard. |

**Decision for GEMA**: Follow **Limble's pattern** — client-side PDF with selectable widgets/charts, print-optimized layout. This avoids infrastructure complexity (Browserless for charts), leverages existing Recharts, and gives users control over what goes in the report.

## Scope

### In Scope
- New `/reports` page with report type selector + filters (asset, date range, technician)
- **Report: Maintenance History by Asset** — multi-WO timeline with status, dates, labor summary, failure codes
- **Report: KPI Dashboard** — MTBF, MTTR, Availability with Recharts (bar/line) + summary table
- **Report: Labor Hours by Technician/Period** — grouped table with hours per activity code
- **Export to PDF** via html2canvas + jsPDF client-side (no server call for report generation)
  - Print-optimized layout (single column, like Limble)
  - Selectable widgets/charts to include (checkboxes)
- New section in navigation for Reports
- All reports available from the app online (RxDB offline for read-only data)

### Out of Scope
- Checklists with evidence (photos) — deferred to future slice
- Materials consumed by WO — deferred to future slice
- Compliance report (permits, LOTO) — deferred to future slice
- Server-side PDF generation for reports — Browserless.io stays only for existing WO PDF downloads
- Scheduled/delivery of reports — handled by existing scheduled-report-delivery infra
- Cost analysis / unit_cost on spare_parts — requires schema design decision first

## Capabilities

### New Capabilities
- `maintenance-history-report`: Multi-WO timeline for an asset — lists WOs with dates, status, labor, failure codes
- `kpi-dashboard-report`: MTBF, MTTR, Availability with interactive Recharts visualizations
- `labor-hours-report`: Aggregate hours by technician + period with per-activity-code breakdown
- `report-pdf-export`: Client-side PDF generation with selectable widgets, print-optimized layout

### Modified Capabilities
- Navigation — add `/reports` entry in sidebar
- Browser-based print — enhance with report-specific print styles

## Approach

Build reports as React pages. No Edge Function changes needed.

### Architecture
```
/reports page
  ├── ReportSelector (tabs or cards)
  ├── ReportViewer
  │   ├── MaintenanceHistoryReport
  │   │   ├── Recharts timeline (bar chart: WOs per month)
  │   │   └── Detail table (WO list with status, dates, codes)
  │   ├── KpiDashboardReport
  │   │   ├── Recharts bar chart (MTBF/MTTR comparison)
  │   │   ├── Recharts gauge or trend (Availability)
  │   │   └── Summary metrics cards (current MTBF, MTTR, Avail)
  │   └── LaborHoursReport
  │       ├── Recharts bar chart (hours per tech)
  │       └── Detail table (hours by tech + activity code)
  ├── ExportPDFButton
  │   └── WidgetSelector (checkboxes: qué incluir)
  └── DateRangePicker / AssetSelector / TechSelector
```

### Data Flow
```
1. User navigates to /reports, selects report type + filters
2. React fetches data via Supabase client (RLS-enforced)
3. Recharts renders interactive charts in the report view
4. User clicks "Export PDF" → selects widgets to include
5. html2canvas captures selected chart containers (SVG→PNG)
6. jsPDF assembles PDF with print-optimized layout (single column)
7. Browser downloads the PDF (or opens print dialog)
```

### Technical Details
- **html2canvas**: Captures Recharts SVG natively. Use `scale: 2` for print quality. `useCORS: true` if we embed external images.
- **jsPDF**: Creates A4 portrait PDF. Each widget gets its own page or flows sequentially.
- **recharts-to-png** hook: Optional, cleaner API for individual chart captures.
- **Print styles**: `@media print` CSS for browser-native printing as fallback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/pages/ReportsPage.jsx` | **New** | Main reports page with selector + report viewer |
| `src/pages/ReportsPage.css` | **New** | Print-optimized styles, report layout |
| `src/components/reports/MaintenanceHistoryReport.jsx` | **New** | Report component with Recharts + table |
| `src/components/reports/KpiDashboardReport.jsx` | **New** | KPI report with Recharts bar/line charts |
| `src/components/reports/LaborHoursReport.jsx` | **New** | Labor hours report with chart + table |
| `src/components/reports/ReportExportButton.jsx` | **New** | Export button with widget selector |
| `src/components/reports/WidgetSelector.jsx` | **New** | Checkbox list of widgets to include |
| `src/hooks/useReportExport.js` | **New** | Hook: html2canvas capture + jsPDF assembly |
| `src/hooks/useMaintenanceHistory.js` | **New** | Hook: fetch WO data by asset + date range |
| `src/hooks/useKpiMetrics.js` | **New** | Hook: calculate MTBF/MTTR/Availability from DB |
| `src/hooks/useLaborHoursReport.js` | **New** | Hook: aggregate labor_records by tech/period |
| `src/App.jsx` | **Modified** | Add `/reports` route |
| `src/components/layout/Sidebar.jsx` (or eq.) | **Modified** | Add "Reportes" navigation entry |
| `package.json` | **Modified** | Add `html2canvas`, `jspdf` dependencies |
| `supabase/tests/database/kpi_metrics_test.sql` | **New** | pgTAP tests for KPI calculation functions |

## Migration / DB Changes

No schema changes needed — all reports query existing tables:
- `work_orders` + `assets` (maintenance history, KPIs)
- `labor_records` + `user_profiles` (labor hours)

KPI calculations (MTBF, MTTR, Availability) will be implemented as **PostgreSQL views or functions** for consistency and testability, then consumed by the hooks.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| html2canvas canvas size limit on large reports | Low | Paginate PDF: max N widgets per page. Break long tables into chunks. |
| Cross-origin images in charts | Low | All assets same-origin (Supabase Storage public bucket). Use `useCORS: true` as safety net. |
| KPI cost data missing (no unit_cost) | Medium | KPIs in this slice use only time-based metrics (MTBF/MTTR/Avail). Cost KPIs deferred. |
| Print quality of Recharts SVGs | Low | html2canvas `scale: 2` produces print-quality raster. Test on real data. |
| Large labor_records dataset without time index | Med | Verify idx_labor_records_start_time exists before shipping. |
| Reports page performance with many WOs | Low | Server-side pagination on WO query. Lazy chart rendering. |

## Rollback Plan

- **New page rollback**: Remove `/reports` route + sidebar entry — zero impact on existing features
- **npm deps rollback**: `npm uninstall html2canvas jspdf`
- **DB rollback**: Drop KPI views/functions if created
- **Full revert**: Single commit revert

## Dependencies

- `html2canvas` + `jspdf` npm packages (add to `package.json`)
- Existing Recharts library already in `package.json` (`recharts`)
- Supabase client with RLS access to `work_orders`, `labor_records`, `user_profiles`, `assets`
- RxDB collections for offline data (reports read from Supabase directly for freshness)

## Success Criteria

- [ ] `/reports` page loads with 3 report types selectable
- [ ] Maintenance History report shows multi-WO timeline for a selected asset
- [ ] KPI Dashboard renders MTBF/MTTR/Availability charts with real data
- [ ] Labor Hours report shows aggregated hours by technician for a selected period
- [ ] "Export PDF" generates a print-optimized PDF with selected widgets
- [ ] All existing functionality unchanged (regression: WO download, email, scheduled reports)
- [ ] KPI calculations match verified manual computation on test data
