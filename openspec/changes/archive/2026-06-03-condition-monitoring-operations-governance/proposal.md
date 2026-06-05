# Proposal: Operations, Governance & Continuous Improvement (SDD 5)

## Intent

Convert SDD 4's diagnostics, RUL, and recommendations into a **governed operational process** with human review, traceability, technical feedback, data quality transparency, configurable automation policies, and minimum outcome tracking.

> **SDD 5 no construye más inteligencia — construye confianza operacional. Diagnósticos y recomendaciones pasan de ser "interesantes" a ser "auditables y gobernados".**

## Architecture Decisions

| # | Opción | Decisión |
|---|--------|----------|
| 1 | Dashboard tab 0 vs overlay | **Tab 0.** Sub-tabs (Captura, CSV, Fuentes, Tendencias, Diagnóstico) quedan como drill-down desde los tiles del dashboard. |
| 2 | Feedback: tabla separada vs columnas | **Tabla separada `condition_diagnosis_feedback`.** Necesita audit trail, versión, trazabilidad por OT. Las columnas actuales en `condition_diagnoses` se mantienen como resumen. |
| 3 | generate_recommendation: refactor vs reemplazo | **Nueva v2** que lee desde `condition_automation_policies`. La función vieja se depreca con comentario, se mantiene para rollback. |
| 4 | ¿Dónde se evalúa la política HITL? | **SQL function** (`evaluate_automation_policy()`). No trigger, no frontend. La política se evalúa al generar la recomendación y al intentar confirmar/convertir a OT. |
| 5 | ¿Qué pasa si un diagnosis dismissed vuelve a dispararse? | **Regla en policy:** si existe diagnosis previo con mismo failure_mode_key + status dismissed/rejected en los últimos N días, la nueva recomendación nace como `review_required` (no suggested). |
| 6 | ¿Quién puede aprobar / convertir a OT? | **Aprobar:** PLANNER, ADMIN. **Convertir a OT:** solo ADMIN. TECHNICIAN puede enviar feedback. Controlado por RLS + policy evaluation. |
| 7 | ¿Audit log: tabla dedicada vs columna JSONB? | **Tabla dedicada `condition_audit_log`.** JSONB en la misma tabla no escala para consultas de governance. |
| 8 | ¿Métricas en tabla separada o consulta agregada? | **Tabla separada `condition_daily_metrics`** con actualización por pg_cron (función `compute_daily_metrics()`). Evita recomputar históricos en cada request del dashboard. |

## Scope

### In Scope (7 capabilities)

| # | Capability | Qué es | Por qué |
|---|------------|--------|---------|
| 1 | **cbm-operations-dashboard** | Vista consolidada tipo mosaico: activos críticos, diagnósticos abiertos, RUL más bajos, recomendaciones pendientes, fuentes caídas, % calidad G0-G3, eventos recientes. Tab 0 de Condition Monitoring. | Sin dashboard el módulo no es operable. Cada sub-tab existe pero no hay visión de conjunto. |
| 2 | **recommendation-review-workflow** | Completar lifecycle de `maintenance_recommendations`: agregar status `expired`, columnas de audit (`reviewed_by`, `reviewed_at`, `dismissed_reason`, `superseded_by`), FK formal a `work_orders`. UI: listado filtrable con approve/dismiss/supersede. | SDD 4 dejó recomendaciones sin gobierno. Una recomendación no debe ser OT sin revisión. |
| 3 | **diagnosis-feedback-management** | Nueva tabla `condition_diagnosis_feedback`: `diagnosis_id`, `work_order_id`, `feedback_status` (confirmed/partial/rejected), `actual_failure_mode`, `actual_component`, `actual_cause`, `technician_observation`, `was_recommendation_useful`, `reviewed_by`, `reviewed_at`. UI: formulario en DiagnosisPanel. RLS: TECHNICIAN INSERT, PLANNER/ADMIN UPDATE. | Sin feedback técnico el sistema nunca aprende si sus diagnósticos sirven. |
| 4 | **data-quality-governance** | Sin tabla nueva. Dashboard muestra: % G0/G1/G2/G3 por fuente, fuentes sin datos recientes (`last_seen_at < NOW() - INTERVAL '24h'`), dead-letter count por fuente. SourceManagementPanel existente se extiende con indicadores de calidad. | Si las fuentes fallan o mandan G2/G3, el sistema debe mostrarlo antes de que un diagnóstico falso dañe la credibilidad. |
| 5 | **human-in-the-loop-policies** | Nueva tabla `condition_automation_policies`: `policy_key` UNIQUE, `policy_name`, `description`, `conditions` JSONB (min_confidence, max_contradictory_count, min_completeness, min_quality, required_roles, requires_approval, allowed_wo_types, asset_criticality_allowed, failure_mode_categories), `evaluation_order`, `is_active`. Seed: 2 políticas. Refactor `generate_recommendation()` para leer desde esta tabla. | Reemplazar lógica hardcodeada `active + confidence >= 0.7` por políticas configurables. Es la capability más importante de SDD 5. |
| 6 | **cbm-outcome-metrics-lite** | Nueva tabla `condition_daily_metrics`, actualizada por pg_cron: `metric_date`, `asset_id`, `diagnoses_created`, `diagnoses_confirmed`, `diagnoses_rejected`, `recommendations_created`, `recommendations_approved`, `recommendations_dismissed`, `recommendations_converted_to_wo`, `cbm_wo_created`, `cbm_wo_closed`, `feedback_pending_count`. Función `compute_daily_metrics()` vía pg_cron. | Sin sembrar estos datos ahora, SDD 6 no tendrá línea de base para medir mejora. No es dashboard — es infraestructura de métricas. |
| 7 | **cbm-audit-log-lite** | Nueva tabla `condition_audit_log`: `id`, `action` (policy_changed / rec_status_changed / diagnosis_feedback / rec_dismissed / rec_converted_to_wo / policy_override), `entity_type`, `entity_id`, `before_state` JSONB, `after_state` JSONB, `reason`, `changed_by`, `changed_at`. Log por trigger en tablas gobernadas. | Sin auditoría, el sistema es opaco. Quién cambió qué, por qué, cuándo. |

### Modificaciones a capacidades existentes

| Capacidad existente | Cambio |
|---------------------|--------|
| `maintenance_recommendations` | +status `expired`, +`reviewed_by`, +`reviewed_at`, +`dismissed_reason`, +`superseded_by`, FK formal a `work_orders(id)` |
| `condition_diagnoses` | `feedback_status` y `feedback_notes` se mantienen como resumen; el detalle pasa a `condition_diagnosis_feedback` |
| `generate_recommendation()` | Nueva v2 que lee `condition_automation_policies`. Vieja deprecada con rollback path. |
| `evaluate_condition_rules()` | Sin cambios — la política HITL se evalúa en generate_recommendation, no en la creación del diagnosis. |
| `SourceManagementPanel` | +indicadores de calidad: %G0-G3, último dato, dead-letter count |
| `App.jsx` | Dashboard como tab 0. Sub-tabs existentes se mantienen. |

### Out of Scope (diferido a SDD 6+)

| Item | Motivo |
|------|--------|
| ❌ Performance analytics avanzado (tendencias, heatmaps, comparativas) | Sin datos históricos acumulados aún. SDD 5 siembra los datos en `condition_daily_metrics`. |
| ❌ Change control completo / versionado formal de reglas | El audit-log-lite de SDD 5 captura el qué/cuándo/quién. El versionado formal (branches, diff, rollback UI) va a SDD 6. |
| ❌ Degradation model catalog completo | Solo tiene sentido cuando haya >1 modelo de degradación corriendo. |
| ❌ RUL calibration framework | Requiere datos históricos de falla real. |
| ❌ Model retraining workflow | ML no está en roadmap inmediato. |
| ❌ Optimization/planning avanzado | Depende de métricas de desempeño consolidadas. |
| ❌ Mobile app nativa | Responsive web alcanza para MVP. |

## Data Foundation para SDD 6

SDD 5 siembra explícitamente los datos que SDD 6 necesitará:

| Dato | Lo crea SDD 5 | Lo consume SDD 6 |
|------|---------------|------------------|
| Diagnósticos confirmados/rechazados | `condition_diagnosis_feedback` | Performance metrics |
| Recomendaciones aprobadas/descartadas | `maintenance_recommendations.status` | Performance metrics |
| OTs CBM creadas/cerradas | `work_orders` (con wo_type='CBM') | Performance metrics |
| Métricas diarias agregadas | `condition_daily_metrics` | Dashboards históricos |
| Audit trail de cambios | `condition_audit_log` | Change control, compliance |
| Calidad de datos por fuente | Consultas sobre `condition_feature_values` | Data quality SLA |

## PRs sugeridos

### PR 1 — Backend Governance (~700 LOC)

Migration 1: `condition_automation_policies` + `condition_diagnosis_feedback` + `condition_audit_log` + ALTER `maintenance_recommendations` (+expired, audit cols, WO FK) + RLS + seeds.

Migration 2: `condition_daily_metrics` + `compute_daily_metrics()` + pg_cron schedule + `generate_recommendation_v2()` que lee policies.

Migration 3 (patch): `evaluate_automation_policy()` function + triggers de audit log en maintenance_recommendations y condition_automation_policies.

pgTAP: ≥40 assertions.

### PR 2 — Frontend Operations (~700 LOC)

- Dashboard component con tiles: activos críticos, diagnósticos abiertos, RUL bajos, recomendaciones pendientes, calidad G0-G3, fuentes caídas.
- RecommendationList: tabla con filtros por status/prioridad, acciones approve/dismiss/supersede.
- FeedbackForm: formulario embebido en DiagnosisPanel expandido.
- PolicyManagementPanel: listado + editor básico de policies (CRUD para PLANNER/ADMIN).
- SourceManagementPanel extendido: indicadores de calidad por fuente.
- Hooks: `useDashboardMetrics`, `useRecommendationList`, `useDiagnosisFeedback`.

## Affected Areas

| Area | Impact |
|------|--------|
| `supabase/migrations/` | +3 migrations |
| `supabase/functions/` | 0 (SQL-only, like SDD 4) |
| `src/components/condition/` | +4 (Dashboard, RecommendationList, FeedbackForm, PolicyManagementPanel), modify (SourceManagementPanel, DiagnosisPanel) |
| `src/App.jsx` | Dashboard tab 0, drill-down navigation |
| `src/hooks/` | +3 |
| `pg_cron` | +1 job: `compute_daily_metrics()` |
| `maintenance_recommendations` | +status expired, audit cols, WO FK |
| `condition_diagnoses` | feedback_summary columns kept; detail → new table |
| `generate_recommendation()` | v2 with policy read; v1 deprecated |

## Decisiones de diseño respondidas

| Pregunta | Respuesta |
|----------|-----------|
| ¿Dónde se evalúa la política HITL? | En `evaluate_automation_policy()` (SQL function), llamada desde `generate_recommendation_v2()`. No en trigger, no en frontend. |
| ¿Qué pasa si diagnosis dismissed vuelve a dispararse? | `evaluate_automation_policy()` checkea: si existe diagnosis previo mismo failure_mode_key + dismissed/rejected en últimos 30d → fuerza `review_required`. |
| ¿Quién puede aprobar una recomendación? | PLANNER, ADMIN (vía RLS en `maintenance_recommendations`). |
| ¿Quién puede convertir a OT? | Solo ADMIN. La acción `convert_to_wo` crea work_order y setea status='converted_to_wo'. |
| ¿Qué datos quedan al confirmar/rechazar diagnóstico? | Todo en `condition_diagnosis_feedback`: diagnosis_id, WO link, feedback_status, actual_failure_mode, actual_component, actual_cause, technician_observation, was_recommendation_useful. |
| ¿Falso positivo vs parcial vs confirmado? | feedback_status = 'confirmed' / 'partial' / 'rejected'. `partial` indica que el diagnóstico acertó en parte pero no completamente. |
| ¿Qué métricas mínimas se guardan desde día 1? | diagnoses_created/confirmed/rejected, recs_created/approved/dismissed/converted, CBM WOs created/closed, feedback_pending. |
| ¿Qué acciones quedan auditadas? | policy changes, rec status changes, diagnosis feedback submissions, rec dismissals/conversions, policy overrides. |
| ¿Fuente con mala calidad bloquea recomendaciones? | Sí, si la policy lo especifica (`min_quality` en conditions JSONB). Policy default: quality G0/G1 requerida para auto-confirmar. |
| ¿Política diferente por asset criticality? | Sí, `asset_criticality_allowed` en conditions JSONB permite restringir políticas por criticidad. |

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| RecommendationCard refactor rompe tab Diagnóstico existente | Feature flag: old component vive hasta que new list está estable. |
| Reemplazo de generate_recommendation() muy invasivo | v1 se mantiene como función deprecada. Rollback: recrear v1 desde migration patch. |
| Dashboard queries lentas en producción | Índices compuestos en `condition_diagnoses(asset_id, diagnosis_status, created_at)`, `condition_analysis_results(asset_id, analysis_type, window_end)`, `condition_feature_values(asset_id, quality_flag)`. |
| Políticas HITL sin UI terminan en SQL hardcodeado otra vez | PolicyManagementPanel es parte de PR 2. Mínimo: listar + crear/editar policies. |
| Métricas diarias sin data histórica | `compute_daily_metrics()` backfill: si se llama con fecha, computa desde esa fecha hasta hoy. |
| Feedback desde campo requiere mobile | DiagnosisPanel ya es responsive (MUI). FeedbackForm sigue el mismo patrón. |

## Rollback Plan

1. Revertir migrations en orden inverso (00018 → 00017 → 00016).
2. Restaurar `generate_recommendation()` v1 desde migration 00016 original.
3. Eliminar componentes nuevos de App.jsx.
4. DROP policy si se quiere limpiar seeds.
5. DROP TABLE condition_audit_log, condition_daily_metrics, condition_diagnosis_feedback, condition_automation_policies.

## Success Criteria

- [ ] Dashboard ≥7 tiles, carga <2s con datos reales
- [ ] Recommendation list: filtra por status/prioridad, approve/dismiss funciona
- [ ] Feedback form: envía a `condition_diagnosis_feedback`, RLS enforce TECHNICIAN/PLANNER/ADMIN
- [ ] %G0-G3 por fuente visible en dashboard + SourceManagementPanel
- [ ] Policies seeded con ≥2 defaults, PolicyManagementPanel permite CRUD
- [ ] `generate_recommendation_v2()` lee policies; fallback a hardcode si no hay policies activas
- [ ] `compute_daily_metrics()` corre vía pg_cron, inserta en `condition_daily_metrics`
- [ ] `condition_audit_log` registra cambios en policies, rec status, feedback, conversiones
- [ ] pgTAP ≥40 assertions
- [ ] No regression en SDD 1-4 (diagnósticos, RUL, eventos, fuentes, captura)
