# Spec: Seguridad y Auditoría de Ingesta

## Purpose

RBAC granular para operaciones de ingesta, auditoría completa de inserciones, y control de acceso a dead-letter.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CISA-001 | MUST | RBAC granular: captura manual (technician+), importar CSV (planner+), confirmar batch (planner+), activar fuente (admin+), reprocesar dead-letter (planner+) |
| REQ-CISA-002 | MUST | Auditoría: cada INSERT en condition_windows/feature_values registra source_id + ingested_by |
| REQ-CISA-003 | MUST | Dead-letter review UI accesible solo a PLANNER/ADMIN |

### REQ-CISA-001: RBAC granular por operación

El sistema DEBE restringir cada operación de ingesta a roles específicos.

| Operación | Rol mínimo |
|-----------|-----------|
| Captura manual | technician |
| Importar CSV | planner |
| Confirmar batch | planner |
| Activar/desactivar fuente | admin |
| Reprocesar dead-letter | planner |
| Ver fuentes | authenticated |

#### Scenario: Technician captura manual permitida

- **WHEN**: Usuario con rol `technician` accede al formulario de captura manual
- **THEN**: Puede crear capturas y enviarlas a ingest-condition

#### Scenario: Technician intenta confirmar batch

- **WHEN**: Usuario `technician` intenta ejecutar confirmación de batch CSV
- **THEN**: Operación bloqueada con error 403

#### Scenario: Admin activa fuente

- **WHEN**: Usuario `admin` promueve fuente de `field_trial` a `active`
- **THEN**: Transición aceptada, fuente ahora puede generar OTs

### REQ-CISA-002: Auditoría de inserciones

El sistema DEBE registrar source_id y ingested_by en cada INSERT a condition_windows y condition_feature_values.

#### Scenario: Ingesta edge registra origen

- **WHEN**: Edge function ingest-condition inserta en condition_windows
- **THEN**: Registro incluye source_id=`edge_001`, ingested_by=`ingest-condition/edge_001`

#### Scenario: Captura manual registra usuario

- **WHEN**: Técnico `tech-02` captura dato manual
- **THEN**: condition_feature_values registra ingested_by=`tech-02`, source_id=`manual_route_001`

### REQ-CISA-003: Dead-letter review UI

El sistema DEBE restringir DeadLetterPanel a roles PLANNER/ADMIN únicamente.

#### Scenario: Planner accede a dead-letter

- **WHEN**: Usuario `planner` abre panel de dead-letter
- **THEN**: Ve lista completa de payloads fallidos con acciones de reprocesar/descartar

#### Scenario: Technician sin acceso a dead-letter

- **WHEN**: Usuario `technician` intenta acceder a DeadLetterPanel
- **THEN**: Panel no se renderiza o muestra mensaje de acceso denegado
