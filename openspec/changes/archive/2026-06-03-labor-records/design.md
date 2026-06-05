# Design: labor-records

## Technical Approach

Capa de base de datos pura: migración única que crea la tabla `labor_records`, agrega `actual_hours` a `work_orders`, implementa tres triggers (FSM defensivo, auto-sum en cierre, actualización de `updated_at`), y configura RLS por rol. Es el **backend database layer** del feature de labor-reporting — el frontend (ClockWidget, RxDB, hooks) se cubre en el cambio `labor-reporting`. El servidor solo valida; nunca auto-crea registros.

## Architecture Decisions

### Decision: `hours_worked` como GENERATED ALWAYS AS STORED

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **GENERATED ALWAYS AS (end_time - start_time) / 3600 STORED** | Cálculo en servidor, preciso, no requiere lógica aplicación | ✅ **Chosen** |
| Cálculo en aplicación | Drift por timezone, datos inconsistentes ante concurrencia | Rejected |

**Rationale**: Al ser una columna generada, `hours_worked` es siempre consistente con `start_time` y `end_time`. No hay riesgo de que la aplicación escriba un valor incorrecto o desincronizado. Cuando `end_time IS NULL`, la expresión devuelve NULL — el trigger `trg_labor_sum_hours` solo se ejecuta en COMP→CLOSED (cuando todas las sesiones están cerradas), así que no hay riesgo de sumar NULLs.

### Decision: Triggers defensivos (NO auto-creación)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Trigger `trg_validate_labor_fsm` solo valida, NO crea registros** | El cliente orquesta; el servidor rechaza estados inválidos | ✅ **Chosen** |
| Trigger BEFORE INSERT ON work_orders que auto-crea labor_record al pasar a INPRG | Duplicado fantasma: RxDB crea offline, trigger crea otro al sincronizar. Además no sabe qué technician asignar. | Rejected |

**Rationale**: En una app offline-first, el cliente es el creador de registros. RxDB escribe atómicamente (en lógica de aplicación, no transacción multi-colección) las dos operaciones (WO→INPRG + INSERT labor_record). Si el servidor también creara registros automáticamente, al sincronizar se duplicarían. El trigger defensivo existe para **rechazar** estados inválidos, no para crearlos.

### Decision: RLS por rol con políticas separadas

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Políticas RLS individuales por rol (TECHNICIAN own, PLANNER SELECT, ADMIN ALL)** | Granular, fácil de auditar, cada política tiene una responsabilidad clara | ✅ **Chosen** |
| Una sola política con CASE por rol | Más compacta pero menos legible y más difícil de depurar | Rejected |

**Rationale**: Cada rol tiene un patrón de acceso distinto (TECHNICIAN CRUD propio, PLANNER solo lectura global, ADMIN todo). Políticas separadas siguen el principio de responsabilidad única y son más fáciles de mantener y auditar.

## Data Flow

```
Clock-in:
  Cliente (RxDB):
    1. INSERT labor_record(start_time=NOW(), activity_code, technician_id)
    2. UPDATE work_orders SET lifecycle_phase='INPRG' (si estaba APPROVED)
    → push sync → Supabase
    → trg_validate_labor_fsm (INSERT): verifica WO existe y está INPRG ✅
    → validate_lifecycle_fsm() (UPDATE WO): verifica transición válida ✅

Clock-out:
  Cliente (RxDB):
    1. UPDATE labor_record SET end_time=NOW()
    2. Si no quedan sesiones activas → UPDATE work_orders SET lifecycle_phase='COMP'
    → push sync → Supabase
    → trg_validate_labor_fsm (UPDATE): verifica pertenencia al técnico ✅
    → validate_lifecycle_fsm() (UPDATE WO): APPROVED/INPRG → COMP ✅

Cierre de WO (COMP → CLOSED):
  Usuario PLANNER/ADMIN transiciona WO a CLOSED
    → trg_labor_sum_hours (BEFORE UPDATE):
      SELECT COALESCE(SUM(hours_worked), 0) INTO work_orders.actual_hours
      FROM labor_records WHERE work_order_id = OLD.id
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260526000002_labor_records.sql` | **Create** | DDL completo: ALTER work_orders + CREATE labor_records + índices + triggers + RLS |
| `supabase/seed.sql` | Modify | Seed opcional con registros de labor de ejemplo (si aplica) |

## Interfaces

### work_orders (modificado)

```sql
actual_hours NUMERIC DEFAULT 0
-- Suma total de horas trabajadas, calculada al cerrar la OT vía trg_labor_sum_hours
```

### labor_records Schema

```sql
CREATE TABLE labor_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     TEXT NOT NULL REFERENCES work_orders(id),
  technician_id     UUID NOT NULL REFERENCES user_profiles(id),
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ,
  hours_worked      NUMERIC GENERATED ALWAYS AS (
                      EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
                    ) STORED,
  activity_code     TEXT NOT NULL CHECK (activity_code IN (
                      'DIRECT_WORK','WAIT_MATERIAL','WAIT_PERMIT','TRAVEL','BREAK'
                    )),
  notes             TEXT,
  device_timestamp  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Triggers

- **`trg_validate_labor_fsm()`** — BEFORE INSERT OR UPDATE ON labor_records:
  - INSERT con `end_time IS NULL`: verifica WO existe y `lifecycle_phase = 'INPRG'`
  - UPDATE (no-admin): verifica `technician_id = auth.uid()`
  - Raise EXCEPTION con mensaje descriptivo si falla

- **`trg_labor_sum_hours()`** — BEFORE UPDATE ON work_orders:
  - Solo en `OLD.lifecycle_phase = 'COMP' AND NEW.lifecycle_phase = 'CLOSED'`
  - `SELECT COALESCE(SUM(hours_worked), 0) INTO NEW.actual_hours FROM labor_records WHERE work_order_id = OLD.id`

- **`trg_labor_records_updated_at()`** — BEFORE UPDATE ON labor_records:
  - `NEW.updated_at = NOW()`

### RLS Policies

| Policy | Role | Operation | Filter |
|--------|------|-----------|--------|
| `labor_records_select_technician` | TECHNICIAN | SELECT | `technician_id = auth.uid()` |
| `labor_records_insert_technician` | TECHNICIAN | INSERT | `technician_id = auth.uid()` |
| `labor_records_update_technician` | TECHNICIAN | UPDATE | `technician_id = auth.uid()` |
| `labor_records_select_planner` | PLANNER | SELECT | todas |
| `labor_records_all_admin` | ADMIN | ALL | todas |

### Índices

```sql
CREATE INDEX idx_labor_records_wo_tech ON labor_records (work_order_id, technician_id);
CREATE INDEX idx_labor_records_tech_start ON labor_records (technician_id, start_time DESC);
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| DB | Schema constraints (CHECK, GENERATED, FK, PK) | pgTAP: verificar columnas, tipos, defaults |
| DB | RLS aislamiento por rol | pgTAP: testear cada policy con diferentes roles simulados |
| DB | FSM trigger: INSERT válido (WO en INPRG) e inválido (WO en otro estado) | pgTAP: escenarios con `set_config('role', ...)` |
| DB | FSM trigger: UPDATE no-admin sobre registro ajeno debe rechazar | pgTAP: verificar RAISE EXCEPTION |
| DB | COMP→CLOSED auto-sum: verificar actual_hours se calcula correctamente | pgTAP: insertar registros, transicionar WO, verificar suma |

## Migration Plan

1. Ejecutar migración `20260526000002_labor_records.sql` (idempotente — usa `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`)
2. No hay data migration necesaria (tabla nueva, columna nueva con DEFAULT 0)
3. Rollback: migración inversa que DROP table, DROP triggers, REMOVE column actual_hours
