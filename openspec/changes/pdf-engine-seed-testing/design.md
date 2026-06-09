# Design: PDF Engine — Seed + Integration Testing

## Technical Approach

Bugfix + seed + test en 5 cambios atómicos que ejercitan el pipeline completo: pipes → template seed → DB queries → seed data → test de integración. El orden importa porque cada paso desbloquea el siguiente.

## Architecture Decisions

### Decision: New pipes como lookup maps planos

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Lookup map simple | Sin dependencias, 2 líneas c/u | ✅ Elegido |
| Tabla catálogo en DB | Overkill para 4-5 códigos fijos | ❌ Rechazado |
| JSON de config externo | Complejidad sin beneficio real | ❌ Rechazado |

`datetime` es un wrapper que llama a `pipeDate(val, 'DD/MM/YYYY HH:mm')` — 0 duplicación.

### Decision: Migración nueva en vez de modificar la original

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `UPDATE` en migración nueva | Idempotente, no toca migraciones existentes | ✅ Elegido |
| Editar `20260604100030` inline | Rompe checksum, no reproducible | ❌ Rechazado |
| Delete + re-insert | Innecesario, `UPDATE WHERE` basta | ❌ Rechazado |

### Decision: Seed data co-locada con el fix del template

Misma migración, mismo archivo. El seed data es parte del mismo cambio (sin seed no hay test de integración). Orden de inserts: assets → work_orders → labor_records → material_requests (PK → FK).

### Decision: `resolveDataFromDB` se arregla en generate-pdf, send-report lo hereda

`send-report/index.ts` importa `resolveDataFromDB` de `../generate-pdf/index.ts` (línea 24). El fix se propaga automáticamente. No tocar send-report.

## Data Flow

```
Template seed (DB)
     │
     ▼
useReport.buildRenderData() ──→ renderData { work_order, asset,
     │                              labor_records, material_requests }
     ▼
resolveTemplate(template, renderData)
     │
     ▼
HTML sin placeholders sueltos
     │
     ▼
Test verifica: NO {{...}}, seed WO desc, asset desc, activity_label
```

```
generate-pdf EF:
  resolveDataFromDB()
    → .from('work_orders').select('*, labor:work_order_labor(*), materials:work_order_materials(*)')
    → CORREGIR: .select('*, labor:labor_records(*), materials:material_requests(*)')
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/pdf/templateDefaults.js` | Modify | +5 pipes en DEFAULT_PIPES (status_label, wo_type_label, priority_label, datetime, activity_label). `datetime` es alias de `date` con formato fijo. |
| `supabase/migrations/20260609000001_pdf_seed_fix.sql` | Create | UPDATE seed template con tipos/schema correctos + INSERT seed data (asset, WO, labor_records, material_requests) |
| `supabase/functions/generate-pdf/index.ts` | Modify | Línea 200: cambiar `work_order_labor` → `labor_records` y `work_order_materials` → `material_requests` |
| `src/lib/pdf/__tests__/pdfEngine.supabase.test.js` | Create | Test integración DB → useReport → HTML condicional (skipIf sin SUPABASE_URL) |

## Interfaces / Contracts

### Nuevos pipes (templateDefaults.js)

```js
const LABEL_MAP = {
  status_label: { OPEN: 'Abierta', IN_PROGRESS: 'En Progreso', COMPLETED: 'Completada', CANCELLED: 'Cancelada' },
  wo_type_label: { CM: 'Correctivo', PM: 'Preventivo', EM: 'Emergencia', PROJECT: 'Proyecto' },
  priority_label: { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' },
  activity_label: { INSP: 'Inspección', REPAIR: 'Reparación', INSTALL: 'Instalación', REMOVE: 'Retiro' },
};

// Pattern for each:
(val) => LABEL_MAP.pipeName[val] ?? val

// datetime:
(val) => pipeDate(val, 'DD/MM/YYYY HH:mm')
```

### Seed data contract

| Tabla | ID fijo | FK |
|-------|---------|-----|
| `assets` | `SEED-ASSET-001` | — |
| `work_orders` | `SEED-WO-001` | `asset_id → SEED-ASSET-001` |
| `labor_records` | UUID gen_random_uuid() | `wo_id → SEED-WO-001` (×2 rows) |
| `material_requests` | UUID gen_random_uuid() | `wo_id → SEED-WO-001` (×1 row) |

### Corrected template structure (JSONB en migración)

```json
{
  "sections": [
    { "type": "header", "titleField": "title", "badgeField": "badge" },
    { "type": "details-grid", "columns": 2,
      "items": [
        { "label": "Equipo", "value": "{{work_order.equipment_id}}" },
        { "label": "Descripción", "value": "{{work_order.description}}" },
        { "label": "Tipo", "value": "{{work_order.wo_type | wo_type_label}}" },
        { "label": "Prioridad", "value": "{{work_order.priority | priority_label}}" },
        { "label": "Estado", "value": "{{work_order.lifecycle_phase | status_label}}" },
        { "label": "Inicio real", "value": "{{work_order.actual_start_at | datetime}}" },
        { "label": "Completado", "value": "{{work_order.completed_at | datetime}}" },
        { "label": "Horas reales", "value": "{{work_order.actual_hours | number}}" }
      ]
    },
    { "type": "divider" },
    { "type": "table", "dataField": "labor_records",
      "columns": [
        { "header": "Técnico", "key": "technician_name" },
        { "header": "Inicio", "key": "start_time", "pipe": "datetime" },
        { "header": "Fin", "key": "end_time", "pipe": "datetime" },
        { "header": "Actividad", "key": "activity_code", "pipe": "activity_label" }
      ]
    },
    { "type": "condition-block",
      "condition": "material_requests | notEmpty",
      "sections": [
        { "type": "table", "dataField": "material_requests",
          "columns": [
            { "header": "Código", "key": "part_num" },
            { "header": "Descripción", "key": "line_desc" },
            { "header": "Cant.", "key": "requested_qty", "pipe": "number" }
          ]
        }
      ]
    },
    { "type": "footer",
      "text": "Generado por CMMS Ibero — {{generated_at | datetime}}" }
  ]
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | 5 new pipes | En `templateDefaults.test.js`: agregar tests de cada pipe: label lookup, fallback a valor original, datetime format. Ver spec escenarios. |
| Unit | Pipe count assertion | Actualizar test de `Object.keys(DEFAULT_PIPES).length` de 10 → 15 |
| Integration | Pipe + template seed | `pdfEngine.supabase.test.js`: fetch template 'ot-default' de Supabase, construir renderData con seed data, renderizar. Verificar 0 placeholders + datos concretos en HTML. `skipIf(!process.env.SUPABASE_URL)`. |

## Migration / Rollout

1. Los pipes nuevos son backward-compatible — el template seed roto no se usa hasta que la migración lo corrige.
2. Orden seguro: pipes → migrate → fix EF → seed → test. Si falla en cualquier paso, solo afecta a quien ejecuta `npm test` con SUPABASE_URL.
3. Rollback: revertir commit. Si la migración ya corrió, las 3 sentencias usan `UPDATE ... WHERE code='ot-default'` + `INSERT ... ON CONFLICT` — re-ejecutar es seguro.

## Open Questions

None.
