# Spec: Capacidades de Fuente de Condición

## Requirements

### REQ-SCAP-001: Registro de capacidades por fuente
**Priority**: MUST
**Description**: La tabla `condition_source_capabilities` debe registrar qué features puede producir cada fuente, con qué método, frecuencia de muestreo, calidad esperada, incertidumbre disponible y estado de validación.

#### Scenario: Registro de capacidad para sensor edge
- **WHEN**: Se inserta capacidad con source_id=`edge_001`, source_type=`edge`, can_produce=`vibration.rms`, method_key=`rms_velocity_window`, sample_rate_hz=25600, quality_expected=`G0`
- **THEN**: El sistema relaciona fuente con feature y método, trazable en consultas de validación cruzada

#### Scenario: Fuente sin sample_rate (manual)
- **WHEN**: Se registra fuente con source_type=`manual`
- **THEN**: El sistema acepta el registro con sample_rate_hz=NULL y uncertainty_available=false

### REQ-SCAP-002: Tipos de fuente soportados
**Priority**: MUST
**Description**: El sistema debe soportar source_type: edge, manual, portable, csv, modbus, mqtt, api, scada.

#### Scenario: Tipo de fuente inválido rechazado
- **WHEN**: Se intenta registrar fuente con source_type no listado
- **THEN**: El sistema rechaza con error de restricción CHECK

#### Scenario: Fuente scada registrada
- **WHEN**: Se registra source_type=`scada` con sample_rate_hz=1
- **THEN**: El registro es aceptado y usable en ingesta

### REQ-SCAP-003: Puente feature-método-fuente
**Priority**: MUST
**Description**: La tabla vincula source_id → can_produce (feature_key) → method_key, permitiendo validar en ingesta que un feature entrante coincide con las capacidades declaradas.

#### Scenario: Validación cruzada — método no esperado
- **WHEN**: Llega feature con source_id y method_key no declarado en condition_source_capabilities
- **THEN**: El sistema acepta el dato pero asigna quality_flag=`G2` (método no esperado para esa fuente)

#### Scenario: Validación cruzada — método esperado
- **WHEN**: Llega feature con source_id y method_key coincidente con capacidades declaradas
- **THEN**: quality_flag se mantiene según lo declarado por el edge (sin degradación)

### REQ-SCAP-004: Ciclo de vida de validación por fuente
**Priority**: MUST
**Description**: Cada registro de capacidad debe tener validation_status con el ciclo de vida estándar (draft → candidate → bench_validated → field_trial → active → deprecated).

#### Scenario: Capacidad en field_trial restringe decisiones
- **WHEN**: Una fuente tiene validation_status=`field_trial`
- **THEN**: Sus datos pueden ingerirse pero las reglas asociadas no deben generar eventos críticos automáticos
