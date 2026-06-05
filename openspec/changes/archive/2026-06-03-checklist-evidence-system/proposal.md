# Proposal: Checklist Evidence System

## Intent

Resolver los 3 Puntos Ciegos del Motor de Competencias: (1) **causa_falla** — por qué falló, no solo que falló; (2) **evaluator_source** — quién evalúa determina el peso de la evidencia; (3) **sampling** — fatiga de clic vía muestreo determinístico por módulo+bloque. Construir un sistema estructurado de checklists (A/B/C por módulo) que alimente evidencia calificada a `technician_skill_evidence`.

## Scope

### In Scope
- Catálogo `causa_falla_catalog` con 6 causas (BRECHA_CONOCIMIENTO, FALTA_HERRAMIENTA, DESVIACION_DISCIPLINARIA, FALTA_REPUESTO, ERROR_DOCUMENTACION, NO_APLICA)
- Templates de checklist por módulo+bloque con override por job_plan
- Ítems de template con tipos (PASS_FAIL, MEASUREMENT, YES_NO, TEXT) + foto/comentario
- Instancias de checklist por WO con evaluator_source (SELF/SUPERVISOR/PEER) + verificación
- Trigger `trg_checklist_to_evidence` que alimenta evidencia al completar instancia
- Re-cálculo de nivel 3 con SUM(trust_score) y filtro de causa_falla
- Sampling config con rates determinísticos y flag auditable
- RLS en todas las tablas nuevas
- Auditoría en instancias y respuestas

### Out of Scope
- UI/UX de Focus Mode (consume el sistema, no lo define)
- Dashboard de reportes de competencia

## Capabilities

### New Capabilities
- `checklist-evidence`: Catálogo de causas, templates, instancias, respuestas y sampling. Ya existe spec — es implementado por esta migración.

### Modified Capabilities
- `competency-evidence`: Nuevas columnas `evaluation_source`, `causa_falla_id`, `trust_score` en `technician_skill_evidence` + inserción vía trigger SECURITY DEFINER.
- `competency-engine`: Nivel 3 cambia de COUNT(*) a SUM(trust_score). FAILs con FALTA_HERRAMIENTA/FALTA_REPUESTO/ERROR_DOCUMENTACION excluidos del conteo.

## Approach

Migración única (20260529000001) que crea 6 tablas, altera 2 existentes, y define 2 triggers. Orden: catálogos → templates → instancias → respuestas → sampling → ALTER evidence/wo → trigger evidence → trigger recálculo → RLS → auditoría.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/20260529000001_checklist_evidence.sql` | New | Migración completa del sistema |
| `technician_skill_evidence` (schema) | Modified | +3 columnas (evaluation_source, causa_falla_id, trust_score) |
| `work_orders` (schema) | Modified | +2 columnas (is_auditable, audit_reason) |
| `trg_recalculate_technician_level` | Modified | Trust-weighted SUM + causa_falla filter |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy NULL trust_score malinterpretado | Low | COALESCE(trust_score, 1.0) explícito en trigger |
| NO_APLICA override confuso | Low | Documentado en spec + comentarios SQL |
| Performance en sampling de WOs grandes | Low | Índices en FK + hash determinístico barato |

## Rollback Plan

DROP las 6 tablas nuevas (CASCADE elimina triggers y RLS), ALTER technician_skill_evidence DROP COLUMN, ALTER work_orders DROP COLUMN, recrear trigger legacy `trg_recalculate_technician_level` con COUNT(*) original.

## Dependencies

- `technological_modules` y `job_plans` existentes (FK en templates)
- `work_orders`, `assets`, `user_profiles` existentes (FK en instances)
- `technician_skill_evidence` existente (ALTER + trigger)

## Success Criteria

- [ ] 6 tablas creadas con RLS y políticas por rol
- [ ] `trg_checklist_to_evidence` inserta evidencia al completar instancia
- [ ] NO_APLICA overridea FAIL → PASS en evidence
- [ ] Nivel 3 usa SUM(trust_score) y excluye causas no-competencia
- [ ] Legacy NULL trust_score tratado como 1.0
