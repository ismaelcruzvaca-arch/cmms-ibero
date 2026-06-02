# Spec: Catálogo de Umbrales de Condición

## Requirements

### REQ-CTHR-001: Esquema de catálogo de umbrales
**Priority**: MUST
**Description**: La tabla `condition_threshold_catalog` debe almacenar umbrales contextualizados: feature_definition_id FK, method_key (obligatorio, FK a condition_analysis_methods), asset_class, power_range_min/max, mounting_type, regime, measurement_location, zone_a_max, zone_b_max, zone_c_max, zone_d_max, unit, severity, iso_standard, standard_reference, validity_notes, validation_status.

#### Scenario: Umbral registrado con contexto completo
- **WHEN**: Se inserta umbral con asset_class=`centrifugal_pump`, feature asociado a `vibration.rms`, method_key=`rms_velocity_window`, zone_a_max=2.3, zone_b_max=4.5, zone_c_max=7.1, unit=`mm/s`, iso_standard=`ISO 10816-7`, regime=`FULL_LOAD`
- **THEN**: El umbral queda disponible para evaluación de reglas con filtro multi-criterio incluyendo method_key

#### Scenario: Método distinto — umbral distinto para mismo feature
- **WHEN**: Se consultan umbrales para feature_key=`vibration.rms`, method_key=`rms_velocity_window` vs method_key=`rms_acceleration_window`
- **THEN**: Retornan umbrales diferentes porque el método de cálculo afecta los valores esperados

### REQ-CTHR-002: Semilla ISO 10816/20816 para ≥4 clases de activo
**Priority**: MUST
**Description**: La migración debe incluir datos semilla de umbrales ISO 10816/20816 para al menos 4 asset_class: pumps (centrifugal_pump), motors (electric_motor), fans (centrifugal_fan), compressors (centrifugal_compressor).

#### Scenario: Datos semilla cargados post-migración
- **WHEN**: Se ejecuta la migración de threshold_catalog
- **THEN**: Existen umbrales con zonas A/B/C/D pobladas según ISO 10816 (partes 1, 3, 7) y 20816 para las 4 clases, con validation_status=`bench_validated`

#### Scenario: Umbrales heredados para clase sin datos específicos
- **WHEN**: Se consultan umbrales para asset_class sin registro específico (ej. turbine)
- **THEN**: El sistema retorna umbrales genéricos ISO 10816-1 como fallback conservador

### REQ-CTHR-003: Umbrales conscientes de régimen operativo
**Priority**: MUST
**Description**: Los umbrales deben filtrarse por regime con valores: STOPPED, STARTUP, IDLE, PARTIAL_LOAD, FULL_LOAD, OVERLOAD.

#### Scenario: Umbral distinto por régimen
- **WHEN**: Se consultan umbrales para `centrifugal_pump` con regime=`FULL_LOAD` vs regime=`STARTUP`
- **THEN**: Los umbrales retornados difieren — STARTUP tiene zonas más permisivas

#### Scenario: Régimen sin umbral específico usa FULL_LOAD como default
- **WHEN**: Se consulta regime=`PARTIAL_LOAD` sin umbrales específicos registrados
- **THEN**: El sistema aplica los umbrales de FULL_LOAD como referencia conservadora

### REQ-CTHR-004: Consulta contextualizada multi-criterio
**Priority**: MUST
**Description**: Las queries de umbrales deben combinar feature_key + method_key + asset_class + regime + measurement_location para retornar las zonas aplicables.

#### Scenario: Query retorna zonas para combinación exacta
- **WHEN**: Consulta con feature_key=`vibration.rms`, method_key=`rms_velocity_window`, asset_class=`electric_motor`, regime=`FULL_LOAD`, measurement_location=`motor_de`
- **THEN**: Retorna zone_a_max, zone_b_max, zone_c_max, zone_d_max específicos para esa combinación
