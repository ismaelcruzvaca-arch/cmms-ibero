# Spec: Resultados de Análisis de Condición

## Requirements

### REQ-CAR-001: Almacenamiento de resultados analíticos derivados
**Priority**: MUST
**Description**: La tabla `condition_analysis_results` debe almacenar resultados de análisis derivados separados de los feature values crudos, con trazabilidad a ventanas de entrada. Campos: asset_id, feature_definition_id (nullable), analysis_type, method_key, method_version, parameters (JSONB), result_value, result_unit, confidence, r_squared, window_start, window_end, input_window_ids (UUID[]), validation_status.

#### Scenario: Health Index almacenado como resultado analítico
- **WHEN**: Se calcula HI para asset_id=`BANDA-TR-01` con method_key=`weighted_health_index`
- **THEN**: Se guarda resultado con analysis_type=`health_index`, result_value, result_unit, confidence, e input_window_ids con los UUIDs de ventanas fuente

#### Scenario: Resultado sin feature específico (HI compuesto)
- **WHEN**: HI se calcula desde múltiples features con pesos distintos
- **THEN**: feature_definition_id=NULL, analysis_type=`health_index` — el resultado es compuesto

### REQ-CAR-002: Tipos de análisis soportados
**Priority**: MUST
**Description**: El campo analysis_type debe aceptar: health_index, trend_slope, residual, kalman_state, rul_estimate.

#### Scenario: Tendencia almacenada con métricas de ajuste
- **WHEN**: Se calcula trend_slope con r_squared=0.85 y result_value=-0.02 HI/día
- **THEN**: Registro con analysis_type=`trend_slope`, r_squared=0.85, result_value=-0.02, result_unit=`HI/day`

#### Scenario: Kalman state placeholder
- **WHEN**: Se reserva analysis_type=`kalman_state` para Phase 2
- **THEN**: El tipo es aceptado por el CHECK constraint pero el cómputo no está implementado aún

### REQ-CAR-003: Trazabilidad a ventanas de entrada
**Priority**: MUST
**Description**: input_window_ids (UUID[]) debe referenciar todas las condition_windows que alimentaron el análisis, permitiendo auditoría completa del pipeline.

#### Scenario: Resultado trazable a 3 ventanas fuente
- **WHEN**: Un análisis de HI se calcula usando features de 3 ventanas distintas
- **THEN**: input_window_ids contiene los 3 UUIDs; se puede reconstruir la cadena de cálculo

### REQ-CAR-004: Ciclo de validación en resultados
**Priority**: SHOULD
**Description**: Los resultados analíticos deben tener validation_status para trazabilidad de calidad del pipeline de cómputo.

#### Scenario: Resultado validado contra benchmark sintético
- **WHEN**: Un resultado de HI pasa verificación contra datos sintéticos con valores esperados
- **THEN**: validation_status cambia a bench_validated; resultados no validados permanecen en draft
