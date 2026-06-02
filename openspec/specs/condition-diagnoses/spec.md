# Spec: Diagnósticos de Condición

## Purpose

Tabla central de diagnósticos — hipótesis de falla generadas por el motor de reglas diagnósticas. Separada de `condition_events` (evento = algo pasó, diagnóstico = probablemente esta falla). Los diagnósticos coexisten con eventos y pueden vincularse entre sí.

## Requirements

### CDG-001: Esquema de diagnósticos

**Priority**: MUST

La tabla `condition_diagnoses` DEBE almacenar: id (UUID PK), asset_id (TEXT NOT NULL), failure_mode_id (FK → condition_failure_mode_catalog), diagnosis_status (TEXT CHECK: candidate, field_trial, active, confirmed, rejected, superseded), confidence (NUMERIC 0-1), evidence_summary (JSONB), supporting_result_ids (UUID[]), contradictory_result_ids (UUID[]), source_window_ids (UUID[]), linked_event_id (UUID nullable FK → condition_events), linked_work_order_id (UUID nullable FK → work_orders), created_at (TIMESTAMPTZ DEFAULT NOW()), valid_until (TIMESTAMPTZ nullable).

#### Scenario: Diagnóstico candidate creado

- **GIVEN** matríz de evidencia evalúa a true para pump.cavitation con confidence=0.6
- **WHEN** se inserta diagnóstico con diagnosis_status=`candidate`
- **THEN** el diagnóstico queda pendiente de revisión; no genera WO

#### Scenario: Diagnóstico vinculado a evento existente

- **GIVEN** event_id=`abc-123` existe para asset_id=`BOMBA-02`
- **WHEN** se inserta diagnóstico con linked_event_id=`abc-123`
- **THEN** el evento y diagnóstico quedan vinculados; el evento NO cambia de estado

### CDG-002: Diagnóstico ≠ evento

**Priority**: MUST

`condition_diagnoses` DEBE ser tabla separada de `condition_events`. El motor de reglas diagnósticas (evaluation_type='diagnostic') DEBE insertar en condition_diagnoses, NO en condition_events.

#### Scenario: Regla diagnóstica crea diagnóstico, no evento

- **GIVEN** regla con evaluation_type=`diagnostic` evalúa a true
- **WHEN** se ejecuta la acción de la regla
- **THEN** se inserta en condition_diagnoses; condition_events no tiene nuevos registros

### CDG-003: Ciclo de vida del diagnóstico

**Priority**: MUST

diagnosis_status DEBE transicionar: candidate → field_trial → active → confirmed | rejected | superseded. Transiciones: candidate puede ir a field_trial o rejected; field_trial a active o rejected; active a confirmed, rejected o superseded.

#### Scenario: Diagnóstico promovido a field_trial

- **GIVEN** diagnóstico candidate con confidence ≥ 0.5
- **WHEN** supervisor revisa y autoriza prueba en campo
- **THEN** diagnosis_status cambia a field_trial

#### Scenario: Diagnóstico confirmado por cierre de OT

- **GIVEN** OT vinculada se completa con hallazgo = `confirmed`
- **WHEN** se procesa el feedback
- **THEN** diagnosis_status cambia a confirmed; valid_until se extiende

#### Scenario: Diagnóstico rechazado por evidencia contradictoria

- **GIVEN** confidence < 0.3 por contradictory evidence
- **WHEN** el motor de scoring actualiza
- **THEN** diagnosis_status cambia a rejected

#### Scenario: Diagnóstico superseded por modo más específico

- **GIVEN** diagnóstico active para pump.cavitation
- **WHEN** nueva evidencia apunta a impeller.damage como modo más específico
- **THEN** el diagnóstico original se marca superseded; el nuevo se crea como candidate

### CDG-004: RLS y permisos

**Priority**: MUST

RLS DEBE configurarse: SELECT para todos los usuarios autenticados; INSERT y UPDATE solo para roles PLANNER y ADMIN. Los diagnósticos son datos operativos no sensibles pero requieren control de escritura.

#### Scenario: Planner inserta diagnóstico

- **GIVEN** usuario con rol PLANNER
- **WHEN** inserta diagnóstico
- **THEN** inserción exitosa

#### Scenario: Técnico solo lectura

- **GIVEN** usuario con rol TECHNICIAN
- **WHEN** intenta INSERT o UPDATE en condition_diagnoses
- **THEN** operación denegada por RLS

### CDG-005: Evidencia soportante y contradictoria

**Priority**: MUST

supporting_result_ids DEBE contener UUIDs de condition_analysis_results que soportan el diagnóstico. contradictory_result_ids DEBE contener UUIDs de resultados que lo contradicen.

#### Scenario: Diagnóstico con evidencia soportante

- **GIVEN** resultado de trend_slope con analysis_result_id=`res-001` muestra degradación
- **WHEN** se crea diagnóstico con supporting_result_ids=`{res-001}`
- **THEN** el diagnóstico es trazable al análisis que lo soporta
