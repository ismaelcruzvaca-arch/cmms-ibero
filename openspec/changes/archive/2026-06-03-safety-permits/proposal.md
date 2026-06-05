# Proposal: Safety & Permits (safety-permits)

## Intent

Permisos de Trabajo (PTW) y Bloqueo/Etiquetado (LOTO) como sistema FSM para seguridad en mantenimiento. Sigue filosofía Client-Driven: el servidor valida transiciones, NUNCA crea registros automáticamente. Agrega rol `SAFETY_OFFICER` al modelo de usuarios existente.

## Scope

### In Scope
- 5 tablas: `permit_types` (catálogo), `work_permits` (PTW), `permit_tasks`, `lockout_tagout` (LOTO), `tagout_devices`
- 3 ENUMs: `permit_status` (7 estados FSM), `loto_status` (4 estados FSM), `device_type` (4 tipos)
- FSM PTW: REQUESTED → APPROVED → ACTIVE → COMPLETED, con alternativas REJECTED/CANCELLED/EXPIRED
- FSM LOTO: PLANNED → LOCKED → VERIFIED → REMOVED (forward-only)
- Gas test gate en APPROVED→ACTIVE, regla de dos personas en LOCKED→VERIFIED
- Auto-expiry trigger para permisos ACTIVE vencidos
- 7 tipos de permiso semilla (HOT_WORK, COLD_WORK, CONFINED_SPACE, HEIGHT_WORK, EXCAVATION, ELECTRICAL, RADIATION)
- RLS en todas las tablas (matriz ADMIN/SAFETY_OFFICER=ALL, PLANNER=CRUD sin DELETE, TECHNICIAN=SELECT)
- Audit triggers en las 5 tablas
- 50 tests pgTAP: Schema (20), PTW FSM (10), LOTO FSM (8), RLS (8), Cascade (4)

### Out of Scope
- Frontend UI para PTW/LOTO (cliente aparte)
- Edge functions o lógica fuera de la BD
- Integración con sistemas externos de seguridad

## Capabilities

### New Capabilities
- `safety-permits`: catálogo de tipos de permiso, PTW con ciclo FSM, LOTO con regla de dos personas, RLS por rol, seed data

### Modified Capabilities
None — change is self-contained, no existing specs affected.

## Approach

Single migration (`20260527000001_safety_permits.sql`). Sin edge functions. Toda la lógica en PostgreSQL: ENUMs → tablas → FSM triggers → audit triggers → RLS → seed data. `set_safety_updated_at()` reutiliza patrón existente. Audit triggers reutilizan `audit_trigger_func()` de migración 1.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260527000001_safety_permits.sql` | New | 717 lines: ENUMs, 5 tablas, triggers, RLS, seed |
| `supabase/tests/database/safety_permits_test.sql` | New | 50 pgTAP tests |
| `user_profiles` | Modified | CHECK agregó `SAFETY_OFFICER` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Rollback de ENUM requiere CASCADE | Low | Migración única; si falla, restaurar desde backup |

## Rollback Plan

Revertir la migración: DROP tablas (CASCADE), DROP ENUMs, restaurar CHECK de `user_profiles` desde git. Sin pérdida de datos si se revierte dentro de 24h (tablas nuevas vacías).

## Dependencies

- Migration 1 (audit_trigger_func, get_user_role)
- user_profiles existente

## Success Criteria

- [ ] 5 tablas creadas con FKs, CHECKs, defaults correctos
- [ ] 3 ENUMs con valores correctos
- [ ] FSM PTW: todas las transiciones válidas funcionan, inválidas rechazadas con error
- [ ] Gas test gate: APPROVED→ACTIVE rechazado sin PASS, permitido con PASS
- [ ] Auto-expiry: ACTIVE vencido → EXPIRED en UPDATE
- [ ] FSM LOTO: PLANNED→LOCKED→VERIFIED→REMOVED, backward rechazado
- [ ] Regla de dos personas: verified_by = locked_by rechazado
- [ ] RLS: TECHNICIAN solo SELECT, PLANNER CRUD sin DELETE, SAFETY_OFFICER/ADMIN ALL
- [ ] Cascade: DELETE work_permit → permit_tasks, DELETE lockout_tagout → tagout_devices
- [ ] 50/50 pgTAP tests pasan
