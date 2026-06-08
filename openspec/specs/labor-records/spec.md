# Spec: labor-records

## Requirements

### R1: work_orders.actual_hours Column

El sistema DEBE agregar una columna `work_orders.actual_hours NUMERIC DEFAULT 0` para la suma automática de horas al cerrar la OT (COMP → CLOSED).

#### Scenario: Auto-sum on COMP→CLOSED

- GIVEN a work order in COMP phase with multiple labor_records
- WHEN lifecycle transitions to CLOSED
- THEN work_orders.actual_hours MUST equal SUM of all labor_records.hours_worked for that WO

### R2: labor_records Table Schema

El sistema DEBE proveer una tabla `labor_records` con:
- `id` UUID PK DEFAULT gen_random_uuid()
- `work_order_id` TEXT NOT NULL FK REFERENCES work_orders(id)
- `technician_id` UUID NOT NULL FK REFERENCES user_profiles(id)
- `start_time` TIMESTAMPTZ NOT NULL
- `end_time` TIMESTAMPTZ (nullable — NULL = sesión activa)
- `hours_worked` NUMERIC GENERATED ALWAYS AS (EXTRACT(EPOCH FROM COALESCE(end_time, NOW()) - start_time) / 3600) STORED
- `activity_code` TEXT NOT NULL
- `notes` TEXT
- `device_timestamp` TIMESTAMPTZ (para reconciliación offline de relojes)
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- `updated_at` TIMESTAMPTZ DEFAULT NOW()

#### Scenario: Insert valid labor record

- GIVEN a work order and technician exist
- WHEN a labor record is inserted with valid activity_code, work_order_id, and technician_id
- THEN the record is persisted with hours_worked auto-calculated

### R3: Activity Code CHECK Constraint

`activity_code` DEBE tener un CHECK constraint limitando los valores a: `'DIRECT_WORK'`, `'WAIT_MATERIAL'`, `'WAIT_PERMIT'`, `'TRAVEL'`, `'BREAK'`.

#### Scenario: Invalid activity code rejected

- GIVEN a labor record insert with activity_code 'INVALID'
- WHEN the insert is executed
- THEN it MUST fail with a CHECK constraint violation

### R4: Composite Index

Índice compuesto `(work_order_id, technician_id)` para consultas por OT + técnico.

### R5: Technician Chronological Index

Índice `(technician_id, start_time DESC)` para historial cronológico del técnico.

### R6: Defensive FSM Validation (Client-Driven)

El sistema DEBE proveer triggers defensivos. El cliente (RxDB) crea y cierra labor_records — el servidor solo VALIDA.

- **trg_validate_labor_fsm()** (BEFORE INSERT OR UPDATE ON labor_records):
  - INSERT con `end_time=NULL`: verifica que la WO existe y está en `INPRG`; caso contrario RAISE EXCEPTION
  - UPDATE: verifica que el técnico es el dueño del registro (technician_id = auth.uid() para no-admin)
- **trg_labor_sum_hours()** (BEFORE UPDATE ON work_orders, solo en transición COMP → CLOSED): suma todas las `hours_worked` de `labor_records` para esa WO y guarda en `work_orders.actual_hours`
- **trg_labor_records_updated_at**: actualiza `updated_at = NOW()` automáticamente
- NO hay triggers de auto-creación. El servidor NO crea labor_records basado en transiciones de ciclo de vida.

#### Scenario: Active session requires INPRG

- GIVEN a work order in WAPPR phase
- WHEN a labor_record is inserted with end_time=NULL (active session)
- THEN the insert MUST be rejected — only INPRG work orders can have active sessions

#### Scenario: Active session allowed in INPRG

- GIVEN a work order in INPRG phase
- WHEN a labor_record is inserted with end_time=NULL, activity_code='DIRECT_WORK'
- THEN the record is persisted

#### Scenario: Update sets updated_at

- GIVEN an existing labor_record
- WHEN the record is updated (e.g., end_time set)
- THEN updated_at changes from its previous value

### R7: Row-Level Security

El sistema DEBE enforce RLS en `labor_records`:
- **TECHNICIAN**: SELECT, INSERT, UPDATE solo sus propios registros (technician_id = auth.uid())
- **PLANNER**: SELECT todos los registros
- **ADMIN**: ALL operations en cualquier registro

#### Scenario: Technician sees only own records

- GIVEN two technicians with labor_records for different WOs
- WHEN technician A queries labor_records
- THEN only records WHERE technician_id = auth.uid() are returned

### R8: Client-Driven Creation (No Server Auto-Create)

Todos los INSERT/UPDATE pasan por validación del servidor. El cliente (RxDB) crea los registros atómicamente con las transiciones de la WO. El servidor NO auto-crea nada.

## States Machine

```
labor_records (por registro):
  [INSERT con end_time=NULL] → sesión activa
  [UPDATE set end_time=NOW()] → sesión cerrada (hours_worked se calcula automáticamente)

labor_records + work_orders (orquestación cliente):
  Cliente crea registro activo + opcionalmente transiciona WO a INPRG
  Cliente cierra sesión + opcionalmente transiciona WO a COMP si no quedan sesiones activas
  Servidor: COMP → CLOSED → trg_labor_sum_hours() suma horas definitivas
```
