# Spec: Enforcement de Capacidades de Fuente

## Purpose

Validación obligatoria de capabilities en cada ingesta: sin capability registrada → rechazo; capability no validada → calidad degradada.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CSCE-001 | MUST | Validar feature_key + method_key contra `condition_source_capabilities` en cada ingesta |
| REQ-CSCE-002 | MUST | Sin capability → rechazo 400 con mensaje descriptivo |
| REQ-CSCE-003 | MUST | Capability con status `draft` o `rejected` → acepta con quality_flag=G2 forzado |
| REQ-CSCE-004 | MUST | Fuentes sin validation_status `active`/`field_trial` no disparan OTs automáticas |

### REQ-CSCE-001: Validación obligatoria contra capabilities

El sistema DEBE verificar que existe un registro en `condition_source_capabilities` para source_id + feature_key + method_key en cada ingesta.

#### Scenario: Capability registrada y activa — ingesta OK

- **WHEN**: Ingesta con source_id=`edge_001`, feature_key=`vibration.rms`, method_key=`rms_velocity_window`, capability validation_status=`active`
- **THEN**: La validación pasa, ingesta procede con quality_flag original

#### Scenario: Capability no registrada para ese method_key

- **WHEN**: Ingesta con source_id=`edge_001`, feature_key=`vibration.rms`, method_key=`peak_detection` (no registrado para edge_001)
- **THEN**: Ver REQ-CSCE-002 o REQ-CSCE-003 según corresponda

### REQ-CSCE-002: Rechazo sin capability

El sistema DEBE rechazar con 400 toda ingesta donde source_id no tenga NINGUNA capability registrada en `condition_source_capabilities`.

#### Scenario: Fuente sin capabilities — rechazo

- **WHEN**: Llega payload con source_id=sin registrar
- **THEN**: Respuesta 400: `source_id no tiene capacidades registradas. Registre capabilities antes de ingerir.`

#### Scenario: Fuente con capabilities pero feature_key distinto

- **WHEN**: source_id=`edge_001` tiene capability para `vibration.rms` pero el payload trae `temperature.bearing`
- **THEN**: Respuesta 400: `feature_key temperature.bearing no está en las capacidades de edge_001`

### REQ-CSCE-003: Degradación por capability no validada

El sistema DEBE aceptar el dato pero forzar quality_flag=G2 cuando la capability tiene validation_status `draft` o `rejected`.

#### Scenario: Capability en draft — dato con G2

- **WHEN**: Ingesta con capability validation_status=`draft`, payload declara quality_flag=`G0`
- **THEN**: El sistema acepta el dato pero lo persiste con quality_flag=`G2` y registra advertencia

#### Scenario: Capability rechazada — dato con G2

- **WHEN**: Ingesta con capability validation_status=`rejected`
- **THEN**: Similar a draft: dato aceptado con G2 forzado

### REQ-CSCE-004: Restricción de eventos por estado de fuente

El sistema DEBE impedir generación de OTs automáticas cuando la fuente no tiene validation_status `active`.

#### Scenario: Fuente en field_trial — sin OT

- **WHEN**: Ingesta desde fuente con validation_status=`field_trial` supera umbral de evento
- **THEN**: Se genera evento tipo `info` pero NO se crea orden de trabajo automática

#### Scenario: Fuente candidate — sin eventos

- **WHEN**: Ingesta desde fuente `candidate`
- **THEN**: El dato se guarda con G2 pero no dispara eventos ni recalcula Health Index
