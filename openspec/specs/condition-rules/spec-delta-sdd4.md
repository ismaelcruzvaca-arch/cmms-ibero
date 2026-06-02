# Delta for condition-rules (SDD 4)

## ADDED Requirements

### CRUL-D4-001: Nuevo evaluation_type: diagnostic

**Priority**: MUST

evaluation_type DEBE aceptar el valor `diagnostic`. Una regla de tipo `diagnostic` evalúa la matriz de evidencia (`diagnostic_evidence_matrix`) en lugar de umbrales directos. Cuando una regla diagnóstica dispara, crea un registro en `condition_diagnoses` (NO en `condition_events`).

#### Scenario: Regla diagnóstica crea diagnosis

- **GIVEN** regla con evaluation_type=`diagnostic`, rule_config que referencia failure_mode_key=`pump.cavitation`
- **WHEN** la matriz de evidencia evalúa a true con confidence ≥ 0.5
- **THEN** se crea registro en condition_diagnoses con diagnosis_status=`candidate`; NO se crea evento

#### Scenario: Regla diagnóstica con confidence baja no crea diagnosis

- **GIVEN** evaluation_type=`diagnostic`
- **WHEN** compute_diagnosis_confidence retorna < 0.5
- **THEN** NO se crea diagnosis; la evidencia es insuficiente

### CRUL-D4-002: Ciclo de vida específico para reglas diagnósticas

**Priority**: MUST

Las reglas con evaluation_type=`diagnostic` DEBEN tener validation_status que solo transiciona candidate → field_trial → active. Una regla diagnóstica en estado candidate evalúa pero no crea diagnósticos; en field_trial crea diagnósticos con diagnosis_status=`field_trial`; en active crea diagnósticos con diagnosis_status=`candidate`.

#### Scenario: Regla field_trial crea diagnosis field_trial

- **GIVEN** regla diagnóstica con validation_status=`field_trial`
- **WHEN** la regla dispara
- **THEN** condition_diagnosis se crea con diagnosis_status=`field_trial`

#### Scenario: Regla candidate no crea diagnósticos

- **GIVEN** regla diagnóstica con validation_status=`candidate`
- **WHEN** la regla evalúa a true
- **THEN** se registra internamente pero NO se inserta condition_diagnosis

### CRUL-D4-003: rule_config para reglas diagnósticas

**Priority**: SHOULD

rule_config para evaluation_type=`diagnostic` DEBE contener: failure_mode_key (TEXT), min_confidence_threshold (NUMERIC DEFAULT 0.5), require_field_trial_override (BOOLEAN DEFAULT false), auto_activate_on_threshold (NUMERIC DEFAULT 0.85).

#### Scenario: Configuración de regla diagnóstica

- **GIVEN** regla con evaluation_type=`diagnostic`
- **WHEN** rule_config = {"failure_mode_key": "pump.cavitation", "min_confidence_threshold": 0.5, "auto_activate_on_threshold": 0.85}
- **THEN** la regla usa min_confidence_threshold para determinar si crea diagnosis
