# Spec: Recomendaciones de Mantenimiento

## Purpose

Módulo que genera recomendaciones de mantenimiento trazables desde diagnósticos activos. Combina failure_mode + severity + confidence + RUL + P-F window + asset_criticality para producir una acción recomendada con prioridad y ventana de ejecución. Las recomendaciones desde diagnósticos field_trial NO generan OT automática.

## Requirements

### REC-001: Función generate_recommendation

**Priority**: MUST

La función `generate_recommendation(p_diagnosis_id UUID) RETURNS TEXT` DEBE generar una recomendación de mantenimiento basada en el diagnóstico, su confianza, el RUL asociado (si existe) y la curva P-F del modo de falla. El texto retornado es la recommended_action legible.

#### Scenario: Recomendación generada desde diagnóstico active

- **GIVEN** diagnosis_id con failure_mode_key=`pump.cavitation`, confidence=0.85, RUL=1920h
- **WHEN** se ejecuta generate_recommendation
- **THEN** retorna texto con acción recomendada: `"Inspeccionar bomba por cavitación. Programar mantenimiento dentro de 80 días."`

#### Scenario: Diagnóstico field_trial genera recomendación sin WO

- **GIVEN** diagnosis_status=`field_trial`, confidence=0.65
- **WHEN** se ejecuta generate_recommendation
- **THEN** retorna recomendación con requires_confirmation=true; NO se crea WO

### REC-002: Tabla de recomendaciones

**Priority**: MUST

La tabla `maintenance_recommendations` DEBE almacenar: id (UUID PK), diagnosis_id (FK → condition_diagnoses), recommended_action (TEXT NOT NULL), priority (TEXT CHECK: low, medium, high, critical), due_window_days (INTEGER), work_order_type (TEXT — ej. corrective, preventive, predictive), required_parts (JSONB nullable), required_skills (TEXT[] nullable), requires_confirmation (BOOLEAN DEFAULT true), created_at (TIMESTAMPTZ DEFAULT NOW()).

#### Scenario: Recomendación almacenada con prioridad

- **GIVEN** diagnóstico con severity_default=`critical`, confidence=0.85
- **WHEN** se genera la recomendación
- **THEN** priority=`high`, work_order_type=`predictive`

#### Scenario: Partes requeridas documentadas

- **GIVEN** pump.cavitation requiere mechanical_seal y bearing
- **WHEN** se genera recommendación
- **THEN** required_parts contiene `{"seal_mechanical": 1, "bearing_6205": 2}`

### REC-003: Recomendación → Work Order por confirmación

**Priority**: MUST

Cuando `requires_confirmation=false` Y diagnosis_status=`active` Y confidence ≥ 0.7 Y severity=`critical`, el sistema DEBE crear una work_order automáticamente desde la recomendación.

#### Scenario: WO creada desde recomendación crítica

- **GIVEN** recomendación con priority=`critical`, requires_confirmation=false, diagnosis_status=`active`, confidence=0.85
- **WHEN** se confirma automáticamente
- **THEN** se crea work_order con tipo `predictive`, prioridad `critical`, y diagnosis_id vinculado

#### Scenario: Field_trial no genera WO

- **GIVEN** diagnosis_status=`field_trial` independientemente de confidence
- **WHEN** se procesa recomendación
- **THEN** requires_confirmation=true siempre; NO se crea WO automática

### REC-004: Ventana de ejecución desde P-F curve y RUL

**Priority**: SHOULD

due_window_days DEBE calcularse como el mínimo entre intervention_window_days (desde P-F curve) y rul_days (desde RUL estimate).

#### Scenario: Ventana acotada por P-F curve

- **GIVEN** intervention_window_days=14, rul_days=80
- **WHEN** se genera recommendation
- **THEN** due_window_days=14 (la ventana P-F es más restrictiva)
