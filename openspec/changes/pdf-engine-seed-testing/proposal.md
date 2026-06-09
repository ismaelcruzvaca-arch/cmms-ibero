# Proposal: PDF Engine — Seed + Integration Testing

## Intent

El PDF Engine completó 4 fases de desarrollo pero nunca se probó el flujo real con datos de base de datos. El template seed de Supabase (`ot-default`) usa pipes y tipos de sección inexistentes, la Edge Function `generate-pdf` consulta tablas que no existen, y no hay seed data para tests de integración. Este cambio arregla esos 3 bugs y agrega seed data + test de integración que ejercite el pipeline completo.

## Scope

### In Scope
- Agregar 5 pipes faltantes a DEFAULT_PIPES (`status_label`, `wo_type_label`, `priority_label`, `datetime`, `activity_label`)
- Corregir seed template con nueva migración SQL (UPDATE, sin modificar la original)
- Corregir queries en `generate-pdf` (`work_order_labor` → `labor_records`, `work_order_materials` → `material_requests`)
- Agregar migración SQL con seed data (asset + WO + labor_records + material_requests)
- Agregar test de integración que lea template de Supabase + seed data → renderice HTML

### Out of Scope
- Tests de Edge Functions con Browserless (requiere infraestructura Deno local)
- Tests E2E con Playwright para PDF generation
- Publicar `@cmms/pdf-engine` a JSR
- Refactor del schema de secciones del template engine

## Capabilities

### New Capabilities
None — refactor/fix + seed data. No se introducen nuevas capacidades funcionales.

### Modified Capabilities
None — no hay cambios a nivel de spec. Los pipes nuevos son backward-compatible.

## Approach

Approach 1 de la exploración. 5 pasos secuenciales:
1. Agregar 5 pipes a `templateDefaults.js` (lookup maps + alias de `date`)
2. Nueva migración SQL que UPDATE el seed template con tipos/schema correctos
3. Corregir `resolveDataFromDB()` en la EF para usar tablas reales
4. Nueva migración SQL con seed data (asset, WO, labor_records, material_requests)
5. Test de integración condicional (`skipIf` sin `SUPABASE_URL`) que ejercite pipeline DB → useReport → HTML

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/pdf/templateDefaults.js` | Modified | +5 pipes (status_label, wo_type_label, priority_label, datetime, activity_label) |
| `supabase/migrations/20260609000001_pdf_seed_fix.sql` | New | Corrige seed template + agrega seed data |
| `supabase/functions/generate-pdf/index.ts` | Modified | Corrige nombres de tablas (≈líneas 199-200) |
| `src/lib/pdf/__tests__/pdfEngine.supabase.test.js` | New | Test integración DB → useReport → HTML |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Seed data con FK conflict | Medium | IDs fijos (SEED-ASSET-001), orden correcto de inserts |
| Migración no-idempotente | Low | `UPDATE ... WHERE` + `INSERT ... ON CONFLICT` |
| Test no corre sin Supabase | Low | `describe.skipIf(!process.env.SUPABASE_URL)` |

## Rollback

Revertir commit. Si la migración nueva ya corrió: `DELETE FROM pdf_templates WHERE id = 'ot-default' AND is_seed = true` + `DELETE FROM work_orders WHERE wo_num = 'SEED-WO-001'`. La migración usa `UPDATE`/`INSERT ... ON CONFLICT`, es segura para re-ejecución.

## Dependencies

- Supabase project activo (para test de integración)
- Migraciones existentes de `labor_records` (`20260526000002`) y `material_requests` ya aplicadas

## Success Criteria

- [ ] `npm test` pasa con tests nuevos incluidos
- [ ] Template seed renderiza HTML sin placeholders sin resolver
- [ ] Edge Function compila sin errores de schema (`deno check`)
- [ ] Seed data permite visualizar reporte OT desde UI sin datos mock
