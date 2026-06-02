# Spec: Catálogo de Métodos de Análisis de Condición

## Requirements

### REQ-MCAT-001: Registro de métodos científicos
**Priority**: MUST
**Description**: El sistema debe mantener un catálogo de métodos científicos de análisis de condición (`condition_analysis_methods`) con clave única `method_key`, categoría, requisitos de entrada, features de salida, parámetros por defecto, estado de validación y descripción.

#### Scenario: Registro de método RMS
- **WHEN**: Se inserta un método con method_key=`rms_velocity_window`, category=`time_domain`, default_parameters=`{"window_s": 1.0, "filter": "10-1000Hz"}`
- **THEN**: El método queda registrado con validation_status=`draft` y puede ser referenciado por features entrantes

#### Scenario: Método duplicado rechazado
- **WHEN**: Se intenta insertar un método con method_key ya existente
- **THEN**: El sistema rechaza la inserción con error de unicidad (UNIQUE constraint)

### REQ-MCAT-002: Semilla inicial de ≥11 métodos
**Priority**: MUST
**Description**: La migración debe incluir datos semilla para al menos 11 métodos: rms_velocity_window, fft_band_energy, hilbert_envelope, linear_regression, kalman_filter, model_residual, window_average, peak, crest_factor, manual_observation, weighted_health_index.

#### Scenario: Catálogo poblado post-migración
- **WHEN**: Se ejecuta la migración method_catalog_schema
- **THEN**: La tabla contiene ≥11 registros con categorías time_domain, frequency_domain, statistical, model_based, hybrid

### REQ-MCAT-003: Ciclo de vida de validación por método
**Priority**: MUST
**Description**: Cada método debe tener campo `validation_status` con estados draft, candidate, bench_validated, field_trial, active, deprecated, rejected y transiciones válidas forzadas.

#### Scenario: Promoción de método a activo
- **WHEN**: Un método completa validación en banco y campo (bench_validated → field_trial → active)
- **THEN**: Su validation_status refleja la progresión completa

#### Scenario: Transición inválida bloqueada
- **WHEN**: Se intenta cambiar un método de draft directamente a active
- **THEN**: El sistema rechaza la transición (CHECK constraint o trigger)

### REQ-MCAT-004: Extensibilidad sin cambio de schema
**Priority**: SHOULD
**Description**: Agregar un nuevo método de análisis no debe requerir modificar el schema de base de datos.

#### Scenario: Nuevo método insertado en runtime
- **WHEN**: Se ejecuta INSERT en condition_analysis_methods con nuevo method_key
- **THEN**: El método queda disponible inmediatamente sin migración adicional
