# Design: epicor-outbox-pattern

## Table: epicor_outbox
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | UUID PK | gen_random_uuid() | ID único |
| event_type | TEXT NOT NULL | | Tipo de evento |
| payload | JSONB NOT NULL | | Datos para Epicor |
| status | TEXT NOT NULL | 'PENDING' | CHECK estados |
| retry_count | INT | 0 | Reintentos |
| next_retry_at | TIMESTAMPTZ | NOW() | Backoff |
| last_error | TEXT | NULL | Debug |
| created_at | TIMESTAMPTZ | NOW() | Auditoría |
| processed_at | TIMESTAMPTZ | NULL | Métrica latencia |

## Trigger
enqueue_material_request() ON material_requests AFTER INSERT
