# Spec: Reglas de Condición

## Requirements

### REQ-CRUL-001: Definición de reglas versionadas
**Priority**: MUST
**Description**: La tabla `condition_rules` debe almacenar: rule_name, description, asset_class, feature_key, method_key (nullable), regime, min_quality_flag, evaluation_type, rule_config (JSONB), severity, action, validation_status, version.

#### Scenario: Regla de umbral con duración registrada
- **WHEN**: Se inserta regla con evaluation_type=`threshold`, rule_config=`{"threshold": 7.1, "duration_windows": 3, "min_confidence": 0.9}`, severity=`critical`, action=`create_wo`
- **THEN**: La regla queda versionada (v1) con validation_status=`draft`, lista para validación

#### Scenario: Regla con method_key opcional
- **WHEN**: Se inserta regla con method_key=NULL
- **THEN**: La regla aplica a cualquier método que produzca el feature_key especificado

### REQ-CRUL-002: Evaluación contextualizada por feature + método + régimen + clase
**Priority**: MUST
**Description**: Las reglas deben evaluarse combinando feature_key + method_key + regime + asset_class, NO como condiciones genéricas (`vibration.rms > 7.1`). El contexto operativo es parte de la evaluación.

#### Scenario: Regla dispara con contexto coincidente
- **WHEN**: feature_key=`vibration.rms`, method_key=`rms_velocity_window`, regime=`FULL_LOAD`, asset_class=`centrifugal_pump`, valor=8.5 (excede zone_c_max=7.1)
- **THEN**: La regla evalúa a true porque coinciden los 4 criterios de contexto

#### Scenario: Regla no dispara por régimen distinto
- **WHEN**: Mismos feature, método y clase pero regime=`STARTUP`
- **THEN**: La regla no aplica porque el contexto operativo no coincide

#### Scenario: Regla no dispara por calidad insuficiente
- **WHEN**: feature con valor que excede umbral pero quality_flag=`G2` y min_quality_flag=`G1`
- **THEN**: La regla no dispara; el filtro de calidad bloquea la evaluación

#### Scenario: Método referenciado en draft/candidate — severity limitado
- **WHEN**: Una regla referencia method_key cuyo validation_status en condition_analysis_methods es `draft` o `candidate`
- **THEN**: La regla se evalúa pero el severity del evento resultante se limita a `warning` como máximo — no se genera OT crítica con método no validado

### REQ-CRUL-003: Reglas compuestas con lógica AND/OR
**Priority**: SHOULD
**Description**: rule_config debe soportar condiciones compuestas con operadores AND/OR anidados para combinar múltiples features y condiciones.

#### Scenario: Regla compuesta AND — ambas condiciones se cumplen
- **WHEN**: rule_config contiene `{"operator": "AND", "conditions": [{"feature": "vibration.rms", "threshold": 7.1}, {"feature": "temperature.bearing", "threshold": 85}]}` y ambos features exceden umbral
- **THEN**: La regla dispara

#### Scenario: Regla compuesta AND — una condición falla
- **WHEN**: Misma regla pero solo vibration.rms excede — temperatura normal
- **THEN**: La regla no dispara

### REQ-CRUL-004: Versionado y ciclo de vida de reglas
**Priority**: MUST
**Description**: Cada regla tiene versión y validation_status con ciclo de vida completo. Modificaciones crean nueva versión; la anterior permanece para auditoría.

#### Scenario: Nueva versión depreca la anterior
- **WHEN**: Se modifica el threshold de una regla activa (v1)
- **THEN**: Se crea v2 con nuevos valores; v1 se marca validation_status=`deprecated` pero se preserva

#### Scenario: Regla deprecated no se evalúa
- **WHEN**: El motor de reglas itera sobre condition_rules para evaluar un feature
- **THEN**: Las reglas con validation_status=`deprecated` o `rejected` son omitidas — solo se evalúan reglas en estado `active` o `field_trial`
