# Spec: Importación CSV de Condición

## Purpose

Pipeline de importación masiva de datos de condición vía CSV con staging, validación, preview de errores e ingesta transaccional sin contaminar la BD productiva.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CCI-001 | MUST | Tablas `condition_import_batches` + `condition_import_rows` con batch_id PK, FK a batch, raw_data JSONB, validation_errors, status |
| REQ-CCI-002 | MUST | Estados: uploaded → validated → ready_to_import → imported → failed → cancelled |
| REQ-CCI-003 | MUST | Papa Parse client-side con column mapping auto-detectado |
| REQ-CCI-004 | MUST | Preview tabla con errores resaltados, sin submit hasta validación OK |
| REQ-CCI-005 | MUST | Filas inválidas aisladas en staging, no afectan condition_windows |

### REQ-CCI-001: Tablas de staging

El sistema DEBE mantener `condition_import_batches` (batch_id, file_name, file_hash, status, row_count, valid_rows, invalid_rows, source_id FK) y `condition_import_rows` (batch_id FK, row_number, raw_data JSONB, validation_errors JSONB, status).

#### Scenario: Batch creado desde archivo CSV

- **WHEN**: Usuario sube `vibraciones_junio.csv` con 50 filas
- **THEN**: Se crea batch con file_hash SHA-256, status=`uploaded`, row_count=50

#### Scenario: Raw data persiste como JSONB

- **WHEN**: Fila 3 del CSV contiene `asset=BANDA-TR-01,feature=vibration.rms,value=4.2`
- **THEN**: condition_import_rows almacena raw_data=`{"asset":"BANDA-TR-01","feature":"vibration.rms","value":"4.2"}` en JSONB

### REQ-CCI-002: Pipeline de estados

El sistema DEBE seguir la transición: uploaded → validated → ready_to_import → imported | failed | cancelled.

#### Scenario: Batch completa validación sin errores

- **WHEN**: Las 50 filas pasan validación de columnas, features y assets
- **THEN**: batch.status=`ready_to_import`, valid_rows=50, invalid_rows=0

#### Scenario: Batch con errores parciales

- **WHEN**: 3 de 50 filas tienen feature_key desconocido
- **THEN**: batch.status=`validated`, valid_rows=47, invalid_rows=3, las filas erróneas tienen validation_errors poblado

#### Scenario: Usuario cancela batch pendiente

- **WHEN**: Batch en `uploaded` o `validated` es cancelado
- **THEN**: batch.status=`cancelled`, filas no pasan a ingesta

### REQ-CCI-003: Papa Parse client-side

El sistema DEBE usar Papa Parse para parsing client-side con auto-detección de columnas (feature_key, value, timestamp, unit, asset_id).

#### Scenario: Auto-detección de columnas

- **WHEN**: CSV tiene encabezados `Equipo,Feature,Valor,Fecha`
- **THEN**: Papa Parse sugiere mapping: Equipo→asset_id, Feature→feature_key, Valor→value, Fecha→measured_at

#### Scenario: Archivo vacío rechazado

- **WHEN**: CSV tiene 0 filas de datos
- **THEN**: El sistema muestra error y no crea batch

### REQ-CCI-004: Preview con errores

El sistema DEBE mostrar tabla preview con filas válidas en verde y erróneas en rojo con mensaje de error.

#### Scenario: Preview con errores resaltados

- **WHEN**: CSV tiene 47 filas OK y 3 con errores de feature_key
- **THEN**: Tabla muestra filas erróneas en rojo con tooltip del error, usuario puede corregir mapping antes de confirmar

### REQ-CCI-005: Aislamiento de errores

El sistema DEBE aislar filas inválidas en staging sin insertar en condition_windows ni condition_feature_values.

#### Scenario: Confirmación ingresa solo filas válidas

- **WHEN**: Usuario confirma batch con 47 filas válidas y 3 inválidas
- **THEN**: Solo 47 registros pasan a condition_windows/feature_values, las 3 inválidas quedan en staging con status=`error`
