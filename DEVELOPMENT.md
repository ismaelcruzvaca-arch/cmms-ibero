# DEVELOPMENT.md — CMMS Ibero

## Arquitectura Core (2026-05-20)

### Refactorización ISO 14224 — `work_orders`

Se reemplazó el esquema legacy de `work_orders` por uno alineado al estándar ISO 14224.

#### Columnas eliminadas
`status`, `description`, `actual_hours`, `cost_estimate`, `actual_cost`, `percentage_complete`, `_conflict`, `_deleted`

#### FSM Desacoplado

Dos columnas separadas para el ciclo de vida, sin lógica acoplada en un solo enum:

| Columna | Tipo | Valores |
|---------|------|---------|
| `lifecycle_phase` | ENUM | `WAPPR → APPROVED → INPRG → COMP → CLOSED` |
| `block_reason` | ENUM | `NONE`, `MATERIAL`, `PLANT_CONDITION`, `SCHEDULE` |

La transición **solo hacia adelante** se valida via BEFORE UPDATE trigger `validate_lifecycle_fsm()`. No se permiten saltos de fase ni retrocesos.

#### Timestamps Event-Driven (8 columnas)

| Timestamp | Disparo |
|-----------|---------|
| `reported_at` | Creación de la WO |
| `approved_at` | Cambio a APPROVED |
| `planned_start_at` | Planificación de ejecución |
| `actual_start_at` | Cambio a INPRG |
| `completed_at` | Cambio a COMP |
| `closed_at` | Cambio a CLOSED |
| `machine_down_at` | Inicio de downtime |
| `machine_up_at` | Fin de downtime |

Los timestamps se gestionan desde la aplicación. El trigger FSM no los auto-asigna.

#### Taxonomía de Falla (ISO 14224)

| Columna | Propósito |
|---------|-----------|
| `failure_class` | Clase de falla (ej. `ELECTRICAL`, `MECHANICAL`) |
| `problem_code` | Código de problema |
| `cause_code` | Código de causa raíz |
| `remedy_code` | Código de remedio aplicado |

#### Contexto Operativo

| Columna | Propósito |
|---------|-----------|
| `criticality` | Criticidad del activo en el momento |
| `asset_class` | Clase del activo (ej. `MOTOR`, `PUMP`) |
| `part_in_process` | Lote o producto en proceso durante la falla |

#### Notas Estructuradas

| Columna | Uso |
|---------|-----|
| `symptom_note` | Síntoma reportado (origen OEE o técnico) |
| `cause_note` | Diagnóstico de causa |
| `action_note` | Acción correctiva ejecutada |

---

### Seguridad (RBAC)

Tabla `user_profiles` vinculada a `auth.users` vía trigger `sync_user_profile()`.

| Rol | work_orders | assets | audit_logs |
|-----|-------------|--------|------------|
| `ADMIN` | CRUD | CRUD | SELECT |
| `PLANNER` | CRUD | SELECT | - |
| `TECHNICIAN` | UPDATE parcial | SELECT | - |
| `STOREKEEPER` | SELECT | SELECT | - |

Helper function `get_user_role()` para evitar subqueries repetitivos en RLS policies.

---

### Auditoría (Audit Trail)

Tabla `audit_logs` inmutable con función genérica `audit_trigger_func()`:

- `id` UUID PK
- `table_name`, `record_id`, `action` (INSERT/UPDATE/DELETE)
- `old_data` JSONB, `new_data` JSONB
- `changed_by` UUID (FK auth.users), `changed_at` TIMESTAMPTZ

Aplicada a `work_orders` via trigger AFTER INSERT/UPDATE/DELETE. La función es reutilizable para cualquier otra tabla sin cambios de código.

---

### Edge Function `oee-trigger`

Actualizada para insertar con el nuevo schema:
- `lifecycle_phase: 'WAPPR'`
- `block_reason: 'NONE'`
- `symptom_note: <sintoma>` (desde payload OEE)

---

## ⚠️ ⚠️ ⚠️ RESTRICCIÓN DE INFRAESTRUCTURA ⚠️ ⚠️ ⚠️

### EL EQUIPO DE DESARROLLO ACTUAL NO TIENE DOCKER INSTALADO

A partir de esta sesión, **ninguna tarea, prueba o testing local de Edge Functions debe asumir que Docker está disponible**.

Esto afecta a:

1. **`supabase functions serve`** — no se puede usar porque requiere el stack local de Supabase (Docker).
2. **Pruebas locales de Edge Functions** — deben ejecutarse directamente con `deno run --allow-net --allow-env --allow-read` contra el entorno en la nube de Supabase.
3. **Migraciones SQL** — `supabase db push` se usa en remoto, no local.
4. **Cualquier comando que dependa de contenedores** — asumir que fallará.

#### Workaround para pruebas locales de Edge Functions

```bash
# En lugar de supabase functions serve (NO DISPONIBLE):
cd supabase/functions/oee-trigger
SUPABASE_URL="<url>" \
SUPABASE_SERVICE_ROLE_KEY="<key>" \
OEE_SECRET_KEY="<secret>" \
deno run --allow-net --allow-env --allow-read index.ts

# En otra terminal:
curl -X POST http://localhost:8000/ \
  -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" \
  -d '{"equipment_id":"<tag>","sintoma":"<texto>"}'
```

---

## Convenciones del Proyecto

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `archive:`, `refactor:`)
- **Ramas**: Solo `main` (monorepo)
- **Frontend**: React + Vite + MUI + RxDB (en `src/`)
- **Backend**: Supabase (PostgreSQL + Edge Functions en Deno)
- **SDD**: Spec-Driven Development con artifacts en `openspec/`
