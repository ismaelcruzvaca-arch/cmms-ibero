# Tasks: epicor-outbox-pattern

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |

```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low
```

## Phase 1: Database Foundation

- [x] 1.1 Create `supabase/migrations/20260526000001_create_epicor_outbox.sql` — tabla con CHECK status constraint, índice compuesto `(status, next_retry_at)`, función trigger `enqueue_material_request()`, trigger `trg_enqueue_material_request` en `material_requests`
- [x] 1.2 Create `supabase/tests/database/epicor_outbox_test.sql` — pgTAP con 9 casos: existencia de tabla, encolado automático (event_type, status PENDING, next_retry_at), payload íntegro (5 campos + valor match)

## Phase 2: Verification

- [x] 2.1 Aplicar migración en Docker local
- [x] 2.2 Ejecutar pgTAP tests — verificar 9/9 pasan
- [x] 2.3 Verificar que INSERT en `material_requests` produce fila en `epicor_outbox` con status PENDING y payload correcto
