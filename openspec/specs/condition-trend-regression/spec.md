# Spec: Regresión de Tendencia por Feature

## Purpose

`compute_feature_trend()` realiza regresión lineal por feature individual sobre ventanas recientes, retornando slope, R² y métricas de confianza. La tendencia se usa para determinar si el baseline puede actualizarse (R² alta = deterioro activo = no aprender).

## Requirements

### REQ-TRND-001: Función compute_feature_trend()
**MUST** — `compute_feature_trend(asset_id UUID, feature_definition_id UUID, method_key VARCHAR, lookback_windows INT DEFAULT 20)` calcula regresión lineal (y = slope * x + intercept) sobre las últimas N ventanas de condition_windows del feature. Almacena resultado en condition_analysis_results con analysis_type='trend_slope'.

#### Scenario: Tendencia calculada con datos suficientes
- **GIVEN** 20 ventanas de vibration.rms para BANDA-TR-01 en FULL_LOAD, valores incrementales 2.0→2.8
- **WHEN** compute_feature_trend() ejecuta con lookback=20
- **THEN** Retorna slope=0.04, intercept=2.0, R²=0.85, sample_count=20; guarda en condition_analysis_results

#### Scenario: Tendencia almacenada con metadata completa
- **WHEN** compute_feature_trend() ejecuta
- **THEN** Resultado incluye: analysis_type='trend_slope', result_value=slope, r_squared, result_unit='{feature_unit}/day', method_version, window_start, window_end, input_window_ids

### REQ-TRND-002: Confianza y gates de calidad
**MUST** — La función aplica gates antes de reportar tendencia: R² < 0.3 → resultado no confiable (confidence baja); sample_count < 5 → skip sin resultado; régimen mezclado en ventana → skip; >50% ventanas G2/G3 → skip.

| Gate | Condición | Acción |
|------|-----------|--------|
| Confianza baja | R² < 0.3 | result_value=slope, confidence=0.0 |
| Muestras insuficientes | sample_count < 5 | No almacena resultado |
| Régimen mezclado | Más de 1 regime en ventana | Skip |
| Calidad insuficiente | >50% ventanas G2/G3 | Skip |

#### Scenario: R² bajo marca tendencia como no confiable
- **GIVEN** Regresión con R²=0.2, sample_count=20, slope=0.01
- **WHEN** compute_feature_trend() evalúa
- **THEN** Almacena resultado con confidence=0.0; reglas no usarán este slope para decisiones críticas

#### Scenario: Menos de 5 muestras — no se evalúa
- **GIVEN** Solo 3 ventanas disponibles en lookback
- **WHEN** compute_feature_trend() ejecuta
- **THEN** No almacena resultado; retorna advertencia

#### Scenario: Régimen mezclado bloquea tendencia
- **GIVEN** 10 ventanas FULL_LOAD + 10 ventanas IDLE en las últimas 20
- **WHEN** compute_feature_trend() detecta múltiples regimes
- **THEN** Skip; no almacena resultado

### REQ-TRND-003: Metadatos de consistencia de régimen
**MUST** — El resultado debe incluir regime_consistency: porcentaje de ventanas en el régimen predominante. Solo se considera "consistente" si >= 80%.

#### Scenario: Régimen mayoritario consistente
- **GIVEN** 18 de 20 ventanas en FULL_LOAD, 2 en IDLE
- **WHEN** compute_feature_trend() computa
- **THEN** regime_consistency=0.9 (90%); resultado almacenado

#### Scenario: Régimen inconsistencia bloquea
- **GIVEN** 12 FULL_LOAD + 8 PARTIAL_LOAD (60% consistencia)
- **WHEN** compute_feature_trend() evalúa
- **THEN** Skip por regime_consistency < 80%

### REQ-TRND-004: Uso de tendencia en política de aprendizaje
**MUST** — compute_baselines() debe consultar compute_feature_trend() para cada feature. Si R² > 0.5 y slope distinto de cero significativamente, no incluir ventanas recientes en el cálculo del baseline.

#### Scenario: Tendencia activa protege baseline
- **GIVEN** compute_feature_trend() retorna slope=0.04, R²=0.7, confidence=0.95
- **WHEN** compute_baselines() evalúa política de aprendizaje
- **THEN** Ventanas recientes excluidas del cálculo de baseline
