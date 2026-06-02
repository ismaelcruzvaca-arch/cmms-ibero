# Spec: Reglas de Detección de Anomalías

## Purpose

Reglas específicas que usan z-score del residual, innovación de Kalman, y significancia de tendencia para detectar anomalías. Distinguen field_trial (solo informativo) vs active (genera evento real). Complementan las reglas de umbral de SDD 1.

## Requirements

### REQ-ADET-001: Tipos de evaluación para detección
**MUST** — Soporta evaluation_type: z_score_threshold (residual vs baseline), innovation_threshold (Kalman), trend_significance (R² + slope). Se almacenan en condition_rules con evaluation_type correspondiente.

| Tipo | Señal | Parámetros | Uso |
|------|-------|------------|-----|
| z_score_threshold | residual z-score | min_z_score, duration_windows | Desviación sostenida del baseline |
| innovation_threshold | Kalman innovation | min_innovation_sigma, duration_windows | Cambio no explicado por el modelo |
| trend_significance | Regresión lineal | min_r_squared, min_slope_abs | Deterioro progresivo |
| compound_anomaly | Combinación de tipos | conditions[], operator | Detección multi-señal |

#### Scenario: Regla z_score_threshold dispara por residual sostenido
- **GIVEN** rule_config={"min_z_score": 3.0, "duration_windows": 3}, feature vibration.rms
- **WHEN** compute_baseline_residual() retorna z=3.2, 3.5, 3.1 en 3 ventanas consecutivas
- **THEN** Regla dispara → condition_event creado con severity=warning

#### Scenario: Regla innovation_threshold detecta cambio súbito
- **GIVEN** rule_config={"min_innovation_sigma": 3.0, "duration_windows": 3}
- **WHEN** compute_kalman_1d() produce innovation=0.45, 0.50, 0.48 (σ=0.08 → 5.6σ-6.25σ)
- **THEN** Regla dispara → evento con severity=warning

#### Scenario: Regla trend_significance con R² insuficiente no dispara
- **GIVEN** rule_config={"min_r_squared": 0.5, "min_slope_abs": 0.01}
- **WHEN** compute_feature_trend() retorna R²=0.3 (reliable=false)
- **THEN** Regla no dispara; resultado con confidence=0.0

### REQ-ADET-002: Distinción field_trial vs active
**MUST** — Las reglas tienen severity_limit. Si severity_limit='info', el evento se marca field_trial (solo registra, no crea OT). Si severity_limit='warning' o 'critical', es active (evento real, puede crear OT).

#### Scenario: Regla field_trial registra evento sin OT
- **GIVEN** Regla con severity_limit='info' y evaluation_type='z_score_threshold'
- **WHEN** Regla dispara
- **THEN** condition_event creado con event_type='field_trial'; no se genera OT

#### Scenario: Regla activa genera evento real
- **GIVEN** Regla con severity='warning' y evaluation_type='innovation_threshold'
- **WHEN** Regla dispara
- **THEN** condition_event creado con event_type='active'; disponible para flujo de creación de OT

### REQ-ADET-003: Reglas compuestas
**SHOULD** — rule_config soporta compound_anomaly con operador AND/OR combinando condiciones de z_score, innovation y trend.

#### Scenario: Compuesta AND — ambas condiciones requeridas
- **GIVEN** compound_anomaly con operator='AND': [z_score_threshold(z>3, 3w), trend_significance(R²>0.5, slope>0.02)]
- **WHEN** z_score=3.2 sostenido 3 ventanas Y trend R²=0.7, slope=0.03
- **THEN** Regla dispara (ambas condiciones true)

#### Scenario: Compuesta AND — una condición falla, no dispara
- **GIVEN** Misma regla compuesta
- **WHEN** z_score=3.2 sostenido pero trend R²=0.2
- **THEN** Regla no dispara (condición trend no se cumple)

### REQ-ADET-004: Integración con evaluate_condition_rules()
**MUST** — evaluate_condition_rules() debe procesar evaluation_type IN ('z_score_threshold','innovation_threshold','trend_significance','compound_anomaly'). Para compound_anomaly, evalúa subcondiciones y aplica operador lógico.

#### Scenario: evaluate_condition_rules() evalúa gate de calidad
- **GIVEN** Regla z_score_threshold con min_quality_flag='G1', ventana con quality_flag='G2'
- **WHEN** evaluate_condition_rules() evalúa
- **THEN** Regla no evalúa por calidad insuficiente (gate previo)
