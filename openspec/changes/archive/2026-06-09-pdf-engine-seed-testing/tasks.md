# Tasks: PDF Engine — Seed + Integration Testing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 170–220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pipes + migration + EF fix + integration test | Single PR | Cambio atómico, ~200 líneas |

## Phase 1: Pipes + Tests (`templateDefaults.js`)

- [x] 1.1 Agregar 5 pipes a `DEFAULT_PIPES` en `src/lib/pdf/templateDefaults.js`: `status_label`, `wo_type_label`, `priority_label`, `activity_label` como lookup maps planos con return del valor raw si no hay match; `datetime` como delegado a `pipeDate(val, 'DD/MM/YYYY HH:mm')`
- [x] 1.2 Actualizar assertion de count en `src/lib/pdf/__tests__/templateDefaults.test.js` de 10 → 15
- [x] 1.3 Agregar tests unitarios para cada pipe nuevo: label conocido retorna español, código desconocido pasa through, datetime formatea ISO 8601 a `DD/MM/YYYY HH:mm`

## Phase 2: Migración SQL (seed template fix + seed data)

- [x] 2.1 Crear `supabase/migrations/20260609000001_pdf_seed_fix.sql` con `UPDATE report_templates SET template = '...' WHERE code = 'ot-default' AND version = 1`: corregir `field_table` → `details-grid`, `condition_block` → `condition-block`, `titleField`/`dataField` en vez de `fields[]`/`source`, pipes que SÍ existen
- [x] 2.2 En la misma migración, insertar seed data con `INSERT ... ON CONFLICT` (idempotente): 1 asset (`SEED-ASSET-001`), 1 WO (`SEED-WO-001` → FK asset), 2 labor_records, 1 material_request (ambos FK → WO)

## Phase 3: Edge Function fix (`generate-pdf/index.ts`)

- [x] 3.1 Corregir `resolveDataFromDB` en `supabase/functions/generate-pdf/index.ts`: `.select('*, labor:work_order_labor(*), materials:work_order_materials(*)')` → `.select('*, labor:labor_records(*), materials:material_requests(*)')` (línea ~200)

## Phase 4: Integration Test (Supabase)

- [x] 4.1 Crear `src/lib/pdf/__tests__/pdfEngine.supabase.test.js` con `describe.skipIf(!process.env.SUPABASE_URL)`: fetch template `ot-default` desde Supabase → construir `renderData{}` con seed WO, asset, labor_records, material_requests → llamar `resolveTemplate(template.structure, renderData)` → verificar 0 placeholders `{{...}}` en HTML + seed WO description presente + asset description presente + al menos un pipe output verificado
