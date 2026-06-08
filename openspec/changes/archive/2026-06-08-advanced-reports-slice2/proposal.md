# Proposal: Advanced Reports — Slice 2 (Materials, Compliance & Checklists)

## Intent

Complete Phase 4 of the PDF Engine by adding 3 remaining report types to `/reports`: consumed materials, compliance (permits/LOTO/certs), and checklists with photo evidence. Reuses the existing tab-based page, export infra (html2canvas + jsPDF), and 4-state hook pattern from Slice 1.

## Scope

### In Scope
- **Report: Materiales Consumidos** — `inventory_transactions` joined to `spare_parts` + `work_orders`, grouped by WO or period, with table + bar chart
- **Report: Compliance** — 3 sub-sections: expiring/expired work permits, active LOTO status, technician certifications & competency levels
- **Report: Checklists con Evidencia** — completed checklist instances with item PASS/FAIL summary, `photo_url` images embedded inline in PDF export
- 3 new tabs on existing `/reports` page, 3 new hooks, 3 new report components
- 1 new PostgreSQL view for materials consumption aggregation
- Tests: 3 hooks + 3 components + 1 new view = ~75 new tests

### Out of Scope
- No Edge Function changes
- No schema changes (no new tables/columns)
- No new npm dependencies (html2canvas + jspdf already in place)
- No scheduled/delivery of these reports
- No cost/price data (unit_cost on spare_parts requires schema decision — already deferred from Slice 1)

## Capabilities

### New Capabilities
- `materials-consumed-report`: Parts consumption grouped by WO or period with chart + table
- `compliance-report`: Work permits expiring/expired, LOTO status, technician certifications
- `checklists-evidence-report`: Checklist instance results with embedded photo evidence in PDF

### Modified Capabilities
- `reporting-ux`: Add 3 new tabs to `/reports`, same filter + export patterns from Slice 1

## Approach

Add 3 tabs to `ReportsPage.jsx`. Each uses a new hook (matching the 4-state pattern from Slice 1: loading/error/empty/success) and a new component. PDF export reuses `ReportExportButton` + `WidgetSelector` + `useReportExport` unchanged. For checklists: `photo_url` images are embedded inline via `<img>` in the React DOM — html2canvas captures them natively at `scale: 2`, no special handling needed.

| Report | Data Sources | Visual | Filters | Effort |
|--------|-------------|--------|---------|--------|
| Materiales Consumidos | `inventory_transactions`, `spare_parts`, `work_orders` | Bar chart (consumption by part) + MUI Table (WO, part, qty, date) | date, asset, part | Medium |
| Compliance | `work_permits`, `lockout_tagout`, `technician_skills`, `technician_module_progress`, `user_profiles` | MetricCards (expiring/active) + Tables (permits, LOTO, certs) | date, status, tech | Medium |
| Checklists con Evidencia | `checklist_instances`, `checklist_item_responses`, `checklist_templates` | MetricCards (PASS/FAIL rates) + image gallery + Table | date, tech, template | Large |

PostgreSQL view for materials: `report_materials_consumed` (JOIN `inventory_transactions` + `spare_parts` + `work_orders`, filter ISSUE/DIRECT_ISSUE, group by WO/period).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/pages/ReportsPage.jsx` | Modified | Add 3 tabs: Materiales, Compliance, Checklists |
| `src/components/reports/MaterialsConsumedReport.jsx` | New | Bar chart + detail table w/ refs |
| `src/components/reports/ComplianceReport.jsx` | New | MetricCards + 3 sub-tables (permits, LOTO, certs) |
| `src/components/reports/ChecklistEvidenceReport.jsx` | New | Summary cards + image gallery + item table |
| `src/hooks/useMaterialsConsumed.js` | New | Fetch materials view, aggregate by part/WO |
| `src/hooks/useComplianceReport.js` | New | Fetch 3 data sources (permits, LOTO, certs) |
| `src/hooks/useChecklistEvidence.js` | New | Fetch instances + responses w/ photo_urls |
| `supabase/migrations/*materials_view.sql` | New | `report_materials_consumed` view |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| html2canvas fails on cross-origin photo_url images | Med | Use `useCORS: true` + proxy if hosted on Supabase Storage public bucket; fallback placeholder |
| Large image sets from checklists bloat PDF | Low | Limit images per checklist instance, compress via canvas `toDataURL('image/jpeg', 0.7)` |
| Compliance report: 3 sub-queries may be slow | Low | Use parallel `Promise.all` in hook, add DB indexes if needed |

## Rollback Plan

- Revert `src/pages/ReportsPage.jsx` to last commit (remove 3 tabs)
- Drop 3 new component files + 3 hook files
- Drop materials view: `DROP VIEW IF EXISTS report_materials_consumed`
- No other infra affected

## Dependencies

- html2canvas + jspdf (already in `package.json`)
- Existing views from Slice 1: `report_maintenance_history`, `report_labor_hours`

## Success Criteria

- [ ] Materiales Consumidos renders consumption data by part/WO with chart + table
- [ ] Compliance report shows permits expiring within 7 days, active LOTO, tech levels
- [ ] Checklists con Evidencia renders PASS/FAIL summary + photo gallery + exports PDF with embedded images
- [ ] All 3 new reports export to PDF via existing button/widget selector
- [ ] All 4 states (loading/error/empty/success) handled per component
- [ ] Zero regressions in Slice 1 reports
