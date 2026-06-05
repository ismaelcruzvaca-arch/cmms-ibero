# Tasks: labor-records

## Phase 1: Database Schema

- [x] 1.1 Agregar columna `actual_hours NUMERIC DEFAULT 0` a `work_orders` con `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- [x] 1.2 Crear tabla `labor_records` con columnas: id (UUID PK), work_order_id (FK → work_orders), technician_id (FK → user_profiles), start_time (NOT NULL), end_time (nullable), hours_worked (GENERATED ALWAYS AS STORED), activity_code (CHECK), notes, device_timestamp, created_at, updated_at
- [x] 1.3 Agregar índices: `(work_order_id, technician_id)` y `(technician_id, start_time DESC)`
- [x] 1.4 Agregar `COMMENT ON` descriptivos para tabla y cada columna

## Phase 2: Triggers

- [x] 2.1 Crear `trg_labor_records_updated_at` — BEFORE UPDATE ON labor_records, asigna `NEW.updated_at = NOW()`
- [x] 2.2 Crear `trg_validate_labor_fsm()` — BEFORE INSERT OR UPDATE ON labor_records:
  - INSERT con end_time=NULL: validar WO existe y está en INPRG, si no → RAISE EXCEPTION
  - UPDATE (no-admin): validar technician_id = auth.uid(), si no → RAISE EXCEPTION
- [x] 2.3 Crear `trg_labor_sum_hours()` — BEFORE UPDATE ON work_orders, solo en COMP→CLOSED: SUM labor_records.hours_worked → work_orders.actual_hours

## Phase 3: Row Level Security

- [x] 3.1 Habilitar RLS en `labor_records` (`ALTER TABLE ENABLE ROW LEVEL SECURITY`)
- [x] 3.2 Política TECHNICIAN SELECT: solo registros donde `technician_id = auth.uid()`
- [x] 3.3 Política TECHNICIAN INSERT: con CHECK `technician_id = auth.uid()`
- [x] 3.4 Política TECHNICIAN UPDATE: USING + WITH CHECK `technician_id = auth.uid()`
- [x] 3.5 Política PLANNER SELECT: todas las filas
- [x] 3.6 Política ADMIN ALL: todas las filas, todas las operaciones

## Phase 4: Verificación

- [x] 4.1 Verificar migración ejecutada correctamente en entorno de desarrollo
- [x] 4.2 Verificar RLS con diferentes roles (TECHNICIAN ve solo propios, PLANNER ve todos, ADMIN todo)
- [x] 4.3 Verificar trigger FSM: INSERT con WO en INPRG ok, INSERT con WO en otro estado rechazado
- [x] 4.4 Verificar trigger FSM: UPDATE no-admin sobre registro ajeno rechazado
- [x] 4.5 Verificar COMP→CLOSED auto-sum: hours_worked se acumula correctamente en actual_hours
- [x] 4.6 Verificar despliegue en producción sin errores
