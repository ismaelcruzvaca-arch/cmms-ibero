# Delta Spec SDD 2 — Capacidades de Fuente de Condición

## ADDED Requirements

### REQ-SCAP-005: Seeds multi-feature para fuentes edge

**Priority**: MUST
**Description**: El seed de `condition_source_capabilities` DEBE incluir ≥2 features por fuente edge. edge_001 DEBE tener capabilities para `vibration.rms` + `vibration.peak` + `temperature.bearing`. Fuentes csv_import y manual_route_001 DEBEN tener capabilities flexibles (feature_key=ANY con method_key=ANY).

#### Scenario: edge_001 con 3 features

- **WHEN**: Se ejecuta migración de capabilities
- **THEN**: edge_001 tiene registros para vibration.rms (rms_velocity_window), vibration.peak (peak_detection), temperature.bearing (thermocouple_contact)

#### Scenario: csv_import con capability ANY

- **WHEN**: Se consulta capabilities de csv_import
- **THEN**: feature_key=`ANY`, method_key=`ANY` — permite cualquier feature/método validado manualmente

#### Scenario: manual_route_001 con capability ANY

- **WHEN**: Se consulta capabilities de manual_route_001
- **THEN**: feature_key=`ANY`, method_key=`ANY`, pero quality_expected=`G1`

### REQ-SCAP-006: Policy table para fuentes no validadas

**Priority**: MUST
**Description**: El sistema DEBE aplicar la policy table que define qué puede hacer cada fuente según su validation_status. La tabla condiciona: guardar dato, afectar Health Index, generar eventos, crear OTs, reprocesar dead-letter.

Las reglas DEBEN ser:

| Estado | Guardar dato | Afectar HI | Generar evento | Crear OT | Reprocess dead-letter |
|--------|-------------|------------|----------------|----------|----------------------|
| draft | ❌ | ❌ | ❌ | ❌ | ❌ |
| candidate | ✅ (G2) | ❌ | ❌ | ❌ | ✅ (G2) |
| field_trial | ✅ | ✅ (marcado) | info | ❌ | ✅ |
| active | ✅ | ✅ | ✅ | ✅ | ✅ |
| disabled | ❌ | ❌ | ❌ | ❌ | ❌ |
| deprecated | ❌ | ❌ | ❌ | ❌ | ❌ |

#### Scenario: Fuente candidate — G2 forzado, sin HI

- **WHEN**: Ingesta desde fuente con validation_status=`candidate`
- **THEN**: Dato guardado con quality_flag=G2 forzado. Health Index no se recalcula. No se generan eventos.

#### Scenario: Fuente field_trial — evento info solamente

- **WHEN**: Ingesta desde fuente `field_trial` supera umbral de alarma
- **THEN**: Se genera evento tipo `info`. NO se crea OT automática. HI se recalcula pero marcado como `trial_based`.

#### Scenario: Fuente disabled — rechazo total

- **WHEN**: Ingesta desde fuente con validation_status=`disabled`
- **THEN**: Respuesta 400. No se guarda dato ni se encola.

### REQ-SCAP-007: Integración con source registry y enforcement

**Priority**: MUST
**Description**: `condition_source_capabilities` DEBE hacer FK a `condition_sources.source_id`. La función `is_source_capable(source_id, feature_key, method_key)` DEBE validar capabilities y retornar BOOLEAN. La EF `ingest-condition` DEBE llamar esta función en cada ingesta.

#### Scenario: is_source_capable retorna TRUE para capability activa

- **WHEN**: `is_source_capable('edge_001', 'vibration.rms', 'rms_velocity_window')`
- **THEN**: Retorna `true` porque la capability existe con validation_status=`active`

#### Scenario: is_source_capable retorna FALSE sin capability

- **WHEN**: `is_source_capable('edge_001', 'temperature.exhaust', 'thermocouple_contact')`
- **THEN**: Retorna `false` porque edge_001 no tiene capability para ese feature_key

#### Scenario: FK integrity — fuente eliminada

- **WHEN**: Se intenta eliminar source_id referenciado en condition_source_capabilities
- **THEN**: FK impide el DELETE, cascada o RESTRICT según diseño

## MODIFIED Requirements

### REQ-SCAP-001: Registro de capacidades por fuente (EXTENDIDO)

**Priority**: MUST
**Description**: La tabla `condition_source_capabilities` DEBE registrar qué features puede producir cada fuente, con qué método, frecuencia de muestreo, calidad esperada, incertidumbre disponible y estado de validación. AHORA TAMBIÉN: FK a `condition_sources.source_id`, soporte para feature_key=`ANY` (fuentes flexibles como manual/CSV), y ≥2 features por fuente edge en seeds.

(Previously: Registro simple sin FK a source registry, sin soporte ANY, seeds single-feature.)

#### Scenario: Registro de capacidad con FK a source registry

- **WHEN**: Se inserta capacidad con source_id=`edge_001`, feature_key=`vibration.rms`, method_key=`rms_velocity_window`
- **THEN**: FK valida que source_id existe en condition_sources. El sistema relaciona fuente con feature y método.

#### Scenario: Fuente con capability ANY para captura manual

- **WHEN**: Se inserta capability con source_id=`manual_route_001`, feature_key=`ANY`, method_key=`ANY`
- **THEN**: La fuente puede ingerir cualquier feature_key registrado en condition_feature_definitions con cualquier method_key del catálogo

#### Scenario: Fuente sin sample_rate (manual) — sin cambios

- **WHEN**: Se registra fuente con source_type=`manual`
- **THEN**: El sistema acepta el registro con sample_rate_hz=NULL y uncertainty_available=false

### REQ-SCAP-004: Ciclo de vida de validación (EXTENDIDO)

**Priority**: MUST
**Description**: Cada registro de capability DEBE tener validation_status con el ciclo estándar (draft → candidate → field_trial → active → deprecated). AHORA TAMBIÉN: el validation_status DEBE sincronizarse con `condition_sources.status`, y determinar el comportamiento de ingesta según la policy table (REQ-SCAP-006).

(Previously: Lifecycle independiente sin integración con source registry ni policy table.)

#### Scenario: Capacidad en field_trial restringe decisiones (sin cambios)

- **WHEN**: Una fuente tiene validation_status=`field_trial`
- **THEN**: Sus datos pueden ingerirse pero solo generan eventos `info`, sin OTs automáticas

#### Scenario: Sincronización source.status con capability validation_status

- **WHEN**: source.status cambia de `field_trial` a `active`
- **THEN**: Las capabilities asociadas deben reflejar el cambio o al menos la ingesta respeta la policy del nuevo estado
