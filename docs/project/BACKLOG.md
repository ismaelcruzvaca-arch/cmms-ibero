# Backlog Técnico — CMMS Ibero

> Última actualización: 2026-05-22

---

## [PENDIENTE - FRONTEND]

### UI de Materiales en el WorkOrderDrawer (Fase 3 — App del Mecánico)

**Descripción**: Agregar un panel de "Materiales" dentro del `<WorkOrderDrawer>` para que el mecánico pueda solicitar refacciones desde la OT.

**Sub-tareas**:
- Botón "Solicitar Material" que abre un sub-formulario dentro del Drawer
- Soporte para:
  - **Partes catalogadas**: selector de `spare_parts` con búsqueda por `part_num` o `description`
  - **Non-Stock**: formulario con `line_desc` + `expense_code` (sin `part_num`)
- Al confirmar: inserta `material_requests` con `work_order_id` vinculado
- Indicador visual de solicitudes activas en la card de la OT
- Transacción `ISSUE` al consumir material desde el almacén

**Dependencias**: Fase 2 de Almacén (tablas + edge function listas)

**Prioridad**: Media

---

## [PENDIENTE - CORE]

### Motor de Mantenimiento Preventivo (Job Plans, Secuencias, Medidores)

**Descripción**: Diseñar e implementar el módulo de Mantenimiento Preventivo (PM) con planes de trabajo, secuencias basadas en calendario/medidores, y ejecución automática vía pg_cron.

**Componentes**:
- `job_plans` — plantillas de OT recurrente (tareas, refacciones, frecuencia)
- `job_sequences` — instancias programadas de cada plan (próxima fecha, medidor objetivo)
- `meters` — medidores/contadores por activo (horas, kilómetros, ciclos)
- `meter_readings` — lecturas históricas de medidores
- `pm_schedule` — generación automática de OT al alcanzar trigger del medidor o fecha

**Integraciones**:
- `pg_cron` para el schedule diario de generación de OT
- `outbox_messages` para notificar a Epicor sobre las OT generadas

**Prioridad**: Baja (post-Fase 2 Almacén)

---

## [DEUDA TÉCNICA - INFRAESTRUCTURA]

### ✅ RESUELTO: Schema Drift — Producción vs ISO 14224

**Resuelto en**: `2026-05-22` — Migración `20260522000003_work_orders_iso14224_production`

**Qué se hizo**:
- Creados ENUMs `lifecycle_phase` y `block_reason` (idempotente)
- Agregadas 25 columnas ISO 14224 como NULLable (ALTER TABLE ADD COLUMN IF NOT EXISTS)
- Reemplazado FSM trigger: valida `lifecycle_phase` en vez de `status`
- Creado trigger de sincronía bidireccional `lifecycle_phase ↔ status`
- `wo_type_enum` extendido con valor `'PM'`
- `job_plans`, `pm_schedules`, `meters`, `measure_points` creados en producción
- `generate_due_preventive_work_orders()` desplegada (adaptada: pm_schedules.asset_id INTEGER)

**Preservado**:
- RxDB columns (`_deleted`, `_conflict`, `updated_at` BIGINT) — **NO se tocaron**
- `work_orders.id` como TEXT — **NO se cambió a UUID** (evita cascada de FKs)
- `status` VARCHAR — **NO se dropeó**, mantenida por trigger de sincronía
- Todos los datos históricos (3 OTs) migrados con legacy_id y mapeo de timestamps

**Verificación**: 6/6 tests de sincronía pasan en producción ✅

---

**NOTA**: Cuando el entorno local cuente con Docker, se deben migrar las pruebas de integración de la Edge Function `epicor-webhook` para ejecutarse localmente mediante `supabase functions serve`, tal como se hizo con `oee-trigger`.

**Detalle**:
- Actualmente las pruebas de integración del webhook se saltan si no hay `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
- Con Docker + `supabase start`, se puede ejecutar `supabase functions serve epicor-webhook --env-file ./supabase/.env.local`
- Las pruebas pueden apuntar a la DB local y usar `Service Role Key` del stack local
- El patrón ya está implementado en `oee-trigger` — replicar el enfoque

**Prioridad**: Alta (cuando Docker esté disponible)
