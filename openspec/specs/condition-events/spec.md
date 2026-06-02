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

### REQ-CEVT-003: Trigger event-to-WO
**Priority**: MUST
**Description**: `trg_condition_event_to_wo` (AFTER INSERT en condition_events) debe crear work_order cuando severity=`critical` y status=`open`, incluyendo condition_event_id FK en la orden.

#### Scenario: WO creada automáticamente por evento critical
- **WHEN**: Se inserta evento con severity=`critical`, status=`open`, asset_id=`BANDA-TR-01`
- **THEN**: Se crea work_order con condition_event_id FK, descripción con HI, dHI/dt y mensaje del evento

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
