# Spec: Eventos de Condición y Disparo a Órdenes de Trabajo

## Requirements

### REQ-CEVT-001: Registro de eventos de condición
**Priority**: MUST
**Description**: `condition_events` debe almacenar: asset_id, rule_id (FK a condition_rules), event_type, severity (info, warning, critical), hi_value, dhi_dt_value, message, status (open, linked_to_wo, closed, dismissed), created_at.

#### Scenario: Evento critical registrado por regla activa
- **WHEN**: Una regla con severity=`critical` y action=`create_wo` evalúa a true
- **THEN**: Se crea evento con severity=`critical`, status=`open`, message incluyendo feature_key, valor y umbral excedido

#### Scenario: Evento warning registrado (sin WO)
- **WHEN**: Una regla con severity=`warning` y action=`log_event` evalúa a true
- **THEN**: Se crea evento con severity=`warning`, status=`open`; NO se genera work_order

### REQ-CEVT-002: Atribución de fuentes del evento
**Priority**: MUST
**Description**: `condition_event_sources` debe vincular event_id con feature_value_id y/o analysis_result_id que dispararon el evento.

#### Scenario: Evento disparado por feature value único
- **WHEN**: Un evento se genera porque vibration.rms excedió zone_c_max
- **THEN**: condition_event_sources contiene registro con feature_value_id del valor que disparó

#### Scenario: Evento compuesto con múltiples fuentes
- **WHEN**: Evento disparado por regla compuesta (vibración + temperatura)
- **THEN**: condition_event_sources contiene 2 registros — feature_value_id de vibración y de temperatura

### CEVT-D4-001: Diagnóstico vinculable a evento
**Priority**: MUST
**Description**: La tabla `condition_events` DEBE agregar columnas: diagnosis_id (UUID nullable FK → condition_diagnoses), failure_mode_id (UUID nullable FK → condition_failure_mode_catalog). Múltiples eventos PUEDEN contribuir a un mismo diagnóstico. Evento y diagnóstico coexisten — el evento no cambia su semántica.

#### Scenario: Evento vinculado a diagnóstico post-creación
- **GIVEN** evento condition_event con severity=`warning` existe para asset_id=`BOMBA-01`
- **WHEN** se actualiza con diagnosis_id del diagnóstico de pump.cavitation
- **THEN** el evento queda vinculado al diagnóstico; el evento mantiene su status original

#### Scenario: Múltiples eventos vinculados a un diagnóstico
- **GIVEN** 3 eventos de vibración registrados en 48h
- **WHEN** los 3 se vinculan al mismo diagnosis_id
- **THEN** todos los eventos comparten diagnosis_id; supporting_result_ids del diagnóstico contiene los IDs de los 3 eventos

### REQ-CEVT-003: Trigger event-to-WO
**Priority**: MUST
**Description**: `trg_condition_event_to_wo` (AFTER INSERT en condition_events) debe crear work_order cuando severity=`critical` y status=`open` Y el evento NO está vinculado a un diagnóstico field_trial. Si el evento tiene diagnosis_id con diagnosis_status=`field_trial`, NO se genera WO aunque severity sea critical.

#### Scenario: WO creada automáticamente por evento critical
- **WHEN**: Se inserta evento con severity=`critical`, status=`open`, asset_id=`BANDA-TR-01`, sin diagnosis_id o con diagnosis_id no field_trial
- **THEN**: Se crea work_order con condition_event_id FK, descripción con HI, dHI/dt y mensaje del evento

#### Scenario: Evento critical con diagnosis field_trial no genera WO
- **GIVEN** evento severity=`critical` vinculado a diagnóstico field_trial
- **WHEN** se inserta el evento
- **THEN**: trigger NO crea work_order — el diagnóstico field_trial bloquea la WO automática

#### Scenario: Evento con severity=`info` no genera WO
- **WHEN**: Se inserta evento con severity=`info`
- **THEN**: No se ejecuta el trigger; no se crea work_order

### REQ-CEVT-004: Ciclo de vida del evento
**Priority**: MUST
**Description**: Los eventos transicionan: open → linked_to_wo → closed | dismissed.

#### Scenario: Evento vinculado a WO por operador
- **WHEN**: Un evento open es asociado manualmente a una work_order existente
- **THEN**: status cambia a linked_to_wo

#### Scenario: Evento descartado tras revisión
- **WHEN**: Un operador determina que el evento es falso positivo y lo descarta
- **THEN**: status cambia a dismissed

#### Scenario: Evento cerrado tras resolución
- **WHEN**: WO asociada se completa y el hallazgo se confirma
- **THEN**: status del evento cambia a closed
