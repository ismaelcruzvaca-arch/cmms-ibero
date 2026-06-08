# Design: Advanced Reports — Slice 1

## Technical Approach

Three client-side report types via a new tab in `App.jsx`. Supabase REST (not RxDB) for data freshness. Recharts renders SVG charts. html2canvas + jsPDF produce A4 PDFs per-widget. KPI calculations in PostgreSQL views queryable via `supabase.from(...)`.

## Architecture Decisions

**Tab-based nav (no React Router)** — App.jsx already uses tab-based navigation with sub-tabs (Condition Monitoring, Admin). The Reports tab follows the same pattern: `activeTab` for top-level, `reportSubTab` for report type selection. Zero infra cost, no router needed.

**PostgreSQL views for KPI** — Views allow standard PostgREST chaining (`.eq()`, `.gte()`) unlike RPCs. Three views: `kpi_mtbf`, `kpi_mttr`, `kpi_availability`, all `SECURITY INVOKER` so RLS on `work_orders` applies.

**Per-widget html2canvas** — Each chart/table captured independently via `ref`, matching Limble's pattern. Users select widgets via checkboxes. Scale 2 for print quality. jsPDF assembles sequentially in A4 portrait.

## Data Flow

```
ReportsPage → reportSubTab → ReportTypeSelector
  └─ Filters (date range, asset, tech) → hook params
  └─ Active report renders:
       useMaintenanceHistory(assetId, start, end)
         → supabase.from('work_orders').select('...').eq('asset_id', id)
         → BarChart(WOs/month) + Table(WO details)
       useKpiMetrics(assetId, start, end)
         → 3× supabase.from('kpi_mtbf/mttr/availability').select()
         → MetricCards + BarChart + LineChart
       useLaborHoursReport(techId, start, end)
         → supabase.from('labor_records').select('..., user_profiles(name)')
         → aggregate client-side by tech × activity_code
         → BarChart(hrs/tech) + grouped Table
  └─ ReportExportButton → WidgetSelector modal
       → useReportExport(widgetRefs)
       → html2canvas each ref → jsPDF → download
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/pages/ReportsPage.jsx` | Create | Report type tabs + filter bar + export |
| `src/pages/ReportsPage.css` | Create | `@media print` rules, layout |
| `src/components/reports/MaintenanceHistoryReport.jsx` | Create | BarChart + MUI Table; widget refs |
| `src/components/reports/KpiDashboardReport.jsx` | Create | MetricCards + BarChart + LineChart |
| `src/components/reports/LaborHoursReport.jsx` | Create | BarChart + grouped MUI Table |
| `src/components/reports/ReportExportButton.jsx` | Create | Triggers widget selector + export |
| `src/components/reports/WidgetSelector.jsx` | Create | Checkbox modal + progress overlay |
| `src/hooks/useMaintenanceHistory.js` | Create | Fetch `work_orders` + `assets` |
| `src/hooks/useKpiMetrics.js` | Create | Fetch 3 KPI views, aggregate monthly |
| `src/hooks/useLaborHoursReport.js` | Create | Fetch + client-side aggregate |
| `src/hooks/useReportExport.js` | Create | Capture loop + PDF assembly |
| `src/App.jsx` | Modify | Add Reports tab after Monitoreo |
| `src/App.css` | Modify | `.report-widget` print classes |
| `package.json` | Modify | `html2canvas@^1.4.1`, `jspdf@^2.5.2` |
| `supabase/migrations/*kpi_views.sql` | Create | 3 KPI views + pgTAP tests |

## Interfaces / Contracts

**PostgreSQL KPI views** — All filtered to `lifecycle_phase IN ('COMP','CLOSED')` with non-null timestamps, grouped by `asset_id, month`:

- `kpi_mtbf`: `SUM(machine_up_at - machine_down_at) / COUNT(*) → mtbf_days` (÷86400)
- `kpi_mttr`: `AVG(EPOCH(machine_up_at - machine_down_at)/3600) → mttr_hours`
- `kpi_availability`: `(1 - downtime_hours / period_hours) × 100`, clamped ≥ 0

**Hook contracts** — All return `{ data, loading, error, refetch }`. Data shapes match `openspec/specs/advanced-reports/reporting-ux/spec.md` (MaintenanceHistoryParams, KpiMetrics, TechHours, ExportConfig). Widget refs use `data-widget-id` attributes + `React.forwardRef`.

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | 4 hooks × 4 states (loading/error/empty/success) | Vitest + mock supabase |
| Unit | 3 report components (render w/ mock data) | Vitest + @testing-library, mock hooks |
| Unit | useReportExport (capture→assemble→download) | Mock html2canvas/jsPDF |
| Unit | WidgetSelector (check/uncheck, all-off disabled) | Vitest |
| DB | 3 KPI views vs known data | pgTAP in `supabase/tests/database/kpi_metrics_test.sql` |
| E2E | Navigate reports, filter, export PDF | Playwright — verify DOM on data states |

## Migration / Rollout

DB migration creates 3 views idempotently (`CREATE OR REPLACE VIEW`). No data migration. Rollback: drop views + revert files.

## Open Questions

- [ ] Labor Hours aggregation: doing it client-side in the hook avoids a view. Is dataset size small enough? (Yes — filtered by date range + optional tech)
- [ ] Confirm html2canvas handles MUI Emotion fonts at scale 2 without canvas taint
