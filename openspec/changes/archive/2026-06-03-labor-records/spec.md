# Spec: labor-records

## Requirements

- R1: Columna `work_orders.actual_hours NUMERIC DEFAULT 0` para suma automática de horas al cerrar la OT
- R2: Tabla `labor_records` con `hours_worked GENERATED ALWAYS AS (end_time - start_time) / 3600 STORED`
- R3: CHECK constraint en `activity_code` limitado a `DIRECT_WORK`, `WAIT_MATERIAL`, `WAIT_PERMIT`, `TRAVEL`, `BREAK`
- R4: `device_timestamp` para reconciliación offline de relojes
- R5: `end_time` nullable (NULL = sesión activa / sin cerrar)
- R6: Índice compuesto `(work_order_id, technician_id)` para consultas por OT + técnico
- R7: Índice `(technician_id, start_time DESC)` para historial cronológico del técnico
- R8: Trigger `trg_validate_labor_fsm` — BEFORE INSERT OR UPDATE en `labor_records`:
  - INSERT con `end_time=NULL`: verifica que la WO existe y está en `INPRG`
  - UPDATE: verifica que el técnico es el dueño del registro (no-admin)
- R9: Trigger `trg_labor_sum_hours` — BEFORE UPDATE en `work_orders`, solo en transición `COMP → CLOSED`: suma todas las `hours_worked` de `labor_records` para esa WO y guarda en `work_orders.actual_hours`
- R10: Trigger `trg_labor_records_updated_at` — actualiza `updated_at` automáticamente
- R11: RLS — TECHNICIAN: SELECT/INSERT/UPDATE solo sus propios registros; PLANNER: SELECT todas; ADMIN: ALL
- R12: Todos los INSERT/UPDATE pasan por validación del servidor — el cliente (RxDB) crea los registros, el servidor NO auto-crea nada

## States Machine

```
labor_records (por registro):
  [INSERT con end_time=NULL] → sesión activa
  [UPDATE set end_time=NOW()] → sesión cerrada (hours_worked se calcula automáticamente)

labor_records + work_orders (orquestación cliente):
  Cliente crea registro activo + opcionalmente transiciona WO a INPRG (atómico desde RxDB)
  Cliente cierra sesión + opcionalmente transiciona WO a COMP si no quedan sesiones activas
  Servidor: COMP → CLOSED → trg_labor_sum_hours() suma horas definitivas
```
