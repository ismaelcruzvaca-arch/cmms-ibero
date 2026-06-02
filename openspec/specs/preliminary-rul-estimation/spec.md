# Spec: Estimación Preliminar de RUL (Vida Útil Remanente)

## Purpose

Función PL/pgSQL que estima RUL mediante extrapolación lineal de tendencia de degradación. No es un pronóstico avanzado — es un cálculo conservador con gates estrictos, intervalo de confianza y supuestos documentados.

## Requirements

### RUL-001: Función compute_rul_linear

**Priority**: MUST

El sistema DEBE exponer `compute_rul_linear(p_asset_id TEXT, p_feature_key TEXT, p_failure_mode_key TEXT) RETURNS TABLE(rul_hours NUMERIC, confidence NUMERIC, uncertainty_low NUMERIC, uncertainty_high NUMERIC, assumptions TEXT[])`.

RUL = (threshold_value - current_value) / |slope| cuando slope > 0 (degradación creciente).

#### Scenario: RUL calculado correctamente

- **GIVEN** vibration.rms actual=5.5, threshold zone_c_max=7.1, slope=0.02 mm/s/día
- **WHEN** se ejecuta compute_rul_linear para feature_key=`vibration.rms`, failure_mode_key=`pump.cavitation`
- **THEN** rul_hours ≈ 1920 horas ((7.1-5.5)/0.02 = 80 días = 1920 horas)

#### Scenario: Slope negativo retorna NULL

- **GIVEN** slope=-0.01 (degradación decreciente, activo mejorando)
- **WHEN** se ejecuta compute_rul_linear
- **THEN** rul_hours IS NULL — no se estima RUL si no hay degradación activa

### RUL-002: Gates estrictos de calidad

**Priority**: MUST

compute_rul_linear DEBE verificar todos los gates antes de computar: slope > 0, R² ≥ 0.5, muestras ≥ 10, régimen consistente, calidad G0/G1, threshold definido en `condition_threshold_catalog`.

#### Scenario: R² insuficiente bloquea RUL

- **GIVEN** trend_slope con r_squared=0.3
- **WHEN** gate R² < 0.5
- **THEN** rul_hours IS NULL; assumptions contiene `'r2_below_threshold:0.3'`

#### Scenario: Muestras insuficientes bloquean RUL

- **GIVEN** solo 5 muestras disponibles
- **WHEN** gate muestras < 10
- **THEN** rul_hours IS NULL; assumptions contiene `'insufficient_samples:5'`

#### Scenario: Calidad G2 bloquea RUL

- **GIVEN** feature_values con quality_flag=`G2`
- **WHEN** gate quality > G1
- **THEN** rul_hours IS NULL; assumptions contiene `'quality_too_low:G2'`

### RUL-003: Intervalo de confianza

**Priority**: MUST

El RUL NO DEBE ser un número único. uncertainty_low y uncertainty_high DEBEN definir un intervalo basado en el error estándar de la regresión.

#### Scenario: RUL con intervalo ±20%

- **GIVEN** rul_hours=1920, error estándar=10%
- **WHEN** se ejecuta compute_rul_linear
- **THEN** uncertainty_low=1728, uncertainty_high=2112 (1920 × 0.9 y 1920 × 1.1)

### RUL-004: Almacenamiento en condition_analysis_results

**Priority**: MUST

El resultado DEBE almacenarse en `condition_analysis_results` con analysis_type=`rul_estimate`, method_key=`linear_extrapolation`. Metadata DEBE incluir: current_value, threshold_value, slope, r2, failure_mode_id, trend_result_id.

#### Scenario: RUL almacenado con metadata completa

- **GIVEN** RUL computado exitosamente
- **WHEN** se ejecuta compute_rul_linear
- **THEN** se inserta registro en condition_analysis_results con analysis_type=`rul_estimate`, result_value=1920, result_unit=`hours`, y JSONB parameters que contiene current_value, threshold_value, slope, r2, failure_mode_id, trend_result_id

#### Scenario: RUL no almacenado si gates fallan

- **GIVEN** R² < 0.5
- **WHEN** gates bloquean
- **THEN** NO se inserta registro en condition_analysis_results

### RUL-005: Diagnosis confidence como gate adicional

**Priority**: SHOULD

compute_rul_linear DEBE aceptar p_diagnosis_confidence NUMERIC como parámetro opcional. Si < 0.5, RUL no se computa (gate adicional).

#### Scenario: Confianza diagnóstica baja bloquea RUL

- **GIVEN** diagnosis_confidence=0.3 para pump.cavitation
- **WHEN** se ejecuta compute_rul_linear con p_diagnosis_confidence=0.3
- **THEN** rul_hours IS NULL; assumptions contiene `'diagnosis_confidence_too_low:0.3'`
