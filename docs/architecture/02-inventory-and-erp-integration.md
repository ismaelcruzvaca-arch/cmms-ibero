# ADR-02: Inventory Management & Epicor ERP Integration

**Status**: Approved  
**Date**: 2026-05-21  
**Deciders**: Ismael Cruz (Arquitecto), Stakeholders CMMS  
**Technical Story**: Implementar topología física de inventario (ISO 14224) y estructura de datos para integración financiera con Epicor ERP.

## Context

El CMMS necesita gestionar refacciones y materiales asociados a órdenes de trabajo y activos, con integración bidireccional hacia Epicor ERP para sincronización de inventario y contabilidad. No existe un módulo de almacén actualmente.

### Flujo Transaccional

```
1. Mecánico genera Requisición (material_request) desde una OT en INPRG
2. La requisición puede ser:
   a. **Catalogada**: part_num apunta a spare_parts (Stock Item en Epicor)
   b. **No Catalogada (Non-Stock)**: is_non_stock=true, line_desc describe el material
3. La requisición se envía a Epicor vía BPM Outbound → Erp.RcvDtl
4. Epicor procesa y responde con confirmación + número de transacción
5. El consumo se registra como inventory_transaction (ISSUE/DIRECT_ISSUE)
6. Epicor actualiza saldos vía Feedback Loop (Erp.RcvDtl → CMMS)
```

### Consumo Directo (STK-UKN)

Las transacciones de Consumo Directo (STK-UKN en Epicor) ocurren cuando:
- El material se retira de almacén sin requisición previa
- Se registran como `DIRECT_ISSUE` en inventory_transactions
- Solo aplica para partes catalogadas (con part_num)
- El BPM Outbound en Epicor (Erp.RcvDtl) recibe el evento y actualiza el inventario

### Non-Stock Items

Materiales que no tienen número de parte en el catálogo (sin `part_num`):
- Se identifican con `is_non_stock = true` en material_requests
- `line_desc` contiene la descripción textual del material
- `part_num` es NULL
- Expense Code (`expense_code`) mapea a la cuenta contable en Epicor
- No pasan por spare_parts ni inventory_transactions con part_num

### PurType "O" (Orden de Compra)

Las requisiciones con PurType "O" en Epicor:
- Se originan desde el CMMS como material_requests
- El `req_num` y `req_line` mapean al Requisition Header/Line en Epicor
- El Feedback Loop actualiza el estado cuando Epicor confirma la recepción

## Decisiones

### ADR-02-01: Topología Física ISO 14224

**Decisión**: Implementar jerarquía Almacén → Ubicación (Storeroom → Bin) como separación física, no lógica.

**Consecuencias**:
- `storerooms` representa un almacén físico (ej: "Almacén Central", "Almacén Planta 1")
- `storeroom_bins` representa una ubicación física dentro del almacén (ej: "A-01-01")
- Una transacción de inventario puede referenciar storeroom (sin bin) para recepciones, o storeroom + bin para ubicaciones específicas
- El `site_id` en storerooms permite multi-site sin tabla de sites dedicada por ahora

### ADR-02-02: Catálogo de Partes Plano

**Decisión**: `spare_parts` usa `part_num TEXT UNIQUE` como PK natural, mapeando directamente al PartNum de Epicor.

**Consecuencias**:
- Sin surrogate key — el part_num ES el identificador, igual que en Epicor
- `track_lots` y `track_serial` habilitan trazabilidad por lote/serie
- Las partes se relacionan con activos vía `asset_spare_parts` (BOM)
- Una parte puede estar asociada a múltiples activos (parte genérica)

### ADR-02-03: Solicitudes con Soporte Non-Stock

**Decisión**: `material_requests` permite que `part_num` sea NULL cuando `is_non_stock = true`.

**Consecuencias**:
- `line_desc` es obligatorio SIEMPRE (catalogado o no) — describe el material solicitado
- `expense_code` enlaza con la cuenta contable de Epicor
- `req_num` y `req_line` almacenan el número de requisición de Epicor post-sincronización
- La vista de integración filtra por `is_non_stock` para determinar el endpoint Epicor

### ADR-02-04: Transacciones de Inventario con Tipo Enum

**Decisión**: `inventory_transactions.transaction_type` usa un enum PostgreSQL con valores ISSUE, RETURN, DIRECT_ISSUE, RECEIPT.

**Consecuencias**:
- `ISSUE`: Consumo con requisición (material_request → inventory_transaction)
- `RETURN': Devolución de material a almacén
- `DIRECT_ISSUE`: Consumo directo STK-UKN sin requisición
- `RECEIPT`: Recepción de compra desde Epicor
- `work_order_id` siempre presente en ISSUE/DIRECT_ISSUE para trazabilidad
- `reason_code` documenta el motivo (avería, programado, emergencia, etc.)

### ADR-02-05: Feedback Loop BPM Outbound (Erp.RcvDtl)

**Decisión**: El BPM Outbound de Epicor (Erp.RcvDtl) es el mecanismo de integración — CMMS envía, Epicor confirma.

**Consecuencias**:
- `outbox_messages` (tabla existente) se usa como cola de salida hacia Epicor
- inventory_transactions se crean FIRST en CMMS (offline-first), luego se sincronizan
- El campo `epicor_endpoint` en outbox_messages identifica el endpoint BPM
- El Feedback Loop actualiza los campos de integración en material_requests (req_num, req_line)
- En caso de error, el BPM responde con código de error en outbox_messages.last_error

### ADR-02-06: Perfil de Usuario con Empleado ERP

**Decisión**: Agregar `erp_employee_num` a `user_profiles` para mapear usuarios CMMS → empleados Epicor.

**Consecuencias**:
- Vincular cada usuario del sistema con su EmployeeNum en Epicor
- Usado en requisiciones (`requested_by`) y transacciones (`changed_by` audit trail)
- Unique constraint para evitar duplicados
- Se crea la tabla `user_profiles` si no existe

## Diagrama Entidad-Relación (Texto)

```
storerooms 1──N storeroom_bins
storerooms 1──N inventory_transactions (storeroom_id)
storeroom_bins 1──N inventory_transactions (bin_id)

spare_parts 1──N asset_spare_parts
assets     1──N asset_spare_parts

spare_parts 1──N material_requests (part_num, nullable)
spare_parts 1──N inventory_transactions (part_num, nullable)

work_orders 1──N material_requests
work_orders 1──N inventory_transactions

auth.users 1──1 user_profiles
```

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| part_num como PK natural puede cambiar en Epicor | Usar TEXT sin FK a Epicor; el part_num se trata como identificador externo |
| Non-Stock items sin trazabilidad | `line_desc` obligatorio + expense_code para contabilidad |
| BPM Outbound puede fallar | outbox_messages con retry_count, max_retries, last_error |
| Multi-site sin tabla sites | site_id UUID en storerooms, se agrega FK cuando exista la tabla |
