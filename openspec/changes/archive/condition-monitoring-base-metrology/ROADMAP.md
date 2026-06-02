# Roadmap — Condition Monitoring CMMS / IIoT

## Principio rector

El sistema de monitoreo de condición se construye como una arquitectura **source-agnostic** y **method-aware**.

- El CMMS no depende del sensor, marca, gateway, PLC, edge o método de captura.
- Todo dato de condición entra mediante contratos comunes (FeatureSet v0.2).
- Cada evidencia declara: qué es, cómo se calculó, con qué método, bajo qué contexto, con qué calidad y con qué incertidumbre cuando aplique.
- **El edge mide/procesa; el CMMS evalúa, decide, genera eventos y conecta con mantenimiento.**
- La arquitectura sigue ISO 13374 / OSA-CBM:
  - Bloques 1–2: adquisición y procesamiento primario en edge/fuente.
  - Bloques 3+: detección, diagnóstico, pronóstico, recomendación y mantenimiento en CMMS/backend.

---

## Dependencias

```
SDD 1 → SDD 2 → SDD 3 → SDD 4 → SDD 5
```

Cada SDD solo avanza a producción cuando el anterior produce datos confiables y auditables.

---

## SDD 1 — Foundation, Metrology & Evidence Contract

**Change name**: `condition-monitoring-base-metrology`
**Estado**: 🟡 Proposal v2 aprobada → specs pendientes

### Objetivo
Crear la base técnica y semántica del monitoreo de condición. Define cómo el sistema entiende una evidencia de condición, sin depender del hardware final.

### Incluye
- Catálogos: `condition_feature_definitions`, `condition_analysis_methods`, `condition_thresholds`, `condition_source_capabilities`
- Contrato FeatureSet v0.2 enriquecido (method metadata obligatorio)
- `condition_analysis_results` para HI, regresiones, pendientes, residuales
- `condition_rules` y `condition_events` con trigger → OT
- Lifecycle de validación (draft → candidate → bench_validated → field_trial → active → deprecated)
- Continuous improvement metrics views

### No incluye
Adaptadores físicos reales, Modbus, DAQ, Kalman operativo, RUL, dashboards finales.

---

## SDD 2 — Hybrid Source Integration & Monitoring Operations

**Change name**: `condition-monitoring-hybrid-sources`
**Estado**: ⚪ No iniciado

### Objetivo
Permitir que el CMMS reciba datos de condición desde distintas fuentes (manual, CSV, portátil, edge, Modbus, MQTT, API externa, SCADA) sin cambiar el core.

### Incluye
- Source registry y capacidades operativas
- Adaptadores: CSV/manual, API/edge FeatureSet, mock source
- Captura manual y rutas híbridas
- Ingesta robusta (idempotencia, outbox, retry, deduplicación, validación)
- Estados de fuente (draft → candidate → bench_validated → field_trial → active → disabled → deprecated)

### Por qué antes de Kalman
Kalman, residuales y baselines necesitan datos confiables, contextuales y trazables. Sin fuentes validadas, la estimación avanzada se construye sobre arena.

---

## SDD 3 — Detection, Adaptive Baselines, Residuals & State Estimation

**Change name**: `condition-monitoring-detection-estimation`
**Estado**: ⚪ No iniciado

### Objetivo
Capa de detección y estimación de estado: umbrales adaptativos, líneas base por régimen, regresión lineal, tendencias, residuales, filtros de Kalman, fusión de variables, propagación de incertidumbre.

### Incluye
- Baselines por contexto (activo + feature + método + régimen)
- Tendencias y regresión (pendiente, R², ventana histórica)
- Residuales (valor esperado vs medido)
- Kalman / estimadores como método registrado
- Fusión de evidencia multivariable
- Reglas de detección basadas en umbrales, tendencias, residuales y baselines

---

## SDD 4 — Diagnostics, Degradation Models & Prognostics

**Change name**: `condition-monitoring-diagnostics-prognostics`
**Estado**: ⚪ No iniciado

### Objetivo
El sistema deja de decir "algo está mal" y empieza a decir "probablemente este modo de falla está evolucionando, con esta confianza, y esta posible ventana de intervención."

### Incluye
- Diagnóstico basado en patrones (modos de falla → evidencias)
- Matrices de evidencia por modo de falla
- Health Index avanzado (pesos por feature, modo de falla, calidad, incertidumbre)
- Modelos de degradación (lineales, exponenciales, Weibull, Gamma, Wiener, Markov)
- RUL como distribución con intervalo de confianza
- Curvas P-F

---

## SDD 5 — Operationalization, Dashboards, Governance & Continuous Improvement

**Change name**: `condition-monitoring-operations-governance`
**Estado**: ⚪ No iniciado

### Objetivo
Convertir el sistema técnico en un proceso operativo de mantenimiento. Cierra el ciclo: evidencia → evento → OT → ejecución → hallazgo real → mejora del sistema.

### Incluye
- Dashboards operativos (por activo y por planta)
- Workflow evento → OT → cierre → feedback
- Retroalimentación desde mantenimiento (¿diagnóstico correcto? ¿falsa alarma?)
- Métricas de mejora continua (calidad de dato, reglas, mantenimiento, metrología, modelos)
- Gestión de cambios (versionado de métodos, reglas, thresholds, modelos)
- Gobierno del sistema (quién activa fuentes, aprueba reglas, libera métodos)

---

## Regla de oro

> "Primero construimos el lenguaje común del dato; después validamos fuentes híbridas; luego estimamos estados; después diagnosticamos y pronosticamos; finalmente operamos, gobernamos y mejoramos el sistema."

No se avanza al siguiente SDD porque "ya queremos el algoritmo". Se avanza cuando el SDD anterior produce datos confiables y auditables para soportarlo.
