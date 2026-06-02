# Spec: Ingesta de Datos de Condición (FeatureSet v0.2)

## Requirements

### REQ-DING-001: Catálogo de definiciones de features
**Priority**: MUST
**Description**: La tabla `condition_feature_definitions` debe almacenar feature_key (único), unit, category, description y default_weight para cada feature medible.

#### Scenario: Feature de vibración definido
- **WHEN**: Se inserta feature_key=`vibration.rms`, unit=`mm/s`, category=`vibration`, default_weight=1.0
- **THEN**: El catálogo queda disponible para validación de ingesta y cálculo de Health Index

### REQ-DING-002: Ventanas de tiempo para ingesta batch
**Priority**: MUST
**Description**: `condition_windows` debe segmentar la ingesta con external_window_id único, asset_id, source_id, source_type, window_start, window_end, pipeline_version, config_version, operational_context (JSONB) y status.

#### Scenario: Ventana creada desde payload FeatureSet
- **WHEN**: Llega payload con external_window_id=`edge_001:BANDA-TR-01:2026-06-01T10:00:00Z:v2`
- **THEN**: Se crea ventana con status=`received` y operational_context poblado desde el payload

#### Scenario: Ventana duplicada rechazada
- **WHEN**: Se intenta crear ventana con external_window_id ya existente
- **THEN**: El sistema rechaza con error de unicidad

### REQ-DING-003: Feature values con trazabilidad completa
**Priority**: MUST
**Description**: `condition_feature_values` debe almacenar: window_id FK, feature_definition_id FK, value, unit, quality_flag, method_key, method_version, parameters (JSONB), uncertainty, confidence, measurement_point_id, sample_count.

#### Scenario: Feature value persistido con metadatos
- **WHEN**: Se ingiere feature con method_key=`rms_velocity_window`, method_version=`0.1.0`, quality_flag=`G0`, uncertainty=0.25, parameters=`{"window_s": 1.0}`
- **THEN**: El registro incluye todos los metadatos para auditoría y pasa validación FK contra feature_definitions

#### Scenario: FK violation en feature_definition_id
- **WHEN**: Se ingiere feature_key no registrado en condition_feature_definitions
- **THEN**: La inserción es rechazada por restricción FK

### REQ-DING-004: Edge Function ingest-condition
**Priority**: MUST
**Description**: El endpoint POST `ingest-condition` debe aceptar payload FeatureSet v0.2, validar 11 campos obligatorios (external_window_id, asset_id, source_id, window_start, window_end, feature_key, value, unit, quality_flag, method_key, method_version), y persistir en windows + feature_values con RLS.

#### Scenario: Payload completo procesado con éxito
- **WHEN**: POST con todos los campos obligatorios y features array con metadatos completos
- **THEN**: Respuesta 200, ventana y feature values persistidos, retorna window_id

#### Scenario: Payload sin method_key rechazado
- **WHEN**: POST con feature sin method_key o method_version
- **THEN**: Respuesta 400 con mensaje indicando campos faltantes

### REQ-DING-005: Validación de method_key contra catálogo
**Priority**: MUST
**Description**: La ingesta debe verificar que cada method_key existe en condition_analysis_methods.

#### Scenario: Método no registrado — aceptado con advertencia
- **WHEN**: Llega feature con method_key no encontrado en el catálogo
- **THEN**: El sistema acepta el dato pero fuerza quality_flag=`G2` y registra advertencia en logs

#### Scenario: Método registrado — sin degradación
- **WHEN**: Llega feature con method_key existente en el catálogo
- **THEN**: quality_flag se respeta según lo declarado por la fuente

### REQ-DING-007: Validación contra source capabilities
**Priority**: MUST
**Description**: La ingesta debe verificar que el source_id del payload tenga una capability registrada en `condition_source_capabilities` para el feature_key+method_key recibido y que su validation_status sea `active` o `field_trial`. Sin esta validación, `condition_source_capabilities` es un catálogo decorativo sin poder de gobierno.

#### Scenario: Fuente con capability activa — ingesta aceptada
- **WHEN**: Llega payload con source_id=`edge_001`, feature_key=`vibration.rms`, method_key=`rms_velocity_window` y existe capability con validation_status=`active`
- **THEN**: La ingesta procede normalmente, quality_flag se respeta según lo declarado por la fuente

#### Scenario: Fuente sin capability registrada — rechazo
- **WHEN**: Llega payload con source_id que no tiene ninguna capability en condition_source_capabilities
- **THEN**: Respuesta 400 con mensaje `source_id no tiene capacidades registradas`

#### Scenario: Capability existe pero validation_status no es active/field_trial
- **WHEN**: Llega payload con source_id+feature_key+method_key que tiene capability pero validation_status=`draft` o `rejected`
- **THEN**: El sistema acepta el dato pero fuerza quality_flag=`G2` y registra advertencia

### REQ-DING-006: Row-Level Security en ingesta
**Priority**: MUST
**Description**: RLS debe permitir INSERT a roles con scope de ingesta y restringir SELECT según visibilidad por asset.

#### Scenario: Usuario sin permisos de ingesta bloqueado
- **WHEN**: Rol sin permiso INSERT intenta ingerir datos
- **THEN**: La política RLS bloquea la operación con error 403

#### Scenario: Usuario con permisos limitados por asset
- **WHEN**: Rol con visibilidad solo a assets tipo `motor` consulta feature_values
- **THEN**: Solo ve registros de assets autorizados
