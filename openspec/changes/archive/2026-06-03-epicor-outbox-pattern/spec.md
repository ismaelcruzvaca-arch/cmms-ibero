# Spec: epicor-outbox-pattern

## Purpose

Transactional Outbox Pattern para entrega garantizada de eventos CMMS → Epicor. Los eventos se persisten en la misma transacción de base de datos, desacoplando CMMS de la disponibilidad del ERP.

## State Machine

```
PENDING ──→ PROCESSING ──→ SENT
                  │
                  └──→ FAILED
```

## Requirements

### R1: Tabla epicor_outbox

The system MUST persist a table `epicor_outbox` with a CHECK constraint restricting status to `PENDING`, `PROCESSING`, `SENT`, `FAILED`.

#### Scenario: Status constraint rejects invalid states

- GIVEN `epicor_outbox` exists with CHECK constraint
- WHEN an INSERT sets status to an invalid value (e.g., `'INVALID'`)
- THEN the constraint MUST reject the operation

### R2: Encolado automático en material_requests

The system MUST automatically enqueue an `epicor_outbox` row with `event_type = 'MATERIAL_REQUEST_CREATE'` on every INSERT into `material_requests`, in the same database transaction.

#### Scenario: Trigger crea registro en outbox

- GIVEN `material_requests` accepts a new row
- WHEN the INSERT completes
- THEN an `epicor_outbox` row MUST exist with `status = 'PENDING'` and `next_retry_at <= NOW()`

### R3: Payload íntegro del evento

The enqueued event MUST contain `material_request_id`, `work_order_id`, `part_num`, `requested_qty`, and `line_desc` in the JSONB payload.

#### Scenario: Payload contiene todos los campos

- GIVEN a new `material_requests` row is inserted
- WHEN the trigger fires
- THEN the `payload` MUST include all five fields
- AND `payload->>'requested_qty'` MUST match the INSERT value

### R4: Índice de polling eficiente

The system MUST create a composite index on `(status, next_retry_at)` for efficient polling of pending events.

#### Scenario: Index supports adapter queries

- GIVEN the adapter queries `WHERE status = 'PENDING' AND next_retry_at <= NOW()`
- WHEN the index exists on `(status, next_retry_at)`
- THEN the query SHALL use an index scan
