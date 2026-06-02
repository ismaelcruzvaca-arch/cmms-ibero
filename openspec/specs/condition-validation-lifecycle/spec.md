# Spec: Ciclo de Vida de Validación de Condición

## Requirements

### REQ-CVAL-001: validation_status en todas las entidades
**Priority**: MUST
**Description**: Toda entidad del dominio de condición (methods, thresholds, rules, source_capabilities, analysis_results) debe tener campo validation_status con estados: draft, candidate, bench_validated, field_trial, active, deprecated, rejected.

#### Scenario: Entidad nueva en estado draft
- **WHEN**: Se inserta nuevo método, umbral, regla o capacidad de fuente
- **THEN**: validation_status = `draft` por defecto

#### Scenario: Entidad rechazada en validación
- **WHEN**: Un threshold candidate no supera bench validation
- **THEN**: validation_status puede transicionar a rejected

### REQ-CVAL-002: Transiciones de estado forzadas
**Priority**: MUST
**Description**: Las transiciones entre estados de validación deben estar restringidas. No se permite draft → active sin pasar por candidate, bench_validated y field_trial. Rejected es estado terminal (sin salida). Deprecated es alcanzable desde cualquier estado activo.

#### Scenario: Secuencia de promoción válida
- **WHEN**: Un método avanza draft → candidate → bench_validated → field_trial → active
- **THEN**: Cada transición es aceptada secuencialmente

#### Scenario: Salto de draft a active bloqueado
- **WHEN**: Se intenta actualizar validation_status de draft directamente a active
- **THEN**: El sistema rechaza con error (CHECK constraint o trigger)

#### Scenario: Deprecación desde active
- **WHEN**: Un método en active se marca como deprecated
- **THEN**: La transición es aceptada

#### Scenario: Rejected desde bench_validated
- **WHEN**: Un threshold en bench_validated falla validación y se marca rejected
- **THEN**: La transición es aceptada; rejected es estado terminal

### REQ-CVAL-003: Métricas de mejora continua
**Priority**: SHOULD
**Description**: Vistas consultables para métricas de calidad de datos, desempeño de reglas, resultados de mantenimiento y estado metrológico.

#### Scenario: Vista de calidad de datos
- **WHEN**: Se consulta vista data_quality_metrics
- **THEN**: Retorna % de registros G0, G1, G2, G3 por fuente y ventana temporal, tasa de pérdida de muestras, latencia de ingesta

#### Scenario: Vista de desempeño de reglas
- **WHEN**: Se consulta vista rule_performance_metrics
- **THEN**: Retorna eventos generados, falsos positivos (eventos dismissed sin hallazgo), eventos confirmados por regla y período

#### Scenario: Vista de resultados de mantenimiento
- **WHEN**: Se consulta vista maintenance_outcome_metrics
- **THEN**: Retorna OTs creadas por CBM, OTs con hallazgo confirmado, OTs descartadas, tiempo hasta respuesta

#### Scenario: Vista de estado metrológico
- **WHEN**: Se consulta vista metrology_status_metrics
- **THEN**: Retorna sensores con calibración vencida, incertidumbre declarada por fuente, fuentes sin uncertainty_available, drift detectado
