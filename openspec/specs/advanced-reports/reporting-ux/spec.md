# Reporting UX Specification

## Purpose

Deliver 3 interactive report types (Maintenance History by Asset, KPI Dashboard, Labor Hours by Technician) via a new client-side `/reports` page using React + Recharts for rendering and html2canvas + jsPDF for PDF export. All reports read from Supabase directly (not RxDB) for data freshness, with PostgreSQL views/functions for KPI calculations.

## Requirements

### Requirement: Report Page Navigation

The system MUST provide a `/reports` page accessible from the main navigation with a tab-based report type selector showing the 6 report types (3 from Slice 1, 3 added in Slice 2).

#### Scenario: Navigate to Reports

- GIVEN the user is logged in with any role
- WHEN they click "Reportes" in the sidebar/navigation
- THEN the reports page loads with 6 selectable tabs: "Historial de Mantenimiento", "Dashboard KPI", "Horas por Técnico", "Materiales Consumidos", "Compliance", "Checklists con Evidencia"

#### Scenario: Report type is selected

- GIVEN the reports page is loaded
- WHEN the user clicks a report type card
- THEN the corresponding report component renders with its default filters (current month, all assets)

### Requirement: Filters and Controls

Each report MUST provide relevant filters: asset selector (for Maintenance History, KPI Dashboard, Materials, Compliance), date range picker (for all reports), technician selector (for Labor Hours, Compliance, Checklists), part number text field (for Materials), and template dropdown (for Checklists). Filters MUST be reflected in the URL query parameters via `useSearchParams`.

#### Scenario: Asset filter changes report data

- GIVEN the user is viewing Maintenance History with an empty asset filter
- WHEN they select a specific asset from the asset dropdown
- THEN the report data reloads for that asset only

#### Scenario: Date range filter

- GIVEN the user is viewing any report
- WHEN they change the date range picker to a custom range
- THEN the report data requeries with the new date boundaries

### Requirement: Maintenance History Report

The system MUST render a multi-WO timeline for a selected asset showing a bar chart (WOs per month) and a detail table with columns: WO ID, status, planned dates, actual dates, failure codes (problem_code, cause_code, remedy_code), and labor summary (actual_hours).

#### Scenario: Maintenance History renders with data

- GIVEN an asset with completed work orders in the selected date range
- WHEN the Maintenance History report loads
- THEN a bar chart shows WO count per month AND a detail table lists each WO with status, dates, failure codes, and hours

#### Scenario: Maintenance History with no data

- GIVEN an asset with NO work orders in the selected date range
- WHEN the report loads
- THEN an empty state message is shown: "No se encontraron órdenes para este activo en el período seleccionado"

#### Scenario: Maintenance History with asset filter empty

- GIVEN the user has not selected any asset
- WHEN viewing Maintenance History
- THEN the asset selector shows a prompt "Seleccioná un activo" and the chart/table show empty placeholder

### Requirement: KPI Dashboard Report

The system MUST calculate and render MTBF (Mean Time Between Failures), MTTR (Mean Time To Repair), and Availability using PostgreSQL views/functions. Display MUST include summary metric cards (current MTBF in days, MTTR in hours, Availability %) and Recharts visualizations (bar chart comparing MTBF/MTTR by month, line chart for Availability trend).

#### Scenario: KPI Dashboard renders with data

- GIVEN work_orders exist with completed_at, machine_down_at, and machine_up_at in the selected period
- WHEN the KPI Dashboard loads
- THEN summary cards show numeric values AND bar chart shows monthly comparison AND line chart shows availability trend

#### Scenario: KPI Dashboard with insufficient data

- GIVEN fewer than 2 completed work orders exist in the selected period
- WHEN the KPI Dashboard loads
- THEN the report shows "Datos insuficientes para calcular KPI" with metrics showing "--" instead of values

### Requirement: Labor Hours Report

The system MUST aggregate labor_records by technician and activity_code for a selected period, showing total hours per technician with per-activity-code breakdown in a grouped table and a bar chart (hours per technician).

#### Scenario: Labor Hours renders with data

- GIVEN labor_records exist in the selected date range
- WHEN the Labor Hours report loads
- THEN a bar chart shows total hours per technician AND a grouped table shows each technician's hours broken down by activity_code with row totals

#### Scenario: Labor Hours with no records

- GIVEN NO labor_records exist in the selected date range
- WHEN the report loads
- THEN an empty state message is shown: "No hay registros de labor en el período seleccionado"

### Requirement: PDF Export

The system MUST allow users to export the current report as a PDF via a "Exportar PDF" button. Before export, the system SHALL display a widget selector where the user chooses which report sections to include.

#### Scenario: Export PDF with all widgets

- GIVEN the user is viewing any report with data
- WHEN they click "Exportar PDF"
- THEN the widget selector modal opens with all sections checked by default
- WHEN they click "Exportar"
- THEN html2canvas captures each selected section at scale 2 into PNG
- AND jsPDF assembles an A4 portrait PDF with each section on a new page (or sequential flow)
- AND the browser downloads the generated PDF

#### Scenario: Export PDF with selected widgets only

- GIVEN the widget selector is open
- WHEN the user unchecks 1 or more widgets and clicks "Exportar"
- THEN only the checked sections are captured and included in the PDF

#### Scenario: Export PDF with no data

- GIVEN the current report has no data (empty state shown)
- WHEN the user clicks "Exportar PDF"
- THEN the button is disabled and tooltip says "No hay datos para exportar"

#### Scenario: Export error handling

- GIVEN html2canvas fails to capture a section (e.g., cross-origin taint)
- WHEN export runs
- THEN jsPDF adds a placeholder page with error message "Error al capturar el gráfico"
- AND no crash/blank PDF is produced

### Requirement: Print Styles

The system SHOULD provide `@media print` CSS that hides navigation, filters, and buttons, and shows the report content in a print-optimized single-column layout.

#### Scenario: Browser print renders report content only

- GIVEN the user is viewing a report
- WHEN they press Ctrl+P (browser print)
- THEN navigation, sidebar, filter controls, and export button are hidden
- AND the report sections render in a single column with adequate margins for printing

### Requirement: UI States

Each report component MUST handle 4 states: loading, empty (no data), error (fetch failure), and success (data rendered).

#### Scenario: Loading state

- GIVEN a report is fetching data from Supabase
- WHEN the query is in progress
- THEN a centered CircularProgress spinner is shown with text "Cargando informe…"

#### Scenario: Error state

- GIVEN the Supabase query fails (network error, RLS rejection, or unexpected data)
- WHEN the error is caught
- THEN an MUI Alert with severity="error" shows the error message AND a "Reintentar" button is available to retry the query

### Requirement: KPI Formulas — MTBF, MTTR, Availability

KPI calculations MUST be implemented as PostgreSQL views or functions and MUST use these exact formulas:

| KPI | Formula | Source Columns |
|-----|---------|----------------|
| **MTBF** (days) | `SUM(machine_up_at - machine_down_at) / COUNT(WO where machine_down_at IS NOT NULL)` — total uptime divided by number of failure events | `machine_down_at`, `machine_up_at`, `completed_at` on `work_orders` |
| **MTTR** (hours) | `AVG(EXTRACT(EPOCH FROM (machine_up_at - machine_down_at)) / 3600)` — average downtime duration in hours | `machine_down_at`, `machine_up_at` |
| **Availability** (%) | `(SUM(uptime) / (SUM(uptime) + SUM(downtime))) * 100` where uptime = period total - downtime, downtime = SUM(machine_up_at - machine_down_at) per period | `machine_down_at`, `machine_up_at`, filtered by `lifecycle_phase IN ('COMP', 'CLOSED')` |
| **WO count** | `COUNT(*)` filtered by asset and date range | `completed_at`, `asset_id` |

#### Scenario: KPI calculation matches manual computation

- GIVEN known work_order data with recorded machine_down_at and machine_up_at
- WHEN the PostgreSQL KPI view/function runs
- THEN the returned MTBF, MTTR, and Availability values MUST match the formulas above within 0.001 tolerance

#### Scenario: Filtered KPI by asset

- GIVEN work_orders for multiple assets
- WHEN the user selects a specific asset in the KPI Dashboard
- THEN the KPI calculations scope to that asset's work_orders only

### Requirement: Navigation Modified

The system MUST add a "Reportes" entry to the application navigation.

#### Scenario: Reportes tab visible

- GIVEN the user is logged in with any role
- WHEN they view the main navigation tabs
- THEN a "Reportes" tab is present after "Monitoreo de Condición"

### Requirement: Dependencies (package.json)

The system MUST add `html2canvas` and `jspdf` as runtime dependencies in `package.json`.

#### Scenario: New dependencies installable

- GIVEN the project is in its root directory
- WHEN `npm install` runs
- THEN `html2canvas` and `jspdf` resolve from `node_modules` without peer-dependency warnings

### Requirement: 3 New Report Tabs (Slice 2)

The system MUST add 3 new report tabs to `/reports`, reusing the existing tab infrastructure, filter bar, export button, and 4-state pattern established in Slice 1.

| Report | Data Sources | Aggregation | Filters | Visuals |
|--------|-------------|-------------|---------|---------|
| **Materiales Consumidos** | `inventory_transactions` (`ISSUE`/`DIRECT_ISSUE`) JOIN `spare_parts` (`part_num`), `work_orders` (`id`) | SUM(qty) by part/WO | date, asset, part | Recharts bar + MUI table |
| **Compliance** | `work_permits`, `lockout_tagout`, `technician_skills` JOIN `technological_modules` + `user_profiles` | Count by status/level, expiry window (default 7d) | date, asset, tech | MetricCards + 3 tables |
| **Checklists con Evidencia** | `checklist_instances` (`COMPLETED`) JOIN `checklist_item_responses`, `checklist_templates`, `user_profiles` | PASS/FAIL/NA count per instance | date, tech, template | MetricCards + table + `<img>` gallery |

#### Scenario: Materials — data

- GIVEN ISSUE/DIRECT_ISSUE transactions exist in range → THEN bar chart by part + table (part, desc, qty, WO, created_at)

#### Scenario: Compliance — mixed data

- GIVEN expiring/expired permits + active LOTO + level>1 certs → THEN MetricCards + 3 tables

#### Scenario: Checklists — with photos

- GIVEN completed instances with photo_url responses → THEN PASS/FAIL rate + table + `<img>` gallery

#### Scenario: Empty — no data for period

- GIVEN zero rows match filters → THEN contextual empty message per report

#### Scenario: Query error

- GIVEN query fails → THEN MUI Alert error + Reintentar
- Compliance: one failing sub-query does NOT block other sections

#### Scenario: Photo failure in PDF

- GIVEN cross-origin photo fails in html2canvas → THEN "Foto no disponible" fallback, PDF export continues without crash

## Data Contracts

### useMaintenanceHistory

```typescript
interface MaintenanceHistoryParams {
  assetId: string | null;
  startDate: string;  // ISO 8601
  endDate: string;    // ISO 8601
}

interface WOItem {
  id: string;
  woType: string;
  lifecyclePhase: string;
  description: string | null;
  reportedAt: string | null;
  approvedAt: string | null;
  plannedStartAt: string | null;
  actualStartAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  problemCode: string | null;
  causeCode: string | null;
  remedyCode: string | null;
  actualHours: number;
  failureClass: string | null;
  criticality: string | null;
}

interface MonthlyTimeline {
  month: string;   // "2026-01"
  count: number;
  woType: string;
}

type UseMaintenanceHistoryReturn = {
  wos: WOItem[];
  timeline: MonthlyTimeline[];
  assetName: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### useKpiMetrics

```typescript
interface KpiParams {
  assetId: string | null;
  startDate: string;
  endDate: string;
}

interface KpiMetrics {
  mtbfDays: number | null;
  mttrHours: number | null;
  availabilityPct: number | null;
  totalWos: number;
}

interface MonthlyKpi {
  month: string;
  mtbfDays: number | null;
  mttrHours: number | null;
  availabilityPct: number | null;
  woCount: number;
}

type UseKpiMetricsReturn = {
  current: KpiMetrics;
  monthly: MonthlyKpi[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### useLaborHoursReport

```typescript
interface LaborHoursParams {
  techId: string | null;    // null = all technicians
  startDate: string;
  endDate: string;
}

interface TechHours {
  technicianId: string;
  technicianName: string;
  activityBreakdown: Record<string, number>;  // activity_code → hours
  totalHours: number;
}

type UseLaborHoursReportReturn = {
  records: TechHours[];
  grandTotal: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### useReportExport

```typescript
interface WidgetDef {
  id: string;
  label: string;
  ref: React.RefObject<HTMLDivElement>;
  selected: boolean;
}

interface ExportConfig {
  widgets: WidgetDef[];
  filename?: string;  // default "{report-type}-{date}.pdf"
}

type ExportState = 'idle' | 'capturing' | 'assembling' | 'done' | 'error';

type UseReportExportReturn = {
  state: ExportState;
  progress: number;      // 0–100
  error: string | null;
  exportPdf: (config: ExportConfig) => Promise<void>;
  reset: () => void;
};
```

### useMaterialsConsumed

```typescript
interface MaterialsConsumedParams {
  assetId: string | null;
  startDate: string;
  endDate: string;
  partNum: string | null;
}

interface ConsumedItem {
  partNum: string;
  description: string | null;
  uom: string | null;
  totalQty: number;
  workOrderId: string | null;
  woDescription: string | null;
  lastTransactionAt: string;
}

type UseMaterialsConsumedReturn = {
  records: ConsumedItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### useComplianceReport

```typescript
interface ComplianceParams {
  assetId: string | null;
  startDate: string;
  endDate: string;
  techId: string | null;
}

interface PermitItem {
  id: string;
  description: string | null;
  location: string | null;
  permitStatus: string;
  expiresAt: string;
  requestedByName: string | null;
}

interface LotoItem {
  id: string;
  assetId: string | null;
  lotoStatus: string;
  lockedAt: string;
  lockedByName: string | null;
}

interface TechCertItem {
  technicianId: string;
  technicianName: string;
  moduleCode: string;
  currentLevel: number;
}

type UseComplianceReportReturn = {
  permits: { expiring: PermitItem[]; expired: PermitItem[] };
  lotoRecords: LotoItem[];
  certs: TechCertItem[];
  sectionErrors: Record<string, string | null>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

### useChecklistEvidence

```typescript
interface ChecklistEvidenceParams {
  startDate: string;
  endDate: string;
  techId: string | null;
  templateId: string | null;
}

interface ChecklistInstanceSummary {
  id: string;
  workOrderId: string | null;
  templateCode: string;
  technicianName: string | null;
  completedAt: string;
  passCount: number;
  failCount: number;
  naCount: number;
  photoUrls: string[];
}

interface ChecklistStats {
  passRate: number;
  failRate: number;
  totalInstances: number;
}

type UseChecklistEvidenceReturn = {
  instances: ChecklistInstanceSummary[];
  summary: ChecklistStats;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};
```

## Export Behavior

### html2canvas Capture Strategy

1. For each selected widget, call `html2canvas(widgetRef.current, { scale: 2, useCORS: true, logging: false })`
2. Capture each widget INDIVIDUALLY (not the full page) for clean per-section rendering
3. Scale 2 produces print-quality raster from Recharts SVGs
4. `useCORS: true` handles same-origin images in asset thumbnails
5. Convert each canvas to PNG via `canvas.toDataURL('image/png')`

### jsPDF Layout

1. Initialize `new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })`
2. For each captured PNG:
   - Calculate proportional width to fit A4 (190mm max width)
   - If remaining vertical space < image height, add new page
   - Insert image centered with margins
3. Add page footers with report title and date (`setFontSize(8)`)
4. Save via `pdf.save(filename)` which triggers browser download

### Widget Selection Flow

1. User clicks "Exportar PDF"
2. WidgetSelector dialog opens with checkboxes for each report section (e.g., "Gráfico de barras", "Tabla de detalle", "Tarjetas de métricas")
3. "Exportar" button is disabled if all widgets are unchecked
4. On confirm, show progress overlay ("Capturando widget X de Y…")
5. On success, auto-download the PDF
6. On error, show inline error with "Reintentar" option

## Print Styles

The system SHOULD include a `ReportsPage.css` file with these `@media print` rules:

```css
@media print {
  /* Hide chrome */
  .MuiAppBar-root, .MuiTabs-root, nav, button, .MuiToggleButtonGroup-root {
    display: none !important;
  }

  /* Report container full width */
  .report-container {
    width: 100% !important;
    margin: 0 !important;
    padding: 10mm !important;
  }

  /* Single column layout */
  .report-widget {
    page-break-inside: avoid;
    break-inside: avoid;
    margin-bottom: 8mm;
  }

  /* No background colors for charts */
  .recharts-surface {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  /* Hide spinner/states */
  .MuiCircularProgress-root, .empty-state-icon {
    display: none !important;
  }
}
```

## KPI Formulas — Detailed Definitions

### MTBF (Mean Time Between Failures)

```
MTBF (days) = Σ(machine_up_at - machine_down_at) / COUNT(work_order)
```

- Numerator: Sum of uptime durations (machine_up minus machine_down) for all WOs with recorded timestamps
- Denominator: Count of WOs with `machine_down_at IS NOT NULL` AND `completed_at` in the selected period
- NULL values in either timestamp cause that WO to be excluded from calculation
- Return NULL if denominator is 0 (no failure events)

### MTTR (Mean Time To Repair)

```
MTTR (hours) = AVG(EXTRACT(EPOCH FROM (machine_up_at - machine_down_at)) / 3600)
```

- Each WO's downtime = machine_up_at - machine_down_at, converted to hours
- NULL values excluded
- Return NULL if no valid downtimes

### Availability

```
Availability (%) = (Uptime / (Uptime + Downtime)) × 100
```

- `Downtime = Σ(machine_up_at - machine_down_at)` for WOs in period
- `Uptime = (end_date - start_date) - Downtime` (period total minus downtime)
- Period total: full selected date range in hours/days (same unit as downtime)
- If downtime > uptime → clamp Availability to 0%
- Return NULL if no downtime recorded (hundred-percent availability)
