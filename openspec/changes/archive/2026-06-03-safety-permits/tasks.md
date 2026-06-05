# Tasks: Safety & Permits (PTW + LOTO)

## Phase 1: Database Foundation

- [x] 1.1 Create `supabase/migrations/20260527000001_safety_permits.sql` — 3 ENUMs (`permit_status` con 7 valores FSM, `loto_status` con 4 valores FSM, `device_type` con 4 valores), alter `user_profiles` CHECK agregando `SAFETY_OFFICER`, 5 tablas (`permit_types`, `work_permits`, `permit_tasks`, `lockout_tagout`, `tagout_devices`) con FKs, CHECKs, defaults, índices, y seed data con 7 tipos de permiso (`HOT_WORK`, `COLD_WORK`, `CONFINED_SPACE`, `HEIGHT_WORK`, `EXCAVATION`, `ELECTRICAL`, `RADIATION`)
- [x] 1.2 Create `supabase/tests/database/safety_permits_test.sql` con 50 pgTAP tests: Schema (20 tests de tablas, ENUMs, FKs, defaults), PTW FSM (10 tests de transiciones, gas test gate, auto-expiry, backward rejection), LOTO FSM (8 tests de transiciones, two-person rule, backward rejection), RLS (8 tests de matriz de roles), Cascade (4 tests de DELETE en cascada)

## Phase 2: FSM Triggers

- [x] 2.1 Implement `fn_permit_auto_expiry()` + `trg_permit_auto_expiry` (BEFORE UPDATE): expira permisos ACTIVE vencido cuando el usuario NO cambia status explícitamente. Implementar `fn_validate_permit_fsm()` + `trg_validate_permit_fsm` (BEFORE UPDATE): ciclo REQUESTED→APPROVED→ACTIVE→COMPLETED con alternativas REJECTED/CANCELLED/EXPIRED, gas test gate en APPROVED→ACTIVE, seteo automático de issued_at/expires_at/completed_at, RAISE EXCEPTION en transiciones inválidas
- [x] 2.2 Implement `fn_validate_loto_fsm()` + `trg_validate_loto_fsm` (BEFORE UPDATE): ciclo forward-only PLANNED→LOCKED→VERIFIED→REMOVED, regla de dos personas (verified_by != locked_by) en LOCKED→VERIFIED, seteo automático de locked_at/verified_at/removed_at, RAISE EXCEPTION en backward transitions

## Phase 3: Cross-Cutting

- [x] 3.1 Add `set_safety_updated_at()` function + triggers `trg_work_permits_updated_at` y `trg_lockout_tagout_updated_at` para auto-actualización de `updated_at` en work_permits y lockout_tagout
- [x] 3.2 Attach audit triggers a las 5 tablas (permit_types, work_permits, permit_tasks, lockout_tagout, tagout_devices) reutilizando `audit_trigger_func()` de migración 1 con AFTER INSERT OR UPDATE OR DELETE

## Phase 4: Security

- [x] 4.1 Enable RLS en las 5 tablas con policies por rol: ADMIN/SAFETY_OFFICER=ALL, PLANNER=SELECT+INSERT+UPDATE (sin DELETE), TECHNICIAN=solo SELECT. 25 policies en total (5 tablas × 4 operaciones + 5 selects)
