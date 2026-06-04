# Spec: Calibración de RUL

## Purpose

Infraestructura para medir precisión de predicciones de RUL contra resultados reales. Almacena snapshots de cada predicción, las vincula con outcomes confirmados, y calcula métricas de calibración (bias, MAPE, underestimate/overestimate rate, confidence calibration). Sin snapshots no hay calibración posible.

## Requirements

### RUL-CAL-001: Tabla condition_prediction_snapshots

**Priority**: MUST

El sistema DEBE exponer `condition_prediction_snapshots` con: id UUID PK, asset_id TEXT, diagnosis_id UUID FK, failure_mode_key TEXT, prediction_type TEXT CHECK (rul_estimate/failure_probability/state_estimate), predicted_at TIMESTAMPTZ, rul_low NUMERIC, rul_mid NUMERIC, rul_high NUMERIC, unit TEXT DEFAULT 'hours', confidence NUMERIC, method_key TEXT, method_version TEXT, model_key TEXT FK, model_version INT, threshold_id TEXT, input_analysis_result_ids UUID[], actual_outcome_id UUID FK NULL, created_at TIMESTAMPTZ. Índices en (asset_id, predicted_at) y (diagnosis_id).

#### Scenario: Tabla creada con columnas e índices

- **GIVEN** migración SDD 6 rul-calibration ejecutada
- **WHEN** se inspecciona el schema
- **THEN** la tabla existe con todas las columnas, CHECK en prediction_type, FK a condition_diagnoses y condition_degradation_models, e índices en (asset_id, predicted_at) y (diagnosis_id)

#### Scenario: FK nullable permite snapshots sin outcome

- **GIVEN** un snapshot sin outcome confirmado aún
- **WHEN** actual_outcome_id es NULL
- **THEN** el INSERT es exitoso — el link se establece después

### RUL-CAL-002: Población de snapshots desde compute_rul_linear

**Priority**: MUST

`compute_rul_linear()` DEBE insertar una fila en `condition_prediction_snapshots` cada vez que computa un RUL exitosamente. Si los gates fallan, NO debe insertar snapshot.

#### Scenario: RUL exitoso crea snapshot

- **GIVEN** compute_rul_linear() retorna rul_hours=1920, confidence=0.85, uncertainty_low=1728, uncertainty_high=2112
- **WHEN** la función completa exitosamente
- **THEN** se inserta fila en condition_prediction_snapshots con rul_mid=1920, rul_low=1728, rul_high=2112, confidence=0.85, prediction_type='rul_estimate', method_key='linear_extrapolation', predicted_at=NOW(), actual_outcome_id=NULL

#### Scenario: Gates bloquean, no hay snapshot

- **GIVEN** compute_rul_linear() retorna rul_hours=NULL por R² < 0.5
- **WHEN** los gates bloquean el cómputo
- **THEN** NO se inserta fila en condition_prediction_snapshots

### RUL-CAL-003: Métricas de calibración

**Priority**: MUST

El sistema DEBE exponer `compute_rul_calibration(p_asset_id TEXT, p_failure_mode_key TEXT DEFAULT NULL, p_days INT DEFAULT 365)` que retorna: bias (mean error), mape (mean absolute percentage error), underestimate_rate, overestimate_rate, confidence_calibration. Con 0 datos, retorna NULLs (no error).

#### Scenario: Calibración calculada con datos

- **GIVEN** 10 snapshots con actual_outcome_id linkeado, 7 con error < 20%, 2 underestimates, 1 overestimate
- **WHEN** se ejecuta compute_rul_calibration()
- **THEN** bias ≈ valor calculado, mape ≈ ~X%, underestimate_rate=0.2, overestimate_rate=0.1, confidence_calibration calculado

#### Scenario: Sin datos retorna NULLs

- **GIVEN** ningún snapshot tiene actual_outcome_id
- **WHEN** se ejecuta compute_rul_calibration()
- **THEN** bias IS NULL, mape IS NULL, underestimate_rate IS NULL, overestimate_rate IS NULL, confidence_calibration IS NULL (sin error)

### RUL-CAL-004: Vinculación de outcomes

**Priority**: MUST

El sistema DEBE exponer `link_rul_outcomes()` (SIN parámetros) que recorre automáticamente
`condition_prediction_snapshots` sin linkear (`actual_outcome_id IS NULL`) y los vincula con
outcomes confirmados matcheando por `asset_id + failure_mode_key`. Retorna INT con la cantidad
de snapshots linkeados. Puede llamarse manualmente o mediante trigger AFTER INSERT en
condition_outcomes.

La función usa SECURITY DEFINER y JOIN automático contra `condition_diagnoses` +
`condition_failure_mode_catalog` para resolver el match. Solo vincula snapshots cuya
`predicted_at` sea anterior al `created_at` del outcome.

#### Scenario: Batch auto-link vincula snapshots por asset+FM

- **GIVEN** 2 snapshots con asset_id='A1', failure_mode_key='pump.cavitation', actual_outcome_id=NULL
- **GIVEN** un outcome confirmado para diagnosis con asset_id='A1' y failure_mode_key='pump.cavitation'
- **WHEN** se ejecuta link_rul_outcomes()
- **THEN** los 2 snapshots tienen actual_outcome_id set al ID del outcome
- **AND** el retorno es 2 (filas actualizadas)

#### Scenario: Sin datos no falla

- **GIVEN** ningún snapshot con actual_outcome_id=NULL
- **WHEN** se ejecuta link_rul_outcomes()
- **THEN** la función completa sin error, retorna 0

### RUL-CAL-005: RLS

**Priority**: MUST

SELECT para authenticated. INSERT solo desde función (SECURITY DEFINER en compute_rul_linear). ADMIN puede UPDATE actual_outcome_id.

#### Scenario: Authenticated puede SELECT

- **GIVEN** usuario con rol authenticated
- **WHEN** ejecuta SELECT FROM condition_prediction_snapshots
- **THEN** retorna filas (no bloqueado)

#### Scenario: Solo ADMIN puede UPDATE actual_outcome_id

- **GIVEN** usuario con rol TECHNICIAN
- **WHEN** intenta UPDATE actual_outcome_id
- **THEN** RLS bloquea la operación

#### Scenario: INSERT directo bloqueado para todos

- **GIVEN** usuario con rol ADMIN
- **WHEN** intenta INSERT directo en condition_prediction_snapshots
- **THEN** RLS bloquea — solo compute_rul_linear() via SECURITY DEFINER puede insertar
