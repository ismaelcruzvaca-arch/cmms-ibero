# Spec: epicor-outbox-pattern

## Requirements
- R1: Tabla epicor_outbox con CHECK status constraint
- R2: Índice compuesto (status, next_retry_at) para polling eficiente
- R3: Trigger AFTER INSERT en material_requests → epicor_outbox
- R4: pgTAP test validando encolado automático

## States Machine
PENDING → PROCESSING → SENT | FAILED
