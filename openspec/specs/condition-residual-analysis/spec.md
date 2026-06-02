# Spec: Análisis de Residuales

## Purpose

El residual mide cuánto se desvía un valor medido de lo esperado. Tres tipos definidos, Tipo A implementado en SDD 3: residual contra baseline estándar. El z-score normaliza la desviación por la dispersión del baseline.

## Requirements

### REQ-RESD-001: Función compute_baseline_residual()
**MUST** — `compute_baseline_residual(asset_id UUID, window_id UUID)` calcula: residual = value - baseline_mean, z_score = residual / NULLIF(baseline_stddev, 0). Busca el baseline activo para (asset, feature, method, regime, rpm_band, load_band). Si no existe exacto, usa fallback por régimen más cercano (marcado aproximado). Almacena en condition_analysis_results con analysis_type='residual'.

#### Scenario: Residual calculado contra baseline activo
- **GIVEN** vibration.rms=3.5, baseline activo con mean=2.3, stddev=0.4
- **WHEN** compute_baseline_residual() ejecuta
- **THEN** residual=1.2, z_score=3.0 (1.2/0.4); analysis_type='residual'; metadata contiene baseline_version, regime_at_event, aproximado=false

#### Scenario: Baseline con stddev=0 usa stddev mínimo 0.01
- **GIVEN** baseline con mean=2.3, stddev=0 (una sola muestra)
- **WHEN** compute_baseline_residual() ejecuta
- **THEN** z_score = residual / 0.01 (evita división por cero); metadata incluye warning 'stddev_zero'

#### Scenario: Fallback a régimen aproximado
- **GIVEN** Ventana en PARTIAL_LOAD pero solo existe baseline FULL_LOAD
- **WHEN** compute_baseline_residual() busca baseline exacto → no encuentra → usa más cercano
- **THEN** residual calculado contra baseline FULL_LOAD; metadata.aproximado=true

### REQ-RESD-002: Tres tipos de residual definidos
**MUST** — El sistema reconoce 3 tipos: A (baseline: value - mean), B (contextual: value - expected_value(regime)), C (modelo: measured - kalman_state_estimate). Solo tipo A implementado en SDD 3.

#### Scenario: Tipo A almacenado correctamente
- **GIVEN** Tipo A calculado
- **THEN** Almacena residual_type='A' en parameters JSONB

#### Scenario: Tipo B y C son placeholders
- **GIVEN** Tipo B o C referenciados
- **THEN** residual=NULL con mensaje 'not_implemented' en parameters

### REQ-RESD-003: Escenarios de desviación
**MUST** — El residual se clasifica: normal (|z| < 2), warning (2 ≤ |z| < 3), critical (|z| ≥ 3). La clasificación se almacena en parameters JSONB como deviation_level.

| Rango z-score | Clasificación | Acción |
|---------------|---------------|--------|
| \|z\| < 2 | normal | Sin acción |
| 2 ≤ \|z\| < 3 | warning | Marcar en resultado |
| \|z\| ≥ 3 | critical | Disponible para reglas |

#### Scenario: Desviación normal no genera alerta
- **GIVEN** z_score=1.2
- **WHEN** compute_baseline_residual() clasifica
- **THEN** deviation_level='normal'; confidence alta

#### Scenario: Desviación crítica disponible para reglas
- **GIVEN** z_score=3.5
- **WHEN** compute_baseline_residual() clasifica
- **THEN** deviation_level='critical'; resultado disponible para evaluación de reglas

### REQ-RESD-004: Almacenamiento con trazabilidad completa
**MUST** — Cada resultado residual almacena: analysis_type='residual', result_value=z_score, result_unit='z_score', baseline_version, regime_at_event, approximate_flag, input_window_ids=[window_id], parameters con residual_type, deviation_level, baseline_mean, baseline_stddev.

#### Scenario: Residual trazable al baseline y ventana fuente
- **GIVEN** Residual calculado para ventana W-123 contra baseline v2
- **WHEN** Se consulta condition_analysis_results
- **THEN** input_window_ids contiene W-123; parameters.baseline_version=2; se puede reconstruir el cálculo
