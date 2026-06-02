# Spec: Captura Manual de Condición

## Purpose

Interfaz para captura manual de datos de condición con trazabilidad completa, construcción client-side de FeatureSet v0.2 y soporte offline-first.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CMC-001 | MUST | Formulario con asset selector, feature selector, value, quality_flag, operational_context, notes, instrument_ref |
| REQ-CMC-002 | MUST | Trazabilidad: measured_by_user_id, entered_by_user_id, measured_at, entered_at (todos poblados) |
| REQ-CMC-003 | MUST | Construcción client-side de FeatureSet v0.2 antes del POST |
| REQ-CMC-004 | MUST | Offline-first: cola RxDB local → sync con measured_at preservado |
| REQ-CMC-005 | MUST | Validación client-side de campos obligatorios |

### REQ-CMC-001: Formulario de captura manual

El sistema DEBE proveer UI con: selector de asset (autocomplete desde catálogo), selector de feature (cascada method_key automático), valor numérico, quality_flag, operational_context (JSONB), notas libres, instrument_ref.

#### Scenario: Técnico completa captura con todos los campos

- **WHEN**: Técnico selecciona asset=`BANDA-TR-01`, feature=`vibration.rms`, value=4.2, quality_flag=`G0`, instrument_ref=`vib-01`, notas=`Medición semanal`
- **THEN**: El formulario valida todos los campos y construye payload FeatureSet v0.2 completo

#### Scenario: Campos obligatorios faltantes

- **WHEN**: Técnico omite feature o value
- **THEN**: El sistema muestra error de validación y no permite envío

### REQ-CMC-002: Trazabilidad completa

El sistema DEBE registrar measured_by_user_id y entered_by_user_id independientemente, measured_at y entered_at con timestamps separados.

#### Scenario: Operador mide y otro técnico ingresa

- **WHEN**: measured_by_user_id=`oper-05` (midió en campo), entered_by_user_id=`tech-02` (ingresó en sistema), measured_at=`2026-06-02T08:00Z`
- **THEN**: Ambos IDs y timestamps persisten en el registro, trazables en auditoría

#### Scenario: Mismo usuario mide e ingresa

- **WHEN**: measured_by_user_id y entered_by_user_id son iguales
- **THEN**: El sistema acepta la captura sin advertencia

### REQ-CMC-003: Construcción FeatureSet v0.2 client-side

El sistema DEBE construir el payload FeatureSet v0.2 completo en el cliente, incluyendo external_window_id generado, window_start/window_end, y metadatos de método.

#### Scenario: FeatureSet construido correctamente

- **WHEN**: Formulario validado y enviado
- **THEN**: El payload incluye source_id, asset_id, window_start=measured_at, feature_key, value, unit, quality_flag, method_key, method_version, y operational_context

### REQ-CMC-004: Offline-first con RxDB

El sistema DEBE encolar capturas en RxDB local cuando no hay conectividad y sincronizar al recuperar red.

#### Scenario: Captura sin conexión

- **WHEN**: Técnico captura dato sin red, measured_at=`2026-06-02T09:00Z`
- **THEN**: El dato se guarda en cola RxDB local con measured_at preservado, y se sincroniza al reconectar

#### Scenario: Sincronización al reconectar

- **WHEN**: Red se restaura con 3 capturas pendientes en cola
- **THEN**: Las 3 se envían secuencialmente a ingest-condition, measured_at original se mantiene en cada una

### REQ-CMC-005: Validación client-side

El sistema DEBE validar en cliente: feature_key existe en catálogo, value es numérico positivo, quality_flag dentro de {G0, G1, G2}, instrument_ref no vacío si quality_flag=G0.

#### Scenario: Datos inválidos rechazados en frontend

- **WHEN**: Técnico ingresa value=`-5` o quality_flag=`X3`
- **THEN**: El formulario muestra error de validación antes de construir el FeatureSet
