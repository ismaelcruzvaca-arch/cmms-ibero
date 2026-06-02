# Spec: Registro y Gobierno de Fuentes de Condición

## Purpose

Gobierno centralizado de fuentes de datos de condición con lifecycle tracking, metadata operativa y RLS.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CSR-001 | MUST | Tabla `condition_sources` con source_id (PK), source_type, name, status, asset_id, owner, last_seen_at, validation_status, created_by |
| REQ-CSR-002 | MUST | Lifecycle: draft → candidate → field_trial → active → disabled → deprecated |
| REQ-CSR-003 | MUST | RLS: INSERT solo PLANNER/ADMIN, SELECT todo authenticated |
| REQ-CSR-004 | MUST | Seeds: ≥5 fuentes (edge_001, manual_route_001, csv_import, mock_source, portable_01) |
| REQ-CSR-005 | SHOULD | last_seen_at actualizado en cada ingesta exitosa |

### REQ-CSR-001: Tabla condition_sources

El sistema DEBE mantener la tabla `condition_sources` con columnas obligatorias: source_id (PK), source_type, name, status, asset_id (FK nullable), owner, last_seen_at, validation_status, created_by.

#### Scenario: Fuente edge registrada correctamente

- **WHEN**: Se inserta source_id=`edge_001`, source_type=`edge`, name=`Sensor Vibración Banda TR-01`, status=`candidate`, asset_id=`BANDA-TR-01`, owner=`ing-mantenimiento`, created_by=`admin`
- **THEN**: El registro persiste con todas las columnas pobladas y queda disponible para ingesta

#### Scenario: Fuente duplicada rechazada

- **WHEN**: Se intenta insertar source_id ya existente
- **THEN**: El sistema rechaza con error de unicidad

### REQ-CSR-002: Lifecycle de fuente

El sistema DEBE aplicar transiciones válidas según el lifecycle: draft → candidate → field_trial → active → disabled → deprecated.

#### Scenario: Transición válida candidate → field_trial

- **WHEN**: Fuente en estado `candidate` se actualiza a `field_trial`
- **THEN**: La transición es aceptada, last_seen_at se actualiza

#### Scenario: Transición inválida bloqueada

- **WHEN**: Se intenta saltar de `draft` a `active`
- **THEN**: El sistema rechaza con error de restricción CHECK, indicando la transición no permitida

### REQ-CSR-003: Row-Level Security

El sistema DEBE aplicar RLS: INSERT restringido a roles PLANNER/ADMIN, SELECT disponible para todo authenticated.

#### Scenario: Usuario authenticated consulta fuentes

- **WHEN**: Rol `technician` consulta `condition_sources`
- **THEN**: Ve todos los registros visibles según política

#### Scenario: Usuario technician intenta crear fuente

- **WHEN**: Rol `technician` intenta INSERT en `condition_sources`
- **THEN**: La política RLS bloquea con error 403

### REQ-CSR-004: Seeds de fuentes

El sistema DEBE incluir ≥5 fuentes seed en migración inicial.

#### Scenario: Seeds cargados en migración

- **WHEN**: Se ejecuta migración de `condition_sources`
- **THEN**: Existen al menos edge_001, manual_route_001, csv_import, mock_source, portable_01 con status variados

### REQ-CSR-005: Actualización de last_seen_at

El sistema DEBERÍA actualizar last_seen_at en cada ingesta exitosa desde esa fuente.

#### Scenario: Ingesta exitosa actualiza last_seen_at

- **WHEN**: Se completa ingesta desde `edge_001`
- **THEN**: `last_seen_at` de `edge_001` refleja el timestamp de la ingesta
