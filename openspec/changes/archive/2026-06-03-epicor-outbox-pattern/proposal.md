# Proposal: epicor-outbox-pattern

## Intent

Desacoplar CMMS de la disponibilidad del ERP Epicor. Sin outbox, una caída de red o timeout de Epicor pierde solicitudes de material para siempre. Con Transactional Outbox, los eventos se persisten en la misma transacción de base de datos y un adaptador futuro los entrega con reintentos.

## Scope

### In Scope
- Tabla `epicor_outbox` con ciclo de vida PENDING → PROCESSING → SENT | FAILED
- Trigger `trg_enqueue_material_request` que encola automáticamente en `material_requests` AFTER INSERT
- Índice compuesto `(status, next_retry_at)` para polling eficiente del adaptador
- pgTAP tests (9/9) que verifican encolado automático y payload íntegro

### Out of Scope
- Adaptador de envío REST/SOAP/middleware (futuro, externo a esta tabla)
- Dead-letter queue o archivo de eventos fallidos
- Dashboard de monitoreo de la outbox
- Eventos para otros tipos además de MATERIAL_REQUEST_CREATE

## Capabilities

### New Capabilities
- `epicor-outbox`: Transactional Outbox Pattern para entrega garantizada CMMS → Epicor. Tabla, constraint CHECK de estados, función trigger de encolado, índice de polling.

### Modified Capabilities
- None (cambio puramente infraestructura de integración; no modifica requisitos de specs existentes)

## Approach

Tabla `epicor_outbox` con status CHECK constraint, payload JSONB desacoplado del protocolo de salida. Función `enqueue_material_request()` con `SECURITY DEFINER` que inserta fila en la misma transacción que el INSERT a `material_requests`. Índice compuesto `(status, next_retry_at)` para polling del adaptador futuro.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260526000001_create_epicor_outbox.sql` | New | Migración: tabla + trigger + índice |
| `supabase/migrations/` (pgTAP) | New | Tests: 9 casos de encolado y payload |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sin dead-letter: eventos permanentemente FAILED sin alerta | Medium | `last_error` columna permite debugging manual; alerta futura en dashboard |
| El trigger afecta performance de INSERT en material_requests | Low | Operación mínima (INSERT en tabla local + JSONB build) |

## Rollback Plan

Eliminar trigger y tabla:
```sql
DROP TRIGGER IF EXISTS trg_enqueue_material_request ON material_requests;
DROP TABLE IF EXISTS epicor_outbox CASCADE;
DROP FUNCTION IF EXISTS enqueue_material_request();
```

## Dependencies

- Ninguna. La migración es autónoma.

## Success Criteria

- [ ] 9/9 pgTAP tests pasan en Docker local
- [ ] INSERT en `material_requests` produce automáticamente fila en `epicor_outbox` con status PENDING
- [ ] Payload contiene material_request_id, work_order_id, part_num, requested_qty, line_desc
- [ ] next_retry_at ≤ NOW() inmediatamente después del INSERT
