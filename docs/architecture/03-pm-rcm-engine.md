# ADR-03: Preventive & Condition-Based Maintenance Engine (PM/RCM)

**Status**: Approved  
**Date**: 2026-05-22  
**Deciders**: Diego (Arquitecto), Stakeholders CMMS  
**Technical Story**: Implementar el núcleo de mantenimiento preventivo (PM) y basado en condición (CBM) con lógica de scheduling en Postgres, alineado con ISO 14224.

## Context

El CMMS necesita un motor de mantenimiento preventivo y basado en condición que automaticé la generación de órdenes de trabajo recurrentes. A diferencia del mantenimiento correctivo (work_orders), el PM requiere:

- **Planificación anticipada**: Plantillas de trabajo (job_plans) reutilizables entre activos
- **Múltiples disparadores**: Tiempo calendario, lecturas de medidores, o combinación de ambos
- **Programación flotante vs fija**: Una tarea puede recalcularse desde la última ejecución (flotante) o ejecutarse en fechas fijas
- **Cadenas de supresión**: Ciertas tareas de mayor alcance reemplazan (suprimen) tareas más frecuentes
- **Monitoreo de condición**: Sensores/IoT que registran lecturas y disparan alertas cuando se exceden límites

### Flujo de Operación

```
1. Planificador crea job_plans con tareas y materiales
2. Planificador asigna job_plan a activo vía pm_schedule
3. pm_schedule define frecuencia (tiempo, medidor, o ambos)
4. Motor PM (pg_cron + PL/pgSQL) evalúa schedules periódicamente
5. Si schedule está vencido → genera work_order desde job_plan
6. Si hay cadena de supresión, se salta la generación si el padre cubre el período
7. El técnico ejecuta la OT y registra lecturas en meter_readings
8. El motor CBM evalúa lecturas contra measure_points y genera alertas
```

## Decisiones

### ADR-03-01: Lógica de Scheduling en Postgres (no en la aplicación)

**Decisión**: Toda la lógica de fechas flotantes, fijas y supresión de tareas vivirá en PL/pgSQL y se ejecutará con pg_cron.

**Consecuencias**:
- El motor PM ejecuta directamente sobre la base de datos, sin depender de un servicio en Node/Deno
- pg_cron garantiza ejecución puntual independientemente del estado del frontend
- Los algoritmos de IA predictiva consumen datos limpios y consistentes sin desajustes de zona horaria del frontend
- Las funciones PL/pgSQL se versionan como migraciones (no hay lógica de scheduling oculta en el código de la app)
- La generación de work_orders desde job_plans es un proceso atómico transaccional
- **Trade-off**: Depurar PL/pgSQL es más complejo que depurar aplicación; mitigamos con tests de integración sobre la base local

### ADR-03-02: Separación Física de Medidores y Lecturas (Inspiración SAP/Maximo)

**Decisión**: `meters` y `measure_points` son estructuras maestras separadas de `meter_readings` (transaccional).

**Consecuencias**:
- `meters`: Definición del medidor (código, tipo, UOM, activo asociado). Es dato maestro.
- `measure_points`: Límites de alerta por medidor (warning/critical en ambos sentidos). Permite múltiples puntos de medición por medidor (ej: un acelerómetro con mediciones en X, Y, Z).
- `meter_readings`: Serie temporal de lecturas. Es dato transaccional de alta frecuencia.
- Las ráfagas de datos IoT (cientos de lecturas por minuto) no compiten con locks en las tablas maestras
- Las inserciones en meter_readings son livianas — solo valor + fecha + FK al medidor
- `is_alert_triggered` se calcula en INSERT via trigger (o aplicación) comparando contra measure_points
- `meter_type` con CHECK `('CONTINUOUS', 'GAUGE', 'CHARACTERISTIC')`:
  - `CONTINUOUS`: Odómetro, horómetro — lecturas acumulativas (ej: 1000 horas)
  - `GAUGE`: Lectura puntual (ej: 85°C, 120 PSI)
  - `CHARACTERISTIC`: Valor cualitativo codificado (ej: nivel de desgaste 1-5)

### ADR-03-03: intervention_type para Mantenimiento Imperfecto

**Decisión**: `job_plans.intervention_type` clasifica el alcance de la intervención usando CHECK constraint con valores `('INSPECTION', 'LUBRICATION', 'MINOR_SERVICE', 'OVERHAUL')`.

**Consecuencias**:
- Permite modelar Mantenimiento Imperfecto: después de una intervención, el activo no queda "como nuevo" — su tasa de degradación cambia según el tipo de intervención
- `INSPECTION`: Solo revisión, sin reemplazo de partes — degradación continúa
- `LUBRICATION`: Mantenimiento básico — restauración parcial
- `MINOR_SERVICE`: Intervención menor — restauración significativa
- `OVERHAUL`: Revisión mayor — el activo vuelto a línea base (como nuevo)
- Los algoritmos de IA predictiva usan este campo para modelar degradación post-intervención
- `estimated_hours` permite planificar capacidad de mano de obra

### ADR-03-04: Programación con Frecuencias Separadas (Tiempo + Medidor)

**Decisión**: `pm_schedules` usa columnas separadas `time_frequency_days` e `meter_frequency_value` en lugar de un JSONB genérico.

**Consecuencias**:
- Un schedule puede tener frecuencia por tiempo, por medidor, o ambas
- `is_floating = true`: La próxima fecha se recalcula desde `last_completion_date` (flotante)
- `is_floating = false`: La próxima fecha se calcula desde la fecha de creación del schedule (fija)
- `meter_frequency_value` es NULL si el schedule es solo por tiempo
- `time_frequency_days` es NULL si el schedule es solo por medidor
- El motor PM evalúa ambas condiciones y genera la OT si ALGUNA de las dos se cumple (OR lógico)
- `next_target_date` se precálcula en inserción y se actualiza tras cada ejecución

### ADR-03-05: Cadenas de Supresión con Auto-Referencia

**Decisión**: La supresión se modela con `parent_schedule_id` auto-referenciado más `suppression_multiplier`.

**Consecuencias**:
- Un schedule hijo (más frecuente) puede ser suprimido por un schedule padre (menos frecuente, mayor alcance)
- Ejemplo: OVERHAUL cada 12 meses suprime INSPECTION mensual si el OVERHAUL cubre ese mes
- `suppression_multiplier`: Cada N ejecuciones del hijo, una es reemplazada por el padre
- La lógica de supresión evalúa: si el padre se ejecutó dentro de la ventana de tiempo del hijo, el hijo no genera OT
- La auto-referencia permite cadenas de N niveles sin límite arbitrario
- `parent_schedule_id` es NULL para schedules raíz (sin supresor)

### ADR-03-06: RBAC Inquebrantable para PM/CBM

**Decisión**: Las tablas del módulo PM/CBM siguen la jerarquía de roles existente, con políticas que ningún técnico puede modificar datos maestros de planificación.

**Consecuencias**:

**Grupo 1 — Datos Maestros y Autómata** (job_plans, job_plan_tasks, job_plan_materials, pm_schedules, meters, measure_points):

| Operación | Roles permitidos |
|-----------|-----------------|
| SELECT | Todos los authenticated |
| INSERT | PLANNER, ADMIN |
| UPDATE | PLANNER, ADMIN |
| DELETE | PLANNER, ADMIN |

- Un técnico (TECHNICIAN) jamás modifica planes preventivos ni frecuencias
- Solo el planificador (PLANNER) y el ADMIN tienen privilegios de escritura sobre la configuración del motor PM

**Grupo 2 — Datos Transaccionales** (meter_readings):

| Operación | Roles permitidos |
|-----------|-----------------|
| SELECT | Todos los authenticated |
| INSERT | TECHNICIAN, PLANNER, ADMIN |
| UPDATE | Solo ADMIN |
| DELETE | Solo ADMIN |

- El técnico captura lecturas en piso (INSERT) pero no puede modificar lecturas históricas
- Las lecturas son funcionalmente inmutables para el técnico — protege la integridad de los modelos predictivos
- Solo ADMIN puede corregir lecturas erróneas (UPDATE/DELETE)
- La función `get_user_role()` definida en ADR-01 (RBAC) se reutiliza en todas las políticas

### ADR-03-07: CHECK Constraints sobre ENUMs PostgreSQL

**Decisión**: Validar intervention_type y meter_type con CHECK constraints en lugar de tipos ENUM.

**Consecuencias**:
- Los CHECK constraints son más flexibles para migraciones futuras (no requieren ALTER TYPE)
- No hay necesidad de mantener un tipo ENUM en el catálogo de Postgres
- Los valores válidos son explícitos en la DDL y visibles en information_schema
- La aplicación Frontend/API debe mantener su propia validación paralela
- Si los valores cambian, solo se modifica el CHECK (ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT)

## Diagrama Entidad-Relación (Texto)

```
job_plans 1──N job_plan_tasks
job_plans 1──N job_plan_materials

assets        1──N pm_schedules
job_plans     1──N pm_schedules
pm_schedules  1──N pm_schedules (self-FK: supresión)

assets       1──N meters
meters       1──N measure_points
meters       1──N meter_readings
```

## Migraciones

| Migration | Descripción |
|-----------|-------------|
| `20260522000001` | Creación de 7 tablas + constraints + índices + RLS |
| `20260522000002` | Fix de RLS: reemplaza políticas abiertas por RBAC granular |
| `20260524000001` | CBM Alert Trigger: trigger en meter_readings + anti-spam + auto WO |
| `20260524000002` | PM Engine Automata: generate_due_preventive_work_orders() con supresión jerárquica |

### Fase 2 Implementada — Automatización PM/CBM

**Migration**: `20260524000001_cbm_alert_trigger.sql` — CBM Alert Trigger
**Migration**: `20260524000002_pm_engine_automata.sql` — PM Engine Automata
**Artefactos SDD**: `openspec/changes/pm-rcm-engine-phase-1/`

| Componente | Descripción | Estado |
|------------|-------------|--------|
| `trg_meter_reading_cbm` | BEFORE INSERT trigger en meter_readings; evalúa 4 cuadrantes warning/critical, anti-spam por activo+medidor, genera OT para casos críticos | ✅ Implementado, testeado en producción |
| `generate_due_preventive_work_orders()` | CTE recursiva con supresión jerárquica, herencia de materiales, recálculo fijo de reloj | 🟡 Implementado, PENDIENTE de verificación (bloqueado por schema drift) |

### Fase 3 (Próxima)

Pendiente para completar el motor de ejecución:
- pg_cron scheduling de `generate_due_preventive_work_orders()` (o Supabase Cron Jobs)
- Vista materializada `pm_due_calendar` para el planificador
- Edge Function `pm-engine` como interfaz de administración
- Soporte para `is_floating = true` (recálculo desde `last_completion_date` en vez de fecha fija)

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| PL/pgSQL complejo de depurar | Tests de integración sobre base local Docker + logging en audit_logs |
| pg_cron no disponible en Supabase Managed | Evaluar pg_cron extension vs Supabase Cron Jobs (Edge Functions) |
| Cadenas de supresión pueden crear ciclos infinitos | Validación CHECK previene parent_schedule_id = id; lógica de negocio limita profundidad |
| IoT bursts en meter_readings pueden saturar | meter_readings sin FK a work_orders (solo a meters); índice DESC en reading_date para queries de serie temporal |
| Desajuste de zona horaria en fechas | Todas las fechas en TIMESTAMPTZ; next_target_date se calcula en el servidor (PL/pgSQL), nunca en el frontend |
