# Estrategia de Pruebas — CMMS Ibero

> Documento vivo — actualizado al 2026-05-22
> Próximo paso: ejecutar con Docker + Supabase local

---

## 1. Pre-build (automático, antes de cada build)

```bash
npm run prebuild
```

Valida:
- Archivos críticos existen (`rxdb.js`, `supabaseClient.js`, `App.jsx`)
- Imports principales no se rompieron
- No hay referencias huérfanas

## 2. Checklist manual pre-deploy (hoy, sin Docker)

Antes de mergear a `main`, verificar:

### 2.1 Build
- [ ] `npm run build` → exit 0, sin errores
- [ ] `npm run prebuild` → exit 0

### 2.2 Consola del navegador
- [ ] App carga sin errores rojos en Console
- [ ] RxDB log: `[RxDB] Instancia creada exitosamente`
- [ ] RxDB log: migración a schema v4 aplicada (si aplica)
- [ ] Replicación: `work_orders activa: true`
- [ ] Replicación: `material_requests activa: true`

### 2.3 WorkOrderDrawer
- [ ] Abrir OT → drawer se abre desde la derecha
- [ ] Badge de tipo visible (PM → Azul Overol, Correctivo → Naranja)
- [ ] Si la OT tiene materiales → aparecen listados con cantidad
- [ ] Si la OT no tiene materiales → muestra "Sin materiales solicitados"
- [ ] Swipe para cerrar (gesto táctil o drag con mouse)
- [ ] Botón "Confirmar" responde sin errores en consola

### 2.4 Regresión visual
- [ ] AppBar sin gradiente, color sólido (Azul Overol)
- [ ] Cards con borde 1px, sin sombra
- [ ] Botones con texto normal (sin mayúsculas), 48px mínimo

---

## 3. Tests con Docker (próximo paso, cuando tengamos el equipo nuevo)

### 3.1 Seed + PM Engine (integración)

```bash
# 1. Iniciar Supabase local
supabase start

# 2. Aplicar migraciones (se aplican automáticamente con supabase start)
# 3. Sembrar datos de prueba
psql "$SUPABASE_DB_URL" -f supabase/seed/pm_industrial_scenario.sql

# 4. Ejecutar motor
psql "$SUPABASE_DB_URL" -c "SELECT generate_due_preventive_work_orders();"

# 5. Verificar
psql "$SUPABASE_DB_URL" -c "
  SELECT wo.id, wo.wo_type, wo.lifecycle_phase, wo.status,
    (SELECT COUNT(*) FROM material_requests mr WHERE mr.work_order_id = wo.id) AS materiales
  FROM work_orders wo
  WHERE wo.symptom_note LIKE '%BANDA-TR%' OR wo.symptom_note LIKE '%BOMBA-TEST%';
"
```

**Esperado:**
- 1 WO de LUB-01 con GRASA-LITIO x2
- lifecycle_phase = 'WAPPR', status = 'pending' (sync trigger)
- pm_schedules recalculados

### 3.2 RxDB Schema Migration (offline)

```sql
-- En la DB local, forzar un documento con lifecycle_phase = 'CANCELLED'
-- Verificar que RxDB lo acepta y no lo rechaza por schema validation
```

### 3.3 Push rejection + conflict resolution

```sql
-- Probar que enviar una transición inválida desde frontend
-- dispara el error FSM y el doc local se marca _conflict = true
```

### 3.4 pg_cron activation

```sql
-- Verificar que el cron job existe
SELECT * FROM cron.job WHERE jobname = 'pm_engine_daily';
```

---

## 4. Arquitectura de pruebas futura (Playwright)

Cuando tengamos URL fija de deploy:

```bash
# Tests e2e contra entorno real
npx playwright test --url=https://cmms-ibero.vercel.app
```

Escenarios:
- Login / auth flow
- Navegación por asset tree
- Apertura de WorkOrderDrawer en vista de escritorio
- Apertura de WorkOrderDrawer en viewport tablet (1024x768)
- Verificación de badge PM en OTs preventivas
- Verificación de materiales listados

---

## 5. Resumen de data de prueba persistente

| Activo | ID | Creado por |
|--------|----|------------|
| BOMBA-TEST-01 | assets.id=1647 | Prueba inicial PM Engine |
| BANDA-TR-01 | assets.id=1648 | Seed industrial realista |

| Job Plan | Frecuencia | Materiales |
|----------|-----------|------------|
| INSP-MENSUAL | 30d | - |
| OVERHAUL-ANUAL | 365d | - |
| LUB-01 | 30d | GRASA-LITIO x2 |
| MEC-FAJA-01 | 180d | FAJA-24IN x1 |

| WO generada | Activo | Plan | Estado |
|-------------|--------|------|--------|
| 338ee710-... | BOMBA-TEST-01 | OVERHAUL-ANUAL | WAPPR/pending |
| 9096c302-... | BOMBA-TEST-01 | INSP-MENSUAL | WAPPR/pending |
| 0f6cca99-... | BANDA-TR-01 | LUB-01 | WAPPR/pending |
