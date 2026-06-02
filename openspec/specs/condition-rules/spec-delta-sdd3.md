# Delta SDD 3: Reglas de Condición

## ADDED Requirements

### REQ-CRUL-D3-006: Nueva evaluación — z_score_threshold
**MUST** — evaluation_type='z_score_threshold' configura reglas que disparan cuando el z-score del residual excede min_z_score durante duration_windows consecutivas. rule_config: min_z_score DOUBLE PRECISION (default 3.0), duration_windows INT (default 1). severity_limit puede ser 'info' (field_trial) o 'warning'+ (active).

#### Scenario: z_score_threshold con duración
- **WHEN**: Regla configurada con min_z_score=3.0, duration_windows=3, severity_limit='warning'
- **THEN**: Evalúa residuals recientes; dispara si 3+ ventanas consecutivas tienen z ≥ 3.0

#### Scenario: z_score_threshold sin duración (una ventana)
- **WHEN**: Regla configurada con min_z_score=4.0, duration_windows=1
- **THEN**: Dispara si una sola ventana excede z=4.0 (evento agudo)

### REQ-CRUL-D3-007: Nueva evaluación — trend_significance
**MUST** — evaluation_type='trend_significance' usa compute_feature_trend(). rule_config: min_r_squared DOUBLE PRECISION (default 0.5), min_slope_abs DOUBLE PRECISION. Solo dispara si trend confidence > 0.5 y R² >= min_r_squared.

#### Scenario: Trend significativo dispara regla
- **WHEN**: compute_feature_trend() retorna R²=0.7, slope=0.03; regla con min_r_squared=0.5, min_slope_abs=0.01
- **THEN**: Regla dispara (ambos umbrales superados, confidence suficiente)

#### Scenario: R² bajo bloquea disparo
- **WHEN**: compute_feature_trend() retorna R²=0.3 (confidence=0.0)
- **THEN**: Regla no dispara (gate de confianza)

## MODIFIED Requirements

### REQ-CRUL-002: Evaluación contextualizada por feature + método + régimen + clase (Modificado)
**MUST** — Las reglas deben evaluarse combinando feature_key + method_key + regime + asset_class, NO como condiciones genéricas. El contexto operativo es parte de la evaluación. SE AGREGA que evaluation_type='residual' ahora tiene implementación real (era no-op placeholder). Nuevos tipos: z_score_threshold, innovation_threshold, trend_significance, compound_anomaly.
(Previously: evaluation_type='residual' era no-op NULL)

#### Scenario: Residual evalúa con z-score real (ya no es no-op)
- **GIVEN**: feature_key=vibration.rms, evaluation_type='z_score_threshold', regime=FULL_LOAD, residual z=3.5
- **WHEN**: evaluate_condition_rules() ejecuta
- **THEN**: Regla evalúa a true porque z-score excede min_z_score

### REQ-CRUL-001: Definición de reglas versionadas (Modificado)
**MUST** — rule_config soporta nuevos parámetros según evaluation_type: z_score_threshold (min_z_score, duration_windows), innovation_threshold (min_innovation_sigma, duration_windows), trend_significance (min_r_squared, min_slope_abs), compound_anomaly (conditions[], operator). evaluation_type CHECK constraint actualizado para incluir los nuevos tipos.
(Previously: evaluation_type solo soportaba threshold y residual placeholder)

#### Scenario: Regla z_score_threshold registrada con configuración
- **WHEN**: Se inserta regla con evaluation_type='z_score_threshold', rule_config={"min_z_score":3.0,"duration_windows":3}, severity='warning'
- **THEN**: La regla queda versionada (v1) con validation_status='draft'
