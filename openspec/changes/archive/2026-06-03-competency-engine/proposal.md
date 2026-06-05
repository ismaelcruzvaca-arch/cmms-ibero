# Proposal: competency-engine

## Intent

Motor de competencias técnicas con 5 niveles de proficiencia (Awareness→Master), evidencia calificada recolectada en campo, y soft-lock al asignar técnicos a job plans. El sistema calcula automáticamente el nivel vía triggers y advierte si un técnico no cumple el mínimo requerido sin bloquear la asignación.

## Scope

### In Scope
- Catálogo `technological_modules` (8 módulos semilla: M-PACK, M-ELEC, etc.) + FK `module_id` en `assets`
- Catálogo `proficiency_levels` (5 niveles fijos con reglas de obtención)
- Tabla `technician_skills` — nivel actual por técnico+módulo
- Tabla `skill_requirements` — nivel mínimo exigido por job_plan
- Tabla `technician_skill_evidence` — evidencia de evaluación en campo (PASS/FAIL, niveles 2–4)
- Tabla `technician_module_progress` — flags de inducción y autor de estándar (niveles 1 y 5)
- Trigger `trg_recalculate_technician_level` — recálculo automático al insertar evidencia
- Trigger `trg_update_module_progress` — recálculo al cambiar flags de progreso
- Función `check_competency_for_assignment()` — soft-lock vía JSON warning
- RLS por rol (TECHNICIAN=lectura, PLANNER=gestión evidencia/progreso, ADMIN=total)
- 37 pgTAP tests

### Out of Scope
- Niveles adicionales (>5) o personalización del catálogo de niveles
- Hard-block (rechazar asignación): el diseño actual es soft-lock con advertencia
- Interfaz UI de evaluación: solo backend (migraciones + funciones + RLS)
- Integración con sistemas externos de certificación

## Capabilities

### New Capabilities
- `competency-engine`: motor de competencias técnicas — niveles, evidencia, cálculo automático, y validación de asignación con soft-lock

### Modified Capabilities
- None (new capability, no existing spec changed)

## Approach

Dos migraciones secuenciales: (1) catálogo de módulos tecnológicos + vinculación con `assets`, (2) motor de competencias completo con tablas transaccionales, triggers de recálculo, función de soft-lock, y RLS. El nivel se calcula como el MAX de todos los niveles alcanzados, evaluando evidencia PASS (niveles 2–4) y flags de progreso (niveles 1 y 5). Los triggers aseguran que `technician_skills.current_level` siempre refleje el último estado.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260528000001_technological_modules.sql` | New | Catálogo de módulos + FK en assets |
| `supabase/migrations/20260528000002_competency_engine.sql` | New | 5 tablas, 2 triggers, soft-lock, RLS |
| `openspec/specs/competency-engine/spec.md` | New | Especificación del motor de competencias |
| `tests/` | New | 37 pgTAP tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Desajuste entre spec y migraciones actuales | Medium | Spec ya refleja estado desplegado; proposal documenta lo migrado |
| Trigger `trg_update_module_progress` no cubre INSERT (solo UPDATE) | Low | `technician_module_progress` se crea vía INSERT desde la app; el trigger `trg_recalculate_technician_level` ya cubre el flujo de evidencia |

## Rollback Plan

Revertir ambas migraciones en orden inverso (`00002` luego `00001`). La columna `module_id` en `assets` es nullable, no hay pérdida de datos existentes. Los datos de competencias (evidencia, progreso) se perderían al dropear las tablas transaccionales.

## Dependencies

- Migración 01 (technological_modules) debe ejecutarse antes que 02 (competency_engine)
- Las funciones RLS dependen de `get_user_role()` definida en migración previa de RBAC/auth

## Success Criteria

- [ ] Catálogo `technological_modules` con 8 módulos semilla + `module_id` en `assets`
- [ ] 5 niveles de proficiencia seedeados en `proficiency_levels`
- [ ] Trigger recalcula `technician_skills.current_level` al insertar evidencia
- [ ] `check_competency_for_assignment()` retorna WARNING si el técnico no cumple el mínimo
- [ ] RLS restringe acceso según rol (TECHNICIAN/PLANNER/ADMIN)
- [ ] 37 pgTAP tests pasan
