# Spec: Confiabilidad de Ingesta

## Purpose

Garantizar que toda ingesta sea idempotente, tolerable a fallos transitorios, con outbox + dead-letter para payloads fallidos y reintentos automáticos.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CIR-001 | MUST | Tabla `condition_ingest_outbox`: idempotency_key UNIQUE, payload JSONB, status, retry_count, next_retry_at |
| REQ-CIR-002 | MUST | Tabla `condition_ingest_failures`: payload, error_code, status (pending_retry\|dead_letter\|resolved) |
| REQ-CIR-003 | MUST | Idempotencia: mismo idempotency_key → 409 sin duplicados, key varía por source_type |
| REQ-CIR-004 | MUST | Retry pg_cron: backoff exponencial, máx 3 intentos, luego dead-letter |
| REQ-CIR-005 | MUST | Dead-letter UI: listar fallidos, ver error_message, reprocesar o descartar |

### REQ-CIR-001: Outbox de ingesta

El sistema DEBE mantener `condition_ingest_outbox` con idempotency_key UNIQUE, payload completo en JSONB, status (pending\|processing\|completed\|failed), retry_count y next_retry_at.

#### Scenario: Falla de BD → payload a outbox

- **WHEN**: Ingesta falla por timeout de BD durante INSERT en condition_windows
- **THEN**: Payload completo se escribe en outbox con status=`pending`, retry_count=0

#### Scenario: Outbox recibe payload duplicado

- **WHEN**: Mismo idempotency_key llega a outbox
- **THEN**: Restricción UNIQUE rechaza el duplicado

### REQ-CIR-002: Dead-letter de fallos

El sistema DEBE mover a `condition_ingest_failures` los payloads que agotaron reintentos, con payload JSONB, error_code, status (pending_retry|dead_letter|resolved).

#### Scenario: Payload agota 3 reintentos → dead-letter

- **WHEN**: Payload en outbox falla 3 veces con backoff agotado
- **THEN**: Se mueve a condition_ingest_failures con status=`dead_letter`, error_code del último fallo

#### Scenario: Dead-letter resuelto manualmente

- **WHEN**: Operador corrige causa raíz y selecciona `reprocesar`
- **THEN**: Payload se reintenta, status cambia a `resolved` si exitoso

### REQ-CIR-003: Idempotencia por source_type

El sistema DEBE garantizar idempotencia con claves compuestas según source_type.

| Source Type | Idempotency Key |
|-------------|-----------------|
| edge / api | external_window_id |
| manual | source_id + asset_id + feature_key + method_key + measured_at |
| csv | batch_id + row_number |
| portable | source_id + asset_id + measured_at |

#### Scenario: Misma ventana edge reenviada → 409

- **WHEN**: POST con external_window_id=`edge_001:BANDA-TR-01:2026-06-01T10:00:00Z:v2` ya procesado
- **THEN**: Respuesta 409, sin duplicados en BD

#### Scenario: Manual capture duplicada → 409

- **WHEN**: Mismo source_id + asset_id + feature_key + method_key + measured_at reenviado
- **THEN**: Respuesta 409, sin nuevo registro

### REQ-CIR-004: Retry con pg_cron y backoff

El sistema DEBE ejecutar `retry_failed_ingests()` vía pg_cron con backoff exponencial: 1min → 5min → 15min, máximo 3 intentos.

#### Scenario: Primer retry a 1 minuto

- **WHEN**: Payload en outbox status=`pending`, retry_count=0
- **THEN**: pg_cron intenta reprocesar, next_retry_at se recalcula a +5min si falla

#### Scenario: Tercer retry falla → dead-letter

- **WHEN**: Payload falla por tercera vez (retry_count=3)
- **THEN**: status cambia a `dead_letter`, se inserta en condition_ingest_failures

### REQ-CIR-005: Dead-letter UI

El sistema DEBE proveer panel para listar payloads en dead-letter, ver error_message completo, y botones de reprocesar/descartar.

#### Scenario: Listado de dead-letters

- **WHEN**: Usuario con rol PLANNER/ADMIN accede a DeadLetterPanel
- **THEN**: Ve tabla con source_id, error_code, error_message, created_at, status, y acciones disponibles

#### Scenario: Reprocesar dead-letter exitoso

- **WHEN**: Operador hace clic en `Reintentar` para payload con error corregido
- **THEN**: Payload se envía a ingest-condition, si éxito → status=`resolved`
