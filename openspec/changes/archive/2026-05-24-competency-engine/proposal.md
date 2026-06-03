# Proposal: GEMA Competency Engine

## Intent

Las matrices de competencia tradicionales son estáticas, subjetivas y desconectadas del trabajo real. GEMA necesita un sistema donde los niveles de habilidad EMERJAN de la evidencia operativa (checklists, WOs) — no de asignación manual. Esto permite candado de asignación objetivo, gap analysis predictivo y zero admin burden.

## Scope

### In Scope
- `technological_modules` table + seed (8 módulos: M-PACK, M-TRAN, M-ELEC, M-REFR, M-VAPO, M-PUMP, M-TÉRM, M-INFR)
- `assets.module_id` FK → technological_modules
- `proficiency_levels` table (5 niveles con trigger_condition JSONB)
- `technician_skills` table (technician × module × calculated_level, default 1)
- `skill_requirements` table (minimum_level por job_plan)
- `technician_skill_evidence` table (trail de evidencia para niveles 2/3/4)
- `technician_module_progress` table (flags: induccion_modulo_completada, autor_estandar — para niveles 1 y 5)
- Trigger: recálculo automático de niveles 2/3/4 al insertar evidencia
- Trigger/function: soft-lock validation (warning banner) al asignar técnico a WO
- RLS: PLANNER/ADMIN manage evidence, TECHNICIAN read-only

### Out of Scope
- Checklists con bloques A/B/C (cambio separado, compatible)
- Hard-lock (v3, requiere 3+ meses de histórico)
- LUPs/SOPs system (niveles 1 y 5 usan flags manuales mientras tanto)
- Frontend: matriz visual, gap dashboard, detail view (deferred)
- gap analysis predictivo (skill_gap_alerts, deferred)

## Capabilities

### New Capabilities
- `competency-evidence`: technician_skill_evidence table, module assignments, manual entry for PLANNER; technician_module_progress flags for levels 1/5
- `competency-engine`: automatic level calculation (2/3/4) via trigger, skill_requirements per job_plan, soft-lock validation on WO assignment

### Modified Capabilities
- None

## Approach

GEMA Dynamic Engine (Approach 3). Skills matrix donde niveles 2/3/4 se CALCULAN desde evidencia (`technician_skill_evidence`), no se asignan manualmente. Niveles 1 (inducción) y 5 (autor estándar) se activan por boolean flags en `technician_module_progress`. Candado SOFT-LOCK: warning banner si técnico no cumple nivel mínimo, sin bloquear la operación. Backend-only en v1 (migración SQL + triggers + RLS). Frontend y checklists se integran en cambios posteriores.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/<next>_competency_engine.sql` | New | 6 tablas + triggers + RLS + seed data |
| `supabase/tests/database/competency_engine_test.sql` | New | pgTAP: schema, triggers, RLS, soft-lock |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Engine sin checklists ni frontend no genera valor visible | High | MVP enfocado en schema + seed data + soft-lock funcional. El valor llega con checklists (siguiente cambio). |
| Soft-lock ignorado por planners si no hay hard enforcement | Medium | Warning banner + audit trail en audit_logs. Métrica de adopción: % assignments con warning vs sin warning. |

## Rollback Plan

DROP migration `202605xxxxxx_competency_engine.sql` via Supabase migration down (o DROP TABLE en cascada). Ninguna tabla existente se modifica excepto `assets` (ADD COLUMN module_id — simple DROP COLUMN). Ningún frontend se ve afectado.

## Dependencies

- `technological_modules` debe seedearse con los 8 módulos aprobados
- `assets` debe tener `module_id` poblado (migración de datos manual o batch)

## Success Criteria

- [ ] Migración ejecutada sin errores en Supabase
- [ ] Seed data inserta 8 módulos tecnológicos + 5 proficiency_levels
- [ ] RLS permite PLANNER insert evidence, TECHNICIAN solo lectura
- [ ] Soft-lock trigger ejecuta warning (no hard block) en transición APPROVED→INPRG
- [ ] pgTAP tests pasan al 100%
