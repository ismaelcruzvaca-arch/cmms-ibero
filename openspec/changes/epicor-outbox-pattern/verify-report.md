# Verify Report: epicor-outbox-pattern

**Status**: ✅ PASS — 9/9 pgTAP tests

## Test Results

| # | Test | Result |
|---|------|--------|
| 1 | Tabla epicor_outbox existe | ✅ |
| 2 | Trigger creó 1 registro con event_type correcto | ✅ |
| 3 | Status del registro es PENDING | ✅ |
| 4 | next_retry_at <= NOW() (listo para procesar) | ✅ |
| 5 | Payload contiene material_request_id | ✅ |
| 6 | Payload contiene work_order_id | ✅ |
| 7 | Payload contiene part_num | ✅ |
| 8 | Payload contiene requested_qty | ✅ |
| 9 | requested_qty en payload coincide con el INSERT | ✅ |

## Evidencia

- Migración: `20260526000001_create_epicor_outbox.sql`
- Docker local: Supabase corriendo en 127.0.0.1:54322
- Seed: asset, work_order, spare_part insertados, material_request trigger outbox
