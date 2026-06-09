## Exploration: PDF Engine — Seed + Testing de integración real

### Current State

El PDF Engine se completó en 4 fases (template engine, editor, edge functions, reportes avanzados), pero **nunca se probó el flujo completo real** con datos de la DB. Los tests existentes usan datos fake inline en `templateEngine.integration.test.js` y el template seed de Supabase fue escrito sin verificar compatibilidad con el motor real.

### Affected Areas

| Archivo | Por qué está afectado |
|---------|----------------------|
| `supabase/migrations/20260604100030_pdf_report_engine.sql` | Seed template `ot-default` usa pipes y tipos de sección que NO existen en el motor |
| `packages/pdf-engine/templateDefaults.js` | `DEFAULT_PIPES` tiene 10 pipes pero el seed referencia 5 que no existen |
| `packages/pdf-engine/templateEngine.js` | `VALID_SECTION_TYPES` no incluye `field_table` ni `condition_block` usados en el seed |
| `supabase/functions/generate-pdf/index.ts` | `resolveDataFromDB()` hace queries a `work_order_labor` y `work_order_materials` que NO EXISTEN |
| `src/hooks/useReport.js` | `buildRenderData()` construye el contexto para render — donde irían los seed data |
| `src/lib/pdf/__tests__/templateEngine.integration.test.js` | Solo tests con data fake inline, no ejercita el pipeline DB → RxDB → template |

### Hallazgos Detallados

#### 1. Template seed `ot-default` — Roto en 3 dimensiones

**Pipes que no existen en `DEFAULT_PIPES`:**

| Pipe en el seed | ¿Existe? |
|----------------|----------|
| `status_label` | ❌ No existe |
| `wo_type_label` | ❌ No existe |
| `priority_label` | ❌ No existe |
| `datetime` | ❌ No existe |
| `activity_label` | ❌ No existe |
| `date` | ✅ Existe (`pipeDate`) |
| `number` | ✅ Existe (`pipeNumber`) |

**Tipos de sección que no existen en `SECTION_RENDERERS` / `VALID_SECTION_TYPES`:**

| Tipo en el seed | Renderer esperado | ¿Existe? |
|-----------------|-------------------|----------|
| `header` | ✅ Existe pero espera `titleField`/`badgeField`, no `fields[]` | ⚠️ Incompatible |
| `field_table` | ❌ No existe (debería ser `details-grid`) | ❌ |
| `divider` | ✅ Existe | ✅ |
| `table` | ✅ Existe pero espera `dataField`, no `source` | ⚠️ Incompatible |
| `condition_block` | ❌ No existe (debería ser `condition-block`) | ❌ |
| `footer` | ✅ Existe pero espera solo `text`, no `fields[]` | ⚠️ Incompatible |

**Inconsistencias de schema en secciones específicas:**

- La sección `header` del seed usa un array `fields[]` con objetos `{key, label, type, source, pipe}`. El renderer `header` espera `titleField` (string) y `badgeField` (string) — estructuras completamente distintas.
- La sección `table` del seed usa `source: 'labor_records'` para indicar la fuente de datos. El renderer `table` usa `dataField: 'labor_records'` — mismo valor pero key distinta.
- La sección `condition_block` usa `condition: {field, operator, value}` como objeto. El renderer `condition-block` espera `condition` como string tipo `"status \| notEmpty"`.

#### 2. Edge Function `generate-pdf` — Queries rotas

En `resolveDataFromDB()` (línea 199-200):
```ts
.select('*, labor:work_order_labor(*), materials:work_order_materials(*)')
```

Las tablas `work_order_labor` y `work_order_materials` **NO EXISTEN** en la base de datos. Las tablas reales son:
- `labor_records` (creada en `20260526000002_labor_records.sql`)
- `material_requests` (creada en `20260521000001_inventory_epicor_integration.sql`)

Esto significa que cuando la EF se invoca con `record_id` (buscando datos desde la DB), falla al cargar labor y materials. Solo funciona con `data` inline.

#### 3. No hay seed data para integration testing real

No existe ningún archivo de seed que inserte:
- Una WO real (con `lifecycle_phase`, `priority`, `wo_type`, `actual_hours`)
- `labor_records` asociados (con `technician_id`, `activity_code`, `start_time`, `end_time`)
- `material_requests` asociados (con `part_num`, `line_desc`, `requested_qty`)
- Un asset real vinculado

Los tests de integración actuales usan `fakeWorkOrder` hardcodeado inline en `templateEngine.integration.test.js`.

#### 4. Brechas de testing

| Flujo | Estado |
|-------|--------|
| `resolveTemplate()` + data fake inline | ✅ Cubierto (520 líneas de test) |
| `validateTemplate()` con errores | ✅ Cubierto |
| Pipes individuales (10 pipes) | ✅ 60 tests unitarios |
| Seed template de Supabase → render | ❌ NUNCA probado |
| RxDB → `useReport` → template engine | ❌ NUNCA probado con data real |
| EF `generate-pdf` con `record_id` | ❌ Tests usan mocks, no datos reales |
| EF `send-report` | ❌ Tests usan mocks, no datos reales |
| Browserless → Storage → signed URL | ❌ Tests usan mocks |

### Approaches

1. **Arreglar el seed template + datos mínimos en tests** (Recomendado)
   - Corregir los pipes que faltan en `DEFAULT_PIPES` (agregar `status_label`, `wo_type_label`, `priority_label`, `datetime`, `activity_label`)
   - Corregir los tipos de sección en el seed (`field_table` → `details-grid`, `condition_block` → `condition-block`, etc.)
   - Corregir el schema del seed para que coincida con lo que los renderers esperan
   - Corregir las queries en `resolveDataFromDB` para usar `labor_records` y `material_requests`
   - Agregar seed SQL con WO + labor_records + material_requests + asset
   - Agregar test de integración que lea el seed de Supabase y renderice
   - **Pros**: Arregla el bug, valida el pipeline completo, queda documentado
   - **Cons**: Requiere tocar 4-5 archivos, hay que decidir qué pipes label hacer
   - **Effort**: Medium (150-250 líneas totales)

2. **Solo seed data + test de integración** (Mínimo viable)
   - No arreglar el template seed ni las EF queries rotas
   - Crear seed data que funcione con `DEFAULT_TEMPLATE_OT` (el fallback offline que sí funciona)
   - Test de integración que pruebe `useReport` con datos reales de RxDB/Supabase
   - **Pros**: Entrega rápido, valida el flujo cliente-side
   - **Cons**: No arregla el template seed ni la EF, deja bugs sin resolver
   - **Effort**: Low (80-120 líneas)

3. **Arreglar todo + test end-to-end** (Completo)
   - Todo lo del Approach 1 más:
   - Integration test de la EF `generate-pdf` usando Supabase local (pg_spawn o branch)
   - Test que verifique el pipeline completo: template seed → render → PDF
   - **Pros**: Cobertura total, sin deuda técnica
   - **Cons**: Requiere infraestructura de testing para Deno Edge Functions
   - **Effort**: High (400-600 líneas)

### Recommendation

**Approach 1** — Es el punto óptimo entre pragmatismo y calidad. Arregla los bugs reales que impiden que el sistema funcione, sin caer en la complejidad de testear Browserless/PDF generation localmente.

Pasos concretos:
1. **Agregar pipes faltantes** a `DEFAULT_PIPES`: `status_label`, `wo_type_label`, `priority_label` como pipes de lookup que mapean códigos a labels legibles; `datetime` como alias de `date('DD/MM/YYYY HH:mm')`; `activity_label` como lookup de activity_code a nombre descriptivo.
2. **Corregir el seed template** en la migración para que use los tipos de sección y schema correctos (`details-grid` en vez de `field_table`, `condition-block` en vez de `condition_block`, `dataField` en vez de `source`).
3. **Corregir `resolveDataFromDB`** en la EF para que haga queries contra `labor_records` y `material_requests`.
4. **Agregar migración de seed data** con una WO real, asset, labor_records y material_requests.
5. **Agregar test de integración** que ejercite el flujo completo: leer template de Supabase + seed data → renderizar HTML.

### Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| **Cambiar la migración existente** — Podría romper instancias que ya corrieron la migración original | Alto | Usar `ALTER TABLE` o nueva migración que actualice el seed, no modificar la migración original |
| **Los pipes label dependen de datos maestros** — `status_label` necesita mapear valores de `lifecycle_phase` | Medio | Implementar como lookup tables planos o funciones SQL; los pipes pueden ser funciones JS que hagan mapping simple |
| **Seed data con FKs existentes** — Necesita insertar en assets, user_profiles, work_orders, etc. | Medio | El seed debe seguir el orden de migraciones existentes y usar IDs fijos (ej: `SEED-ASSET-001`) |
| **Tests de integración con Supabase** — Requieren conexión a DB | Bajo | Usar `describe.skipIf(!process.env.SUPABASE_URL)`, mismo patrón que los existing DB tests |

### Ready for Proposal

**Sí.** La exploración está completa. El proposer debe decidir si arreglar los pipes label faltantes con lookup tables simples o con funciones JS, y si la seed data va en migración SQL o en script de setup de tests.

Resumen ejecutivo para el usuario: el template seed de Supabase está roto (5 pipes y 3 tipos de sección no existen), la Edge Function tiene queries a tablas que no existen, y no hay datos semilla para probar el pipeline completo. Se necesita un cambio que arregle estas tres cosas y agregue seed data + test de integración.
