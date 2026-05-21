# Design: Core — Security, Audit & ISO 14224 Schema

## Technical Approach

Destructive schema migration (DROP + CREATE `work_orders`) en dos migraciones Supabase secuenciales. RBAC implementado via `user_profiles` + RLS policies con helper function `get_user_role()`. Auditoría genérica mediante trigger reutilizable `audit_trigger_func()`. FSM de lifecycle validado en BEFORE UPDATE trigger. Edge Function `oee-trigger` actualizada para alinearse con el nuevo schema.

---

## Architecture Decisions

### Migration: DROP + CREATE vs ALTER TABLE

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| ALTER TABLE in-place | 12 columnas a eliminar, 20 a agregar, 2 cambios de tipo — script frágil y riesgoso | ❌ |
| **DROP old + CREATE new** | Schema limpio, sin deuda técnica. Solo hay datos de test. Backward-incompatible por decisión explícita | ✅ |

### FSM: Trigger BEFORE UPDATE vs aplicación

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Validación solo en app | Bypasseable desde SQL directo, no es DBA-safe | ❌ |
| **BEFORE UPDATE trigger** | Enforced a nivel fila, inescapable. El trigger puede leer OLD.lifecycle_phase y validar la transición | ✅ |

### Auditoría: Función genérica vs trigger por tabla

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Trigger específico por tabla | Duplicación de lógica por cada tabla nueva | ❌ |
| **Función genérica con TG_TABLE_NAME** | Reutilizable: se aplica a cualquier tabla agregando un CREATE TRIGGER. Sin cambios de código | ✅ |

### RBAC: Helper function vs subquery inline

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `(SELECT role FROM user_profiles WHERE id = auth.uid())` en cada policy | Verboso, repetitivo, propenso a errores de tipeo | ❌ |
| **`get_user_role()`** | Una definición, se reusa en todas las policies. Si la lógica cambia, se actualiza un solo lugar | ✅ |

---

## Data Flow

```
                      ┌─────────────────────────────┐
                      │     Edge Function           │
                      │   oee-trigger/index.ts      │
                      └──────────┬──────────────────┘
                                 │ POST / (lifecycle_phase='WAPPR')
                                 ▼
┌──────────────────────────────────────────────────────┐
│                  Supabase REST                       │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ RLS Check │──→│ work_orders  │──→│ FSM Trigger │  │
│  │(get_user  │   │ (ISO 14224)  │   │ (BEFORE UP) │  │
│  │ _role())  │   └──────┬───────┘   └─────────────┘  │
│  └──────────┘           │                            │
│                         ▼                            │
│                  ┌──────────────┐                     │
│                  │ Audit Trigger│                     │
│                  │ (AFTER I/U/D)│                     │
│                  └──────┬───────┘                     │
│                         ▼                            │
│                  ┌──────────────┐                     │
│                  │  audit_logs  │  (immutable)        │
│                  └──────────────┘                     │
│                                                       │
│  ┌────────────┐    ┌──────────────────┐               │
│  │ auth.users │───→│ user_profiles    │               │
│  │ (INSERT)   │    │ trigger insert   │               │
│  └────────────┘    │ role→TECHNICIAN  │               │
│                    └──────────────────┘               │
└──────────────────────────────────────────────────────┘
```

---

## Migration SQL Outline

### Migration 1: `<timestamp>_rbac_audit.sql`

```sql
-- 1. ENUMs
CREATE TYPE lifecycle_phase AS ENUM ('WAPPR','APPROVED','INPRG','COMP','CLOSED');
CREATE TYPE block_reason   AS ENUM ('NONE','MATERIAL','PLANT_CONDITION','SCHEDULE');

-- 2. user_profiles table + trigger on auth.users INSERT
CREATE TABLE user_profiles (id UUID PK FK→auth.users, role TEXT DEFAULT 'TECHNICIAN', ...);
CREATE FUNCTION sync_user_profile() RETURNS TRIGGER ...;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users ...;

-- 3. audit_logs table + generic trigger function
CREATE TABLE audit_logs (id UUID, table_name TEXT, record_id UUID, action TEXT,
                         old_data JSONB, new_data JSONB, changed_by UUID, changed_at TIMESTAMPTZ);
CREATE FUNCTION audit_trigger_func() RETURNS TRIGGER ...;  -- uses TG_TABLE_NAME, OLD, NEW
CREATE TRIGGER work_orders_audit AFTER INSERT OR UPDATE OR DELETE ON work_orders ...;

-- 4. Helper function + RLS base
CREATE FUNCTION get_user_role() RETURNS TEXT ...;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- audit_logs: INSERT via trigger, SELECT solo ADMIN
```

### Migration 2: `<timestamp>_work_orders_iso14224.sql`

```sql
-- 1. DROP old table (cascade to audit trigger, will be re-created)
DROP TABLE IF EXISTS work_orders CASCADE;

-- 2. CREATE new ISO 14224 table
CREATE TABLE work_orders (
    id UUID PK DEFAULT gen_random_uuid(),
    asset_id UUID FK→assets(id),
    equipment_id VARCHAR NOT NULL,
    wo_type TEXT NOT NULL DEFAULT 'corrective',

    -- Lifecycle
    lifecycle_phase lifecycle_phase NOT NULL DEFAULT 'WAPPR',
    block_reason block_reason NOT NULL DEFAULT 'NONE',

    -- Timestamps (all TIMESTAMPTZ, nullable)
    reported_at, approved_at, planned_start_at, actual_start_at,
    completed_at, closed_at, machine_down_at, machine_up_at,

    -- ISO 14224 failure taxonomy
    failure_class VARCHAR, problem_code VARCHAR, cause_code VARCHAR, remedy_code VARCHAR,

    -- Operational context
    criticality VARCHAR, asset_class VARCHAR, part_in_process VARCHAR,

    -- Structured notes
    symptom_note TEXT, cause_note TEXT, action_note TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FSM trigger (BEFORE UPDATE)
CREATE FUNCTION validate_lifecycle_fsm() RETURNS TRIGGER ...;
CREATE TRIGGER work_orders_fsm BEFORE UPDATE ON work_orders ...;
-- Validates: WAPPR→APPROVED→INPRG→COMP→CLOSED, forward-only

-- 4. Re-apply audit trigger (was dropped by CASCADE)
CREATE TRIGGER work_orders_audit AFTER INSERT OR UPDATE OR DELETE ON work_orders ...;

-- 5. RLS policies
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
-- Each policy uses get_user_role() to match the role matrix
-- ADMIN: CRUD, PLANNER: CRUD, TECHNICIAN: UPDATE limited fields, STOREKEEPER: SELECT
```

---

## Edge Function Update Plan

**File**: `supabase/functions/oee-trigger/index.ts`

| Cambio | Detalle |
|--------|---------|
| `insertWorkOrder()` signature | Sin cambios — recibe `asset` + `sintoma` |
| `workOrder` object | Reemplazar `description: "[OEE TRIGGER]..."` por `symptom_note: sintoma` |
| `lifecycle_phase` | Nuevo campo: `lifecycle_phase: "WAPPR"` |
| `block_reason` | Nuevo campo: `block_reason: "NONE"` |
| `status: "pending"` | Eliminar (columna borrada) |
| `actual_hours, cost_estimate, actual_cost, percentage_complete, _conflict, _deleted` | Eliminar (columnas borradas) |
| `planned_hours` | Conservar (sigue existiendo) |

**Sin cambios**: `validateAuth()`, `validatePayload()`, `lookupAsset()`, `handleRequest()`.

**Tests** (`index_test.ts`): Actualizar expectativas de `insertWorkOrder` — verificar que `symptom_note` recibe el `sintoma`, verificar que `lifecycle_phase` es `'WAPPR'`.

---

## Testing Strategy

| Capa | Qué probar | Enfoque |
|------|-----------|---------|
| Unit | `get_user_role()` function | Consultar como diferentes usuarios autenticados |
| Unit | FSM trigger transitions | Matriz 5×5 exhaustiva: todas las combinaciones de lifecycle_phase |
| Unit | `audit_trigger_func()` generic | Aplicar a tabla temporal, verificar INSERT/UPDATE/DELETE |
| Integration | Edge Function con nuevo schema | POST con payload válido, verificar `lifecycle_phase='WAPPR'`, `symptom_note` |
| Integration | RLS por rol | 4 usuarios con diferentes roles, verificar CRUD permitido/rechazado |
| Migration | Rollback de migraciones | Ejecutar migraciones 1 y 2, verificar `\dt`, revertir |

---

## Open Questions

- [ ] `asset_id` debería ser UUID (FK a `assets.id`) o TEXT? La spec de work-order-database usaba TEXT. Para ISO 14224 usamos UUID FK directo.
- [ ] `created_by` en work_orders: se debe poblar desde `auth.uid()` o via aplicación? Si via trigger, el trigger necesita contexto del usuario actual.
