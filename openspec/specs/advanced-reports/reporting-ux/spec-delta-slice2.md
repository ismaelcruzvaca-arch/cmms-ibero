# Delta for Reporting UX — Slice 2

## ADDED Requirements

### Requirement: 3 New Report Tabs

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

### Requirement: 4-State Pattern

Each new report MUST implement loading (CircularProgress), error (Alert + retry), empty (message), success. Matches Slice 1 behavior.

## MODIFIED Requirements

### Requirement: Report Page Navigation

Now 6 tabs: "Historial de Mantenimiento", "Dashboard KPI", "Horas por Técnico", "Materiales Consumidos", "Compliance", "Checklists con Evidencia".
(Previously: 3)

#### Scenario: 6 tabs render on load

- GIVEN user is logged in → WHEN `/reports` loads → THEN 6 MuiTabs visible, first selected

### Requirement: Filters and Controls

New reports support: date range (all 3), asset (Materials, Compliance), technician (Compliance, Checklists), template (Checklists). Sync to `useSearchParams`.
(Previously: 3 reports with filters)

#### Scenario: Asset scopes Compliance data

- GIVEN no asset filter → WHEN user selects asset → THEN permits/LOTO/certs reload scoped

#### Scenario: Technician scopes Checklists

- GIVEN Checklists tab active → WHEN user selects tech → THEN instances filtered by `technician_id`

## Data Contracts

```
useMaterialsConsumed → { items: ConsumedItem[], partSummary: PartConsumption[], grandTotal: number, loading, error, refetch }
  ConsumedItem: { partNum, description, uom, totalQty, workOrderId, lastTransactionAt }
  PartConsumption: { partNum, description, qty }

useComplianceReport → { expiringPermits: PermitItem[], expiredPermits: PermitItem[], activeLoto: LotoItem[], techCerts: TechCertItem[], loading, error, refetch }
  PermitItem: { id, description, location, permitStatus, expiresAt, requestedByName }
  LotoItem: { id, assetId, lotoStatus, lockedAt, lockedByName }
  TechCertItem: { technicianId, technicianName, moduleCode, currentLevel }

useChecklistEvidence → { instances: ChecklistInstanceSummary[], stats: ChecklistStats, loading, error, refetch }
  ChecklistInstanceSummary: { id, workOrderId, templateCode, technicianName, completedAt, passCount, failCount, naCount, photoUrls[] }
  ChecklistStats: { passRate, failRate, totalInstances }
```

### Export

Reuses `WidgetSelector` + `ReportExportButton` + `useReportExport` from Slice 1 unchanged. Checklist photos render as `<img>` in DOM — html2canvas captures at `scale:2, useCORS:true`.
