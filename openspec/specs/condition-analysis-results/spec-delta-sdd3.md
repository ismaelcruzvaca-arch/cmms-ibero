# Delta SDD 3: Resultados de Análisis de Condición

## ADDED Requirements

### REQ-CAR-D3-005: Almacenamiento de residual con metadata de z-score
**MUST** — analysis_type='residual' debe almacenar: result_value=z_score, parameters JSONB con residual_type ('A'|'B'|'C'), deviation_level ('normal'|'warning'|'critical'), baseline_mean, baseline_stddev, baseline_version, regime_at_event, approximate_flag. Solo tipo A implementado en SDD 3; tipos B y C retornan NULL con mensaje 'not_implemented'.

#### Scenario: Residual tipo A almacenado con z-score
- **GIVEN** Ventana con valor=3.5, baseline mean=2.3, std=0.4, z=3.0
- **WHEN** compute_baseline_residual() inserta resultado
- **THEN** analysis_type='residual', result_value=3.0, parameters={"residual_type":"A","deviation_level":"critical","baseline_mean":2.3,"baseline_stddev":0.4,"baseline_version":2,"regime":"FULL_LOAD","approximate":false}

#### Scenario: Residual tipo B retorna placeholder
- **GIVEN** residual_type='B' solicitado
- **WHEN** compute_baseline_residual() ejecuta
- **THEN** result_value=NULL, parameters={"residual_type":"B","error":"not_implemented"}

### REQ-CAR-D3-006: Almacenamiento de estado Kalman
**MUST** — analysis_type='kalman_state' almacena: result_value=state_estimate, state_variance, innovation, innovation_variance, kalman_gain en DOUBLE PRECISION. Parameters contiene Q, R, method_version. La innovation se usa como señal de anomalía.

#### Scenario: Estado Kalman completo con innovación
- **GIVEN** compute_kalman_1d() procesa ventana (z=2.5, x̂=2.35, P=0.03, Q=0.01, R=0.04)
- **WHEN** Inserta resultado
- **THEN** state_estimate=2.42, state_variance=0.024, innovation=0.15, innovation_variance=0.064, kalman_gain=0.234, parameters={"Q":0.01,"R":0.04,"method_version":"1.0"}

## MODIFIED Requirements

### REQ-CAR-001: Almacenamiento de resultados analíticos derivados (Modificado)
**MUST** — La tabla `condition_analysis_results` debe almacenar resultados de análisis derivados separados de los feature values crudos, con trazabilidad a ventanas de entrada. Campos: asset_id, feature_definition_id (nullable), analysis_type VARCHAR, method_key VARCHAR FK, method_version, parameters JSONB, result_value DOUBLE PRECISION, result_unit VARCHAR, confidence DOUBLE PRECISION, r_squared DOUBLE PRECISION, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ, input_window_ids UUID[], validation_status VARCHAR. Se AGREGAN campos: state_variance DOUBLE PRECISION, innovation DOUBLE PRECISION, innovation_variance DOUBLE PRECISION, kalman_gain DOUBLE PRECISION (nullable, solo para kalman_state).
(Previously: no tenía campos específicos para Kalman)

#### Scenario: Kalman state con campos específicos
- **WHEN**: Se inserta resultado kalman_state
- **THEN**: state_variance, innovation, innovation_variance, kalman_gain almacenados en columnas dedicadas (no solo JSONB) para permitir indexación y consultas eficientes

### REQ-CAR-002: Tipos de análisis soportados (Modificado)
**MUST** — analysis_type acepta: health_index, trend_slope, residual, kalman_state, rul_estimate. residual y kalman_state ahora tienen implementación completa (no placeholders). trend_slope ahora es per-feature (no solo HI compuesto).
(Previously: residual, kalman_state eran placeholders; trend_slope solo para HI)

#### Scenario: Residual implementado (ya no es placeholder)
- **WHEN**: compute_baseline_residual() ejecuta
- **THEN**: analysis_type='residual' produce resultado real con z-score, deviation_level, baseline_version

#### Scenario: Trend slope per-feature
- **WHEN**: compute_feature_trend() ejecuta para vibration.rms específico
- **THEN**: analysis_type='trend_slope' con feature_definition_id poblado (no NULL), slope e intercept por feature individual
