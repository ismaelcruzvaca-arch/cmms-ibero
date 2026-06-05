# Delta for rul-calibration (SDD 6)

## ADDED Requirements

### Requirement: RUL-D6-001 — Prediction snapshots table

**Priority**: MUST

SDD 6 DEBE crear la tabla `condition_prediction_snapshots` con: id UUID PK DEFAULT gen_random_uuid(), asset_id TEXT NOT NULL, diagnosis_id UUID REFERENCES condition_diagnoses(id), failure_mode_key TEXT NOT NULL, prediction_type TEXT NOT NULL CHECK (prediction_type IN ('rul_estimate','failure_probability','state_estimate')), predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), rul_low NUMERIC, rul_mid NUMERIC, rul_high NUMERIC, unit TEXT DEFAULT 'hours', confidence NUMERIC, method_key TEXT, method_version TEXT, model_key TEXT REFERENCES condition_degradation_models(model_key), model_version INT, threshold_id TEXT, input_analysis_result_ids UUID[], actual_outcome_id UUID NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(). Índices en (asset_id, predicted_at DESC) y (diagnosis_id).

**Razon**: Sin snapshots históricos no hay calibración. El sistema necesita saber qué predijo y cuándo, no solo el último valor.

#### Scenario: Tabla existe con schema completo

- **GIVEN** migración SDD 6 rul-calibration ejecutada
- **WHEN** se consulta information_schema
- **THEN** condition_prediction_snapshots existe con todas las columnas, CHECK constraint en prediction_type, FK a condition_diagnoses y condition_degradation_models, DEFAULT en predicted_at=NOW() y created_at=NOW()

#### Scenario: Índices creados para consultas por asset y diagnosis

- **GIVEN** la tabla existe
- **WHEN** se revisan los índices
- **THEN** existen idx_cps_asset_predicted ON (asset_id, predicted_at DESC) y idx_cps_diagnosis ON (diagnosis_id)

### Requirement: RUL-D6-002 — Snapshot population

**Priority**: MUST

SDD 6 DEBE modificar `compute_rul_linear()` para insertar una fila en `condition_prediction_snapshots` cuando el RUL se computa exitosamente. Si los gates fallan (rul_hours IS NULL), NO debe insertar snapshot.

**Razon**: El snapshot debe crearse en tiempo de predicción, no retroactivamente.

#### Scenario: compute_rul_linear exitoso inserta snapshot

- **GIVEN** compute_rul_linear() retorna rul_hours=1920, uncertainty_low=1728, uncertainty_high=2112
- **WHEN** la función completa
- **THEN** condition_prediction_snapshots tiene 1 fila nueva con prediction_type='rul_estimate', rul_mid=1920, rul_low=1728, rul_high=2112, method_key='linear_extrapolation', actual_outcome_id=NULL

#### Scenario: Gates bloquean — sin inserción

- **GIVEN** compute_rul_linear() retorna rul_hours=NULL por R²=0.3
- **WHEN** gates bloquean
- **THEN** condition_prediction_snapshots no recibe nuevas filas

### Requirement: RUL-D6-003 — Calibration metrics

**Priority**: MUST

SDD 6 DEBE crear `compute_rul_calibration(p_asset_id TEXT, p_failure_mode_key TEXT DEFAULT NULL, p_days INT DEFAULT 365)` que retorna: bias NUMERIC (mean error), mape NUMERIC (mean absolute percentage error), underestimate_rate NUMERIC (rul_actual > rul_predicted), overestimate_rate NUMERIC (rul_actual < rul_predicted), confidence_calibration NUMERIC (proporción de predicciones donde el valor real cayó dentro del intervalo de confianza). Con 0 datos linkeados, retorna NULLs sin error.

**Razon**: Métricas estándar de evaluación de pronósticos (forecast evaluation).

#### Scenario: Métricas calculadas con datos históricos

- **GIVEN** 10 snapshots linkeados a outcomes, errores conocidos
- **WHEN** compute_rul_calibration('BANDA-TR-01') se ejecuta
- **THEN** bias, mape, underestimate_rate, overestimate_rate, confidence_calibration retornan valores calculados

#### Scenario: Sin datos no genera error

- **GIVEN** ningún snapshot tiene actual_outcome_id
- **WHEN** compute_rul_calibration('BANDA-TR-01') se ejecuta
- **THEN** retorna bias=NULL, mape=NULL, underestimate_rate=NULL, overestimate_rate=NULL, confidence_calibration=NULL (sin EXCEPTION)

### Requirement: RUL-D6-004 — Outcome linking

**Priority**: MUST

SDD 6 DEBE crear `link_rul_outcomes(p_diagnosis_id UUID, p_outcome_id UUID)` que UPDATE condition_prediction_snapshots SET actual_outcome_id=p_outcome_id WHERE diagnosis_id=p_diagnosis_id AND actual_outcome_id IS NULL. Puede invocarse manualmente o mediante trigger AFTER INSERT en condition_outcomes.

**Razon**: Vincula predicciones históricas con realidad operativa para calibración.

#### Scenario: Link vincula snapshots por diagnosis

- **GIVEN** 3 snapshots con diagnosis_id='D1', actual_outcome_id=NULL; un outcome con id='O1'
- **WHEN** link_rul_outcomes('D1', 'O1')
- **THEN** las 3 filas tienen actual_outcome_id='O1'

#### Scenario: Sin snapshots no falla

- **GIVEN** ningún snapshot con diagnosis_id='D2'
- **WHEN** link_rul_outcomes('D2', 'O1')
- **THEN** 0 filas actualizadas, sin error

### Requirement: RUL-D6-005 — RLS

**Priority**: MUST

SDD 6 DEBE aplicar RLS: SELECT para authenticated. INSERT permitido solo desde SECURITY DEFINER (compute_rul_linear). ADMIN puede UPDATE actual_outcome_id. DELETE no permitido (append-only).

**Razon**: Los snapshots son append-only; solo el sistema los crea.

#### Scenario: SELECT accesible para authenticated

- **GIVEN** usuario con rol authenticated
- **WHEN** SELECT FROM condition_prediction_snapshots
- **THEN** filas retornadas normalmente

#### Scenario: INSERT directo bloqueado

- **GIVEN** usuario ADMIN intenta INSERT directo
- **WHEN** INSERT INTO condition_prediction_snapshots
- **THEN** RLS bloquea — solo la función compute_rul_linear() puede insertar

#### Scenario: ADMIN puede actualizar actual_outcome_id

- **GIVEN** usuario con rol ADMIN
- **WHEN** UPDATE condition_prediction_snapshots SET actual_outcome_id='O1'
- **THEN** operación exitosa

#### Scenario: No-ADMIN no puede actualizar

- **GIVEN** usuario con rol TECHNICIAN
- **WHEN** UPDATE condition_prediction_snapshots SET actual_outcome_id='O1'
- **THEN** RLS bloquea
