# Design: epicor-outbox-pattern

## Technical Approach

Tabla `epicor_outbox` con ciclo de vida CHECK constraint. Función trigger `enqueue_material_request()` con `SECURITY DEFINER` que inserta fila en la misma transacción que el INSERT a `material_requests`. Índice compuesto `(status, next_retry_at)` para polling del adaptador futuro. El payload JSONB está desacoplado del protocolo de salida (REST/SOAP/middleware).

## Architecture Decisions

### Decision: SECURITY DEFINER trigger (NOT client-side enqueue)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Trigger en la misma transacción** | Zero code changes en app, garantía atómica, no hay riesgo de olvidar llamar a una función | ✅ **Chosen** |
| Cliente (RxDB/app layer) inserta outbox | Duplica lógica en cada punto de creación, riesgo de split-brain si falla el INSERT a material_requests pero no el outbox | Rejected |

**Rationale**: El trigger garantiza que CADA material_request genere su evento outbox, incluso si hay múltiples puntos de entrada (REST API, RxDB sync, admin directo). No hay forma de olvidarlo.

### Decision: JSONB payload (NOT columnas fijas)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **JSONB payload** | Flexible para futuros event_types, schema-less, el adaptador interpreta según event_type | ✅ **Chosen** |
| Columnas fijas por evento | Funciona para un solo tipo, pero cada nuevo event_type requiere ALTER TABLE + migración | Rejected |

**Rationale**: El outbox sirve a MÚLTIPLES tipos de evento futuro. JSONB permite agregar `WORK_ORDER_UPDATE`, `PART_RECEIPT`, etc. sin cambiar el schema.

### Decision: Polling index (NOT listen/notify)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Índice (status, next_retry_at)** | Simple, universal, cualquier adaptador puede hacer polling | ✅ **Chosen** |
| `NOTIFY`/`LISTEN` en PostgreSQL | Más reactivo, pero complejo si el adaptador está fuera de Postgres (middleware externo) | Rejected |

**Rationale**: El futuro adaptador puede estar en un worker externo, Edge Function, o servicio separado. Polling con índice es el denominador común más simple.

## Data Flow

```
App/API/Sync
    │
    ▼
material_requests (INSERT)
    │
    ▼
[trg_enqueue_material_request]  ← misma transacción
    │
    ▼
epicor_outbox (status=PENDING, next_retry_at≤NOW())
    │
    ▼
[Futuro adaptador]   ← polling WHERE status=PENDING AND next_retry_at≤NOW()
    │
    ├─── éxito → status=SENT, processed_at=NOW()
    └─── error → status=FAILED, retry_count++, last_error=msg, next_retry_at=backoff
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/20260526000001_create_epicor_outbox.sql` | Create | Tabla, CHECK constraint, índice, trigger function, trigger |
| `supabase/tests/database/epicor_outbox_test.sql` | Create | pgTAP: 9 tests validando schema, trigger, payload |

## Interfaces

### Table: epicor_outbox

| Column | Type | Default | Constraints |
|--------|------|---------|-------------|
| id | UUID | `gen_random_uuid()` | PK |
| event_type | TEXT | — | NOT NULL |
| payload | JSONB | — | NOT NULL |
| status | TEXT | `'PENDING'` | CHECK (PENDING, PROCESSING, SENT, FAILED) |
| retry_count | INT | 0 | — |
| next_retry_at | TIMESTAMPTZ | `NOW()` | — |
| last_error | TEXT | NULL | — |
| created_at | TIMESTAMPTZ | `NOW()` | — |
| processed_at | TIMESTAMPTZ | NULL | — |

### Trigger Function: enqueue_material_request()

```sql
CREATE OR REPLACE FUNCTION enqueue_material_request()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO epicor_outbox (event_type, payload)
  VALUES (
    'MATERIAL_REQUEST_CREATE',
    jsonb_build_object(
      'material_request_id', NEW.id,
      'work_order_id', NEW.work_order_id,
      'part_num', NEW.part_num,
      'requested_qty', NEW.requested_qty,
      'line_desc', NEW.line_desc
    )
  );
  RETURN NEW;
END;
$$;
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| DB | Schema existence, status CHECK constraint | pgTAP: `has_table()`, `has_column()` |
| DB | Trigger auto-enqueue, correct event_type, PENDING status | pgTAP: INSERT + verify epicor_outbox row |
| DB | Payload integrity (all 5 fields, matching values) | pgTAP: `payload ? 'field'`, `payload->>'requested_qty'` |

## Migration Plan

1. Run migration `20260526000001_create_epicor_outbox.sql`
2. Execute `supabase/tests/database/epicor_outbox_test.sql` via pgTAP
3. Verify 9/9 tests pass
4. Rollback: `DROP TRIGGER ...; DROP TABLE ...; DROP FUNCTION ...;`
