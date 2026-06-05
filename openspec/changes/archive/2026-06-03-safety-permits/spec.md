# Spec: safety-permits

## Requirements

- R1: 3 ENUMs — `permit_status` (7 valores FSM), `loto_status` (4 valores FSM), `device_type` (4 valores)
- R2: 5 tablas — `permit_types` (catálogo), `work_permits` (PTW), `permit_tasks` (tasks/precauciones), `lockout_tagout` (LOTO), `tagout_devices` (dispositivos físicos)
- R3: `SAFETY_OFFICER` agregado al CHECK de `user_profiles.role` (junto a TECHNICIAN, PLANNER, ADMIN, STOREKEEPER)
- R4: 7 tipos de permiso semilla (HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION) con `requires_isolation`, `requires_gas_test`, `validity_hours` específicos
- R5: FSM PTW — REQUESTED → APPROVED → ACTIVE → COMPLETED, con alternativas REJECTED/CANCELLED/EXPIRED. Gas test gate en APPROVED→ACTIVE. Auto-expiry de ACTIVE vencido
- R6: FSM LOTO — PLANNED → LOCKED → VERIFIED → REMOVED, forward-only. Regla de dos personas (verified_by != locked_by)
- R7: Timestamps automáticos en transiciones FSM (issued_at, expires_at, completed_at; locked_at, verified_at, removed_at)
- R8: Índices en todas las FKs y columnas de filtrado frecuente
- R9: Audit triggers en las 5 tablas (reutilizan `audit_trigger_func()` de migración 1)
- R10: RLS en todas las tablas — ADMIN/SAFETY_OFFICER=ALL, PLANNER=SELECT+INSERT+UPDATE (no DELETE), TECHNICIAN=solo SELECT
- R11: `ON DELETE CASCADE` en `permit_tasks` (→ work_permits) y `tagout_devices` (→ lockout_tagout)

## States Machine

### PTW (permit_status)

```
                    ┌──────────────────────┐
                    │      REQUESTED        │
                    └──┬────┬────┬──────────┘
                       │    │    │
              ┌────────┘    │    └──────────┐
              ▼             ▼               ▼
         APPROVED       REJECTED       CANCELLED
              │
              │ (gas_test_required → PASS)
              ▼
           ACTIVE ──────► EXPIRED (auto o manual)
              │
              ▼
         COMPLETED
```

Transiciones válidas:
| Desde → Hacia    | Condición |
|------------------|-----------|
| REQUESTED→APPROVED | approved_by NOT NULL |
| REQUESTED→REJECTED | approved_by NOT NULL |
| REQUESTED→CANCELLED | — |
| APPROVED→ACTIVE | gas_test_required=false O gas_test_result='PASS'. Setea issued_at=NOW(), expires_at según validity_hours |
| APPROVED→CANCELLED | — |
| APPROVED→EXPIRED | — |
| ACTIVE→COMPLETED | Setea completed_at=NOW() |
| ACTIVE→EXPIRED | — |
| ACTIVE→EXPIRED (auto) | expires_at pasado + UPDATE sin cambiar status |

Cualquier otra transición → RAISE EXCEPTION.

### LOTO (loto_status)

```
PLANNED ──► LOCKED ──► VERIFIED ──► REMOVED
```

Transiciones válidas:
| Desde → Hacia    | Condición |
|------------------|-----------|
| PLANNED→LOCKED | Setea locked_at=NOW() |
| LOCKED→VERIFIED | verified_by NOT NULL, verified_by != locked_by. Setea verified_at=NOW() |
| VERIFIED→REMOVED | removed_by NOT NULL. Setea removed_at=NOW() |

Cualquier otra transición → RAISE EXCEPTION. Backward siempre rechazado.

## RLS Matrix

| Table | TECHNICIAN | PLANNER | SAFETY_OFFICER | ADMIN |
|-------|-----------|---------|----------------|-------|
| permit_types | SELECT | SELECT, INSERT, UPDATE | ALL | ALL |
| work_permits | SELECT | SELECT, INSERT, UPDATE | ALL | ALL |
| permit_tasks | SELECT | SELECT, INSERT, UPDATE | ALL | ALL |
| lockout_tagout | SELECT | SELECT, INSERT, UPDATE | ALL | ALL |
| tagout_devices | SELECT | SELECT, INSERT, UPDATE | ALL | ALL |

PLANNER no tiene DELETE en ninguna tabla. TECHNICIAN solo SELECT.

## Seed Data

| code | name | requires_isolation | requires_gas_test | validity_hours |
|------|------|-------------------|-------------------|----------------|
| HOT_WORK | Trabajo en Caliente | true | true | 8 |
| COLD_WORK | Trabajo en Frío | false | false | 12 |
| CONFINED_SPACE | Espacio Confinado | true | true | 4 |
| HEIGHT_WORK | Trabajo en Altura | false | false | 8 |
| EXCAVATION | Excavación | true | false | 24 |
| ELECTRICAL | Trabajo Eléctrico | true | false | 8 |
| RADIATION | Exposición a Radiación | true | true | 4 |
