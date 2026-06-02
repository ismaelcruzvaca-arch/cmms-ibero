# Spec: Matriz de Evidencia Diagnóstica

## Purpose

Patrones de evidencia multi-feature que definen qué combinaciones de indicadores (umbral, residual, tendencia) sustentan o contradicen una hipótesis de falla. Cada patrón se compone de evidencias required, supporting y contradictory.

## Requirements

### DEM-001: Esquema de la matriz de evidencia

**Priority**: MUST

La tabla `diagnostic_evidence_matrix` DEBE almacenar: id (UUID PK DEFAULT gen_random_uuid()), failure_mode_id (FK → condition_failure_mode_catalog), feature_key (TEXT), condition_type (TEXT CHECK: threshold, residual, trend), op (TEXT CHECK: >, <, >=, <=, =), value (NUMERIC), logical_operator (TEXT CHECK: AND, OR), evidence_role (TEXT CHECK: required, supporting, contradictory), min_quality (TEXT DEFAULT 'G2'), min_confidence (NUMERIC DEFAULT 0.5), required_regime (TEXT nullable), window_count (INT DEFAULT 1).

#### Scenario: Evidencia required registrada

- **GIVEN** failure_mode_key=`pump.cavitation`
- **WHEN** se inserta evidencia: feature_key=`vibration.rms`, condition_type=`threshold`, op=`>=`, value=7.1, evidence_role=`required`, logical_operator=`AND`
- **THEN** la evidencia se marca como required — sin ella no puede existir el diagnóstico

#### Scenario: Evidencia contradictory registrada

- **GIVEN** failure_mode_key=`pump.cavitation`
- **WHEN** se inserta evidencia: feature_key=`pressure.discharge`, condition_type=`threshold`, op=`>`, value=90, evidence_role=`contradictory`
- **THEN** si pressure.discharge > 90, esta evidencia penaliza la confianza del diagnóstico

### DEM-002: Patrón completo de cavitación

**Priority**: MUST

El seed DEBE incluir un patrón completo para pump.cavitation con: evidencia required (vibration.rms > umbral AND pressure.vibration_peak > umbral), evidencia supporting (temperature.bearing elevada), evidencia contradictory (pressure.discharge normal).

#### Scenario: Patrón de cavitación cargado

- **GIVEN** migración ejecutada
- **WHEN** se consultan evidencias para failure_mode_key=`pump.cavitation`
- **THEN** existen al menos 1 required + 1 supporting + 1 contradictory

### DEM-003: Patrón completo de desbalance

**Priority**: MUST

El seed DEBE incluir un patrón completo para rotating.unbalance con: evidencia required (vibration.rms 1X componente), evidencia supporting (vibration.phase estable), evidencia contradictory (vibration.rms > 5 armónicos indica desalineación en vez de desbalance).

#### Scenario: Patrón de desbalance cargado

- **GIVEN** migración ejecutada
- **WHEN** se consultan evidencias para failure_mode_key=`rotating.unbalance`
- **THEN** existen al menos 1 required + 1 supporting + 1 contradictory

### DEM-004: Evaluación de matriz de evidencia

**Priority**: MUST

El sistema DEBE exponer una función `evaluate_evidence_matrix(p_failure_mode_id UUID, p_asset_id TEXT)` que evalúe cada fila de la matriz contra los últimos feature_values del activo y retorne: evidencias cumplidas, evidencias fallidas, contradictory_evidence_count, supporting_evidence_count.

#### Scenario: Evaluación con evidencia required cumplida

- **GIVEN** vibration.rms=8.5 excede umbral 7.1 para pump.cavitation
- **WHEN** se ejecuta evaluate_evidence_matrix
- **THEN** retorna required_met=true, contradictory_count=0

#### Scenario: Evidencia required no cumplida

- **GIVEN** vibration.rms=3.2, bajo umbral 7.1
- **WHEN** se ejecuta evaluate_evidence_matrix
- **THEN** retorna required_met=false, evidencia insuficiente para diagnosticar cavitación

#### Scenario: Evidencia contradictoria presente

- **GIVEN** vibration.rms=8.5 Y pressure.discharge=95 (> 90)
- **WHEN** se ejecuta evaluate_evidence_matrix para pump.cavitation
- **THEN** retorna contradictory_count=1, evidencia contradictoria detectada

### DEM-005: Calidad y régimen como filtros de evidencia

**Priority**: SHOULD

La evaluación de evidencia DEBE filtrar por min_quality y required_regime. Si la calidad del feature_value es inferior a min_quality, la evidencia no se considera cumplida ni incumplida — se marca como `insufficient_quality`.

#### Scenario: Calidad insuficiente para evaluar

- **GIVEN** feature_value con quality_flag=`G3` y min_quality=`G1`
- **WHEN** se evalúa la matriz
- **THEN** la evidencia se marca como `insufficient_quality` — no afecta el score (missing evidence ≠ contradictory)

#### Scenario: Régimen no coincide

- **GIVEN** required_regime=`FULL_LOAD` y activo en régimen `STARTUP`
- **WHEN** se evalúa la matriz
- **THEN** la evidencia no se evalúa por contexto operativo incorrecto
