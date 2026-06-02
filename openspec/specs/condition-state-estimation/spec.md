# Spec: Estimación de Estado (Kalman 1D)

## Purpose

`compute_kalman_1d()` implementa un filtro Kalman escalar en PL/pgSQL para estimar el estado latente de un feature. La innovación (diferencia entre medición y predicción) es la señal clave para detección de anomalías: innovación grande y sostenida = evidencia, no ruido.

## Requirements

### REQ-KALM-001: Función compute_kalman_1d()
**MUST** — `compute_kalman_1d(asset_id UUID, feature_definition_id UUID, method_key VARCHAR, Q DOUBLE PRECISION, R DOUBLE PRECISION)` implementa el filtro en PL/pgSQL (~80 LOC). Almacena estado estimado en condition_analysis_results con analysis_type='kalman_state'.

**Algoritmo por ventana:**
1. Predict: x̂ₖ⁻ = x̂ₖ₋₁, Pₖ⁻ = Pₖ₋₁ + Q
2. Innovation: yₖ = zₖ - x̂ₖ⁻ (zₖ = valor medido)
3. Innovation variance: Sₖ = Pₖ⁻ + R
4. Kalman gain: Kₖ = Pₖ⁻ / Sₖ
5. Update: x̂ₖ = x̂ₖ⁻ + Kₖ * yₖ, Pₖ = (1 - Kₖ) * Pₖ⁻

#### Scenario: Kalman filtra ruido en feature estable
- **GIVEN** vibration.rms valores ~2.3±0.15 (ruido), Q=0.01, R=0.04, state inicial=baseline_mean=2.3
- **WHEN** compute_kalman_1d() procesa 10 ventanas
- **THEN** state_estimate converge ~2.3 con state_variance decreciente; innovation pequeña (~±0.15); kalman_gain estable ~0.2

#### Scenario: Kalman sigue cambio gradual (slow drift)
- **GIVEN** vibration.rms incrementa 2.3→3.0 en 20 ventanas (slow drift)
- **WHEN** compute_kalman_1d() procesa secuencialmente
- **THEN** state_estimate sigue el drift con lag; innovation positiva consistente; innovation_variance captura la incertidumbre

### REQ-KALM-002: Parámetros Q y R configurables
**MUST** — Q (process noise) y R (measurement noise) se almacenan en condition_analysis_methods.default_parameters como JSONB. compute_kalman_1d() acepta Q y R como parámetros; si no se proveen, usa default_parameters del método.

| Parámetro | Default | Efecto |
|-----------|---------|--------|
| Q (process noise) | 0.01 | Mayor Q = filtro más responsivo (sigue cambios rápido) |
| R (measurement noise) | 0.04 | Mayor R = filtro más suave (rechaza ruido) |

#### Scenario: Q/R desde default_parameters del método
- **GIVEN** method_key='rms_velocity_window' con default_parameters={"kalman_q": 0.01, "kalman_r": 0.04}
- **WHEN** compute_kalman_1d() llamada sin Q/R explícitos
- **THEN** Usa Q=0.01, R=0.04 desde la configuración del método

### REQ-KALM-003: Almacenamiento auditable del estado Kalman
**MUST** — Cada resultado kalman_state almacena: analysis_type='kalman_state', result_value=state_estimate, state_variance, innovation, innovation_variance, kalman_gain, parameters con Q, R, method_version. Todos los campos numéricos en DOUBLE PRECISION.

#### Scenario: Estado Kalman completo almacenado
- **GIVEN** compute_kalman_1d() procesa ventana con z=2.5, predict=2.35, P⁻=0.03
- **WHEN** Almacena resultado
- **THEN** condition_analysis_results contiene: state_estimate=2.42, state_variance=0.024, innovation=0.15, innovation_variance=0.064, kalman_gain=0.234, parameters={"Q": 0.01, "R": 0.04, "method_version": "1.0"}

### REQ-KALM-004: Innovación como evidencia de anomalía
**MUST** — Si |innovation| > 3 * SQRT(innovation_variance) sostenido por 3+ ventanas consecutivas, el sistema lo considera evidencia de anomalía (no ruido). Disponible para reglas ADET.

#### Scenario: Innovación sostenida señala anomalía
- **GIVEN** 4 ventanas consecutivas con innovation > 3σ_innovation (ej: innovation=0.45, σ=0.08)
- **WHEN** Evaluación de reglas consulta kalman_state reciente
- **THEN** Detección de anomalía por innovación dispara; no se descarta como ruido

#### Scenario: Innovación aislada no genera alerta
- **GIVEN** Una ventana con innovation alta (0.5) pero ventana anterior y posterior normales
- **WHEN** Evaluación de reglas revisa sostenimiento
- **THEN** No se genera evento por innovación; se marca como outlier
