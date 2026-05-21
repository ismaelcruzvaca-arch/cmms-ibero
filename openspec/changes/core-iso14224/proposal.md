# Proposal: Core — Security, Audit & ISO 14224 Schema

## Intent

Refactorizar el esquema de datos a nivel Enterprise-predictivo: implementar Supabase Auth (RBAC), Audit Trail inmutable, y alinear `work_orders` con ISO 14224.

## Scope

### Pilar 1: Auth & Roles (RBAC)
- Tabla `user_profiles` vinculada a `auth.users`
- Roles: `ADMIN`, `PLANNER`, `TECHNICIAN`, `STOREKEEPER`
- RLS activado en todas las tablas del schema `public`

### Pilar 2: Bóveda de Auditoría (Audit Trail)
- Tabla `audit_logs` con schema inmutable
- Trigger automático en `work_orders` para capturar INSERT/UPDATE/DELETE
- Extensible a otras tablas en el futuro

### Pilar 3: Refactorización de `work_orders` (ISO 14224)
- FSM desacoplado: `lifecycle_phase` + `block_reason`
- Timestamps event-driven: `reported_at`, `approved_at`, `planned_start_at`, `actual_start_at`, `completed_at`, `closed_at`, `machine_down_at`, `machine_up_at`
- Taxonomía de falla: `failure_class`, `problem_code`, `cause_code`, `remedy_code`
- Contexto operativo: `criticality`, `asset_class`, `part_in_process`
- Notas estructuradas: `symptom_note`, `cause_note`, `action_note`
- Columnas eliminadas: `status`, `description`, `actual_hours`, `cost_estimate`, `actual_cost`, `percentage_complete`, `_conflict`, `_deleted`

### Efecto Dominó: Edge Function `oee-trigger`
Actualizar `index.ts` para insertar con la nueva estructura:
- `lifecycle_phase: 'WAPPR'`
- `block_reason: 'NONE'`
- `symptom_note` desde el payload `sintoma`

## Approach
1. Migración SQL destructiva (Opción A) — schema limpio, sin deuda técnica
2. Recreación de `work_orders` es más eficiente que ALTER TABLE debido a la cantidad de columnas que cambian
3. Migraciones en `supabase/migrations/` con timestamp naming

## Constraints
- Sin UI — solo SQL y backend (Edge Function)
- Comportamiento backward-incompatible por decisión explícita
- RLS obligatorio en todas las tablas nuevas y existentes
