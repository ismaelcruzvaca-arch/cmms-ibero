# Proposal: Diagnostics, Degradation Models & Prognostics (SDD 4)

## Intent

SDD 3 detecta anomalías contra la normalidad propia del activo (z-score, innovación Kalman, residual sostenido). SDD 4 transforma esas anomalías en **hipótesis de falla con confianza, estado de degradación, RUL preliminar y recomendaciones de mantenimiento trazables**.

> **SDD 4 no declara verdades absolutas de falla — genera hipótesis diagnósticas con evidencia, confianza, contradicciones, RUL preliminar y recomendaciones trazables.**

## Decisión arquitectónica: FMEA ↔ CBM

**Opción C — Cross-reference.** SDD 4 crea su propio catálogo operativo en PostgreSQL (`condition_failure_mode_catalog`). El FMEA existente en RxDB queda como referencia. Se agregan cross-reference keys para vincular modos CBM con modos FMEA donde existan. Una migración futura puede unificar.

## Scope

### In Scope (10 capabilities)

1. **`condition-failure-mode-catalog`** — Catálogo CBM de modos de falla por asset_class: failure_mode_key, name, description, failure_mechanism, typical_causes, typical_effects, severity_default, detectability, iso14224_taxonomy_ref, fmea_ref, validation_status. Incluye modos de falla de activo (cavitación, desalineación, desbalance, rodamiento) Y modos de falla de sensor/fuente (stuck, dropout).

2. **`fmea-cbm-cross-reference`** — Tabla puente: condition_failure_mode_id, fmea_failure_mode_id, relationship_type (same_as, related_to, evidence_for, supersedes, unknown), confidence, notes. Sin migrar FMEA completo.

3. **`diagnostic-evidence-matrix`** — Patrones de evidencia multi-feature: failure_mode_id, feature_key, condition_type (threshold/residual/trend), op, value, logical_operator (AND/OR), evidence_role (required/supporting/contradictory), min_quality, min_confidence, required_regime. La ausencia de evidencia no es evidencia de ausencia — missing evidence ≠ contradictory evidence.

4. **`diagnostic-confidence-scoring`** — El score combina: evidence_present_ratio, required_evidence_met, contradictory_evidence_count, quality_modifier (G0=1.0→G3=0.0), regime_match, freshness, source_status, pattern_validation_status. No confianza binaria.

5. **`condition-diagnoses`** — Tabla SEPARADA de events: asset_id, failure_mode_id, diagnosis_status (candidate|field_trial|active|confirmed|rejected|superseded), confidence, evidence_summary, supporting_result_ids, contradictory_result_ids, source_window_ids, linked_event_id, linked_work_order_id, created_at, valid_until.

6. **`condition-degradation-models`** — Catálogo de modelos: linear_extrapolation (default para MVP), piecewise_linear, exponential, weibull, gamma, wiener. Cada modelo declara input_requirements, assumptions, parameters, validation_status.

7. **`preliminary-rul-estimation`** — RUL = (threshold - current_value) / |slope| con gates estrictos: slope > 0, R² ≥ 0.5, muestras ≥ 10, régimen consistente, calidad G0/G1, threshold definido, diagnosis confidence > 0.5. Almacena: method_key, current_value, threshold_value, slope, r2, rul_estimate, rul_unit, confidence, uncertainty (confidence interval, no punto único), assumptions, trend_result_id, threshold_id, failure_mode_id.

8. **`condition-pf-curves`** — asset_class, failure_mode_key, potential_failure_point, functional_failure_point, pf_interval_days, inspection_interval_days, intervention_window, confidence, validation_status. Configurable manualmente al inicio.

9. **`maintenance-recommendations`** — Generadas desde failure_mode + severity + confidence + rul + pf_window + asset_criticality: recommended_action, priority, due_window, wo_type, required_parts (JSONB), required_skills, requires_confirmation.

10. **`diagnosis-feedback-loop`** — Cuando se cierra OT vinculada a diagnóstico: diagnosis_confirmed (true/false), actual_failure_mode, actual_component, technician_notes, recommendation_useful. El government completo va en SDD 5, pero los campos mínimos existen desde SDD 4.

### Out of Scope
- ❌ Migración completa de FMEA a PostgreSQL → futuro
- ❌ ML avanzado / redes neuronales
- ❌ Optimización de mantenimiento
- ❌ Dashboard ejecutivo final
- ❌ RUL estocástico avanzado productivo
- ❌ Prescripción automática compleja sin revisión

## Reglas no negociables

1. **Diagnóstico ≠ evento.** Evento = "algo pasó". Diagnóstico = "probablemente esta falla". Tablas separadas.
2. **RUL no es número único.** Es estimación con intervalo de confianza, supuestos y metadata.
3. **No generar OT automática crítica desde diagnóstico no validado.** Requiere: pattern active + source active + capability active + confidence ≥ threshold + severity crítica.
4. **Contradictory evidence baja confianza.** Si el patrón dice cavitación pero presión normal → confianza baja.
5. **Missing evidence ≠ contradictory evidence.** Si no hay sensor de presión, no se puede descartar cavitación. Solo "insufficient evidence."

## Approach

**Minimal Viable Diagnostic SQL.** Todo en PL/pgSQL — sin nuevas Edge Functions. Reusa el patrón `evaluate_compound_conditions()` de SDD 2 para evaluar matrices de evidencia.

PR 1 (Backend ~700 LOC): 2 migrations — catálogos + funciones.
PR 2 (Frontend ~400 LOC): DiagnosisPanel, RulGauge, RecommendationCard.

## Affected Areas

| Area | Impact |
|------|--------|
| `supabase/migrations/` | +2 |
| `supabase/functions/` | 0 (SQL-only) |
| `src/components/condition/` | +3 (DiagnosisPanel, RulGauge, RecommendationCard) |
| `src/App.jsx` | +1 subtab "Diagnóstico" |
| `condition_events` | + FK a diagnosis_id, failure_mode_id |
| `condition_analysis_results` | rul_estimate con metadata completa |

## Risks

| Risk | Mitigation |
|------|------------|
| RUL lineal naive + falsa confianza | Confidence baja si R² < 0.7; uncertainty interval; assumptions documentados |
| FMEA desconectado | Cross-reference keys; migración futura planificada |
| Catálogo inicial de modos de falla incompleto | Extensible por INSERT; seed con ≥10 modos comunes |
| Evidencia contradictoria ignorada | Scoring explícito que penaliza contradictory evidence |
| Diagnóstico en field_trial genera OT | Gate: solo active puede generar OT; field_trial solo evento info |

## Success Criteria

- [ ] condition_failure_mode_catalog seed con ≥10 modos de falla (activo + sensor)
- [ ] FMEA cross-reference: al menos 3 modos CBM vinculados a FMEA existentes
- [ ] Matriz evidencia: al menos 2 patrones completos (required + supporting + contradictory)
- [ ] compute_rul_linear(): gates correctos, confidence interval, assumptions documentados
- [ ] diagnosis ≠ evento: tablas separadas con FK cruzados
- [ ] Contradictory evidence reduce confidence score
- [ ] Missing evidence ≠ contradictory evidence (insufficient evidence)
- [ ] OT automática solo desde diagnosis active + confidence ≥ threshold + severity crítica
- [ ] P-F curves seed con ≥3 configuraciones por defecto
- [ ] Feedback loop: OT cerrada puede confirmar/descartar diagnóstico
- [ ] pgTAP: ≥50 assertions
- [ ] DiagnosisPanel + RulGauge + RecommendationCard renderizan
