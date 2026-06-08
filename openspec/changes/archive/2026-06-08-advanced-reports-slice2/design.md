# Design: Advanced Reports — Slice 2 (Materials, Compliance & Checklists)

## Technical Approach

Three client-side report tabs added to `/reports`, reusing the existing tab infrastructure, filter bar, `WidgetSelector` + `ReportExportButton`, and 4-state hook pattern (`loading → error → empty → success`) from Slice 1. Materials consumption uses a new PostgreSQL view (`report_materials_consumed`) for server-side aggregation; Compliance and Checklists query tables directly via Supabase REST, with the Compliance hook parallelizing 3 sub-queries via `Promise.all`. Photo evidence for checklists renders as `<img>` in the DOM — html2canvas captures them natively at `scale: 2, useCORS: true`; failed photos show a fallback placeholder without crashing the export.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Materials: client-side aggregation vs. PG view | View = single query, SQL-optimized, RLS-safe. Client-side = heavy data transfer | **PG view** — follows `kpi_mtbf`/`report_labor_hours` pattern |
| Compliance: single query vs. 3 parallel | Single = simpler but couples failure modes. Parallel = partial errors, more hooks | **3 parallel sub-queries** in one hook, per-spec (partial failure is a requirement) |
| Checklists: storage bucket proxy for photos | Proxy adds infra cost. Public bucket + `useCORS: true` works for Supabase-hosted images | **No proxy** — `<img>` with `crossOrigin="anonymous"`, fallback "Foto no disponible" |
| Tab state: URL params (existing) vs. React context | URL params = shareable/bookmarkable, already in use | **URL params** — `type=materials|compliance|checklists` via `useUrlParams` |

## Data Flow

```
ReportsPage → reportType (from URL) → filters (asset, date, tech, template)
  ├─ "materiales" → useMaterialsConsumed(assetId, startDate, endDate, partNum)
  │     → supabase.from('report_materials_consumed').select()
  │     → BarChart (qty by part) + MUI Table (WO, part_num, desc, qty, date)
  ├─ "compliance" → useComplianceReport(assetId, startDate, techId)
  │     → Promise.all([
  │         supabase.from('work_permits').select()...,  // permits
  │         supabase.from('lockout_tagout').select()..., // LOTO
  │         supabase.from('technician_skills').select('..., technological_modules(code, name), user_profiles(full_name)')...
  │       ])
  │     → MetricCards (expiring/active counts) + 3 Tables
  └─ "checklists" → useChecklistEvidence(startDate, endDate, techId, templateId)
        → supabase.from('checklist_instances').select('..., checklist_item_responses(status, photo_url)')
        → data → group by instance → stats (PASS/FAIL/NA) + photo gallery + item table
```

### PostgreSQL View

```sql
CREATE OR REPLACE VIEW report_materials_consumed WITH (security_invoker = true) AS
SELECT
  it.part_num,
  sp.description,
  sp.uom,
  SUM(ABS(it.qty)) AS total_qty,
  it.work_order_id,
  wo.description AS wo_description,
  MAX(it.created_at) AS last_transaction_at
FROM inventory_transactions it
LEFT JOIN spare_parts sp ON it.part_num = sp.part_num
LEFT JOIN work_orders wo ON it.work_order_id = wo.id
WHERE it.transaction_type IN ('ISSUE', 'DIRECT_ISSUE')
GROUP BY it.part_num, sp.description, sp.uom, it.work_order_id, wo.description;
-- qty is negative for ISSUE/DIRECT_ISSUE; ABS() normalizes to positive consumption
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/pages/ReportsPage.jsx` | Modify | Add 3 tabs + conditional filters (asset, tech, template) + 3 new hook calls |
| `src/components/reports/MaterialsConsumedReport.jsx` | Create | Recharts BarChart + MUI Table; refs for chart + table |
| `src/components/reports/ComplianceReport.jsx` | Create | 3 MetricCards + 3 MUI Tables; refs per sub-section |
| `src/components/reports/ChecklistEvidenceReport.jsx` | Create | MetricCards + `<img>` gallery + item table; refs per widget |
| `src/hooks/useMaterialsConsumed.js` | Create | Query `report_materials_consumed` view; loading/error/empty/success |
| `src/hooks/useComplianceReport.js` | Create | 3 parallel queries; partial-error tolerance (per sub-section) |
| `src/hooks/useChecklistEvidence.js` | Create | Query checklist instances + responses; compute PASS/FAIL/NA stats |
| `supabase/migrations/*materials_view.sql` | Create | `report_materials_consumed` view + pgTAP tests |

### Tab Integration (ReportsPage.jsx)

Add to the `Tabs` block:
```jsx
<Tab label="Materiales" value="materiales" />
<Tab label="Compliance" value="compliance" />
<Tab label="Checklists" value="checklists" />
```

Add conditional filters per tab:
- **materiales**: asset dropdown + date range + optional part_num text field
- **compliance**: asset dropdown + date range + technician dropdown
- **checklists**: date range + technician dropdown + template dropdown (from `checklist_templates`)

New hook calls mirror existing pattern:
```js
const materials = useMaterialsConsumed({ assetId, startDate, endDate, partNum: partNum || null });
const compliance = useComplianceReport({ assetId, startDate, endDate, techId: techId || null });
const checklists = useChecklistEvidence({ startDate, endDate, techId: techId || null, templateId: templateId || null });
```

Export reuses existing `widgetRefs` construction — each report exposes its refs (chart, table, metrics, gallery) at the page level via `data-widget-id`.

## State Management

Per the 4-state pattern established in Slice 1, every hook returns `{ loading, error, refetch }` plus report-specific data arrays. Components render:

1. **Loading**: `<CircularProgress>` centered with "Cargando..."
2. **Error**: `<Alert severity="error">` + `<Button>Reintentar</Button>` calling `onRetry`
3. **Empty**: contextual message — e.g. "No se encontraron materiales consumidos en el período seleccionado"
4. **Success**: full UI

**Compliance special case**: if a sub-query fails, that section renders an inline error Alert but the other sections render normally. The hook sets `error` to a string only when ALL 3 fail.

## Photo Handling (Checklists)

- `checklist_item_responses.photo_url` stored as nullable `TEXT` (URL to Supabase Storage public bucket)
- Component renders `<img src={photo_url} crossOrigin="anonymous" alt="Evidencia" />` when non-null
- When `photo_url IS NULL` → `<Box className="photo-placeholder">Sin evidencia fotográfica</Box>` — gray dashed border, camera icon via MUI `<PhotoCameraIcon />`
- html2canvas captures with `useCORS: true` — if the image taints the canvas, the widget captures as a failed-silent placeholder (existing `useReportExport` catch block)
- PDF export: gallery widget is wrapped in a `<Box ref={galleryRef} data-widget-id="checklist-gallery">` — captured at `scale: 2`

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | 3 new hooks × 4 states | Vitest + mock supabase client |
| Unit | 3 report components | Vitest + @testing-library, mock hooks |
| DB | `report_materials_consumed` view | pgTAP — insert known ISSUE/DIRECT_ISSUE transactions, assert aggregation |
| E2E | Navigate all 6 tabs, filter, export PDF | Playwright — verify DOM states |

## Migration / Rollout

Migration creates the view idempotently (`CREATE OR REPLACE VIEW`). No schema changes. No data migration. Rollback: drop view + revert `ReportsPage.jsx` + remove 3 component/hook files.

## Open Questions

- [ ] Part number filter in Materials: `<TextField>` free-text or `<Autocomplete>` from `spare_parts`? Proposal says "optional" — start with TextField, upscope to Autocomplete if UX feedback demands it.
- [ ] Template filter in Checklists: should it list active templates only? Yes — filter `is_active = true` (default).
