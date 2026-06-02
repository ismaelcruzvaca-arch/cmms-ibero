# Delta Spec SDD 2 — Ingesta de Datos de Condición

## ADDED Requirements

### REQ-DING-008: Idempotency key en ingest-condition

**Priority**: MUST
**Description**: El endpoint `ingest-condition` DEBE aceptar `idempotency_key` como parámetro. Si el key ya fue procesado, retornar 409 sin duplicar datos. La clave varía por source_type: external_window_id (edge/api), source_id+asset_id+measured_at (manual/portable), batch_id+row_number (csv).

#### Scenario: Idempotency key duplicado → 409

- **WHEN**: POST con idempotency_key ya existente en condition_ingest_outbox o condition_windows
- **THEN**: Respuesta 409 `idempotency_key ya procesado`, sin inserts en BD

#### Scenario: Idempotency key nuevo → procesamiento normal

- **WHEN**: POST con idempotency_key no visto antes
- **THEN**: Procesamiento normal, idempotency_key registrado en outbox/windows

### REQ-DING-009: Batch window array en ingest-condition

**Priority**: MUST
**Description**: El endpoint DEBE aceptar array `windows[]` para procesar múltiples ventanas en una sola llamada (soporte CSV/import batch). Cada elemento del array se procesa atómicamente con su propio idempotency_key.

#### Scenario: Batch de 3 ventanas en una llamada

- **WHEN**: POST con `windows[]` conteniendo 3 ventanas con sus respectivos payloads FeatureSet v0.2
- **THEN**: Las 3 ventanas se procesan, cada una con validación independiente. Si una falla, las demás no se revierten (no transaccional cross-window).

#### Scenario: Batch vacío rechazado

- **WHEN**: POST con `windows[]` vacío
- **THEN**: Respuesta 400, sin procesamiento

### REQ-DING-010: Outbox write on DB failure

**Priority**: MUST
**Description**: Si el INSERT en condition_windows o condition_feature_values falla por error de BD, el sistema DEBE escribir el payload completo en `condition_ingest_outbox` para reintento posterior.

#### Scenario: Timeout de BD → payload a outbox

- **WHEN**: INSERT en condition_windows falla por timeout de conexión
- **THEN**: Payload se escribe en condition_ingest_outbox con status=`pending`, retry_count=0, error_code capturado

#### Scenario: Outbox insert también falla

- **WHEN**: Tanto el INSERT original como el write a outbox fallan
- **THEN**: Respuesta 500, error registrado en logs del edge function

### REQ-DING-011: Late-data gating en ingest-condition

**Priority**: MUST
**Description**: Antes de disparar reglas/eventos, el sistema DEBE evaluar `ingested_at − measured_at > late_event_cutoff_hours`. Si excede, persiste el dato pero saltea la evaluación de reglas y generación de OTs.

#### Scenario: Dato tardío — guardado sin trigger de reglas

- **WHEN**: POST con measured_at 48h atrás, cutoff configurado en 24h
- **THEN**: condition_windows y feature_values creados con late_data_flag=true. No se ejecutan reglas ni se crean OTs.

#### Scenario: Dato dentro del cutoff — trigger normal

- **WHEN**: POST con measured_at 2h atrás
- **THEN**: Procesamiento normal: reglas evaluadas, eventos/OTs generados si corresponde.

## MODIFIED Requirements

### REQ-DING-004: Edge Function ingest-condition (EXTENDIDA)

**Priority**: MUST
**Description**: El endpoint POST `ingest-condition` DEBE aceptar payload FeatureSet v0.2 con: idempotency_key (nuevo, opcional pero recomendado), batch windows[] (nuevo, para CSV), late-data evaluation (nuevo, gate antes de eventos). Validar 11 campos obligatorios (external_window_id, asset_id, source_id, window_start, window_end, feature_key, value, unit, quality_flag, method_key, method_version). Persistir en windows + feature_values con RLS. Si falla INSERT: escribir en outbox. Si es late data: persistir sin trigger de reglas.

(Previously: Endpoint solo procesaba payloads individuales sin idempotencia, batch, late-data gate ni outbox.)

#### Scenario: Payload completo con idempotency_key procesado

- **WHEN**: POST con todos los campos obligatorios, features array con metadatos completos e idempotency_key incluido
- **THEN**: Respuesta 200, ventana y feature values persistidos, idempotency_key registrado para futuras validaciones

#### Scenario: Payload sin method_key rechazado (sin cambios)

- **WHEN**: POST con feature sin method_key o method_version
- **THEN**: Respuesta 400 con mensaje indicando campos faltantes

#### Scenario: Batch de ventanas procesado

- **WHEN**: POST con `windows[]` conteniendo múltiples ventanas con features
- **THEN**: Cada ventana se procesa y persiste individualmente con su idempotency_key

#### Scenario: Late data — persistido sin eventos

- **WHEN**: POST con measured_at que excede late_event_cutoff_hours
- **THEN**: Dato persistido con late_data_flag=true, sin ejecución de reglas ni OTs

#### Scenario: DB failure → outbox fallback

- **WHEN**: INSERT en condition_windows falla por error de BD
- **THEN**: Payload completo se escribe en condition_ingest_outbox, respuesta 202 `accepted for retry`

### REQ-DING-007: Validación contra source capabilities (REFORZADA)

**Priority**: MUST
**Description**: La ingesta DEBE verificar que el source_id del payload tenga una capability registrada en `condition_source_capabilities` para el feature_key+method_key recibido. Sin capability → rechazo 400 (endurecido respecto a SDD 1 donde solo degradaba). Capability con validation_status `draft`/`rejected` → acepta con quality_flag=G2. La verificación usa `is_source_capable(source_id, feature_key, method_key)` que retorna BOOLEAN.

(Previously: La validación permitía aceptar datos con advertencia cuando el método no era esperado. Ahora sin capability el rechazo es 400.)

#### Scenario: Fuente con capability activa — ingesta aceptada (sin cambios)

- **WHEN**: Llega payload con source_id=`edge_001`, feature_key=`vibration.rms`, method_key=`rms_velocity_window` y existe capability con validation_status=`active`
- **THEN**: La ingesta procede normalmente

#### Scenario: Fuente sin capability registrada — RECHAZO 400 (endurecido)

- **WHEN**: Llega payload con source_id que no tiene capability para feature_key+method_key
- **THEN**: Respuesta 400. **Ya no se acepta con advertencia.** Mensaje: `feature_key X no está en las capacidades de source_id Y`

#### Scenario: Capability existe pero validation_status no es active/field_trial (sin cambios)

- **WHEN**: Llega payload con capability validation_status=`draft` o `rejected`
- **THEN**: El sistema acepta el dato pero fuerza quality_flag=`G2` y registra advertencia
