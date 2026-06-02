# Delta for condition-events (SDD 4)

## ADDED Requirements

### CEVT-D4-001: Diagnóstico vinculable a evento

**Priority**: MUST

La tabla `condition_events` DEBE agregar columnas: diagnosis_id (UUID nullable FK → condition_diagnoses), failure_mode_id (UUID nullable FK → condition_failure_mode_catalog). Múltiples eventos PUEDEN contribuir a un mismo diagnóstico. Evento y diagnóstico coexisten — el evento no cambia su semántica.

#### Scenario: Evento vinculado a diagnóstico post-creación

- **GIVEN** evento condition_event con severity=`warning` existe para asset_id=`BOMBA-01`
- **WHEN** se actualiza con diagnosis_id del diagnóstico de pump.cavitation
- **THEN** el evento queda vinculado al diagnóstico; el evento mantiene su status original

#### Scenario: Múltiples eventos vinculados a un diagnóstico

- **GIVEN** 3 eventos de vibración registrados en 48h
- **WHEN** los 3 se vinculan al mismo diagnosis_id
- **THEN** todos los eventos comparten diagnosis_id; supporting_result_ids del diagnóstico contiene los IDs de los 3 eventos

## MODIFIED Requirements

### REQ-CEVT-003: Trigger event-to-WO (Modified)

**Priority**: MUST

`trg_condition_event_to_wo` DEBE crear work_order cuando severity=`critical` y status=`open` Y el evento NO está vinculado a un diagnóstico field_trial. Si el evento tiene diagnosis_id con diagnosis_status=`field_trial`, NO se genera WO aunque severity sea critical.
(Previously: trigger creaba WO siempre para severity=critical sin considerar diagnosis field_trial)

#### Scenario: Evento critical con diagnosis field_trial no genera WO

- **GIVEN** evento severity=`critical` vinculado a diagnóstico field_trial
- **WHEN** se inserta el evento
- **THEN** trigger NO crea work_order — el diagnóstico field_trial bloquea la WO automática
