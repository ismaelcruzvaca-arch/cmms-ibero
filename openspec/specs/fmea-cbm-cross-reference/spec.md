# Spec: Referencia Cruzada FMEA ↔ CBM

## Purpose

Tabla puente que vincula modos de falla del catálogo CBM (`condition_failure_mode_catalog`) con modos de falla del FMEA existente en RxDB. Permite trazabilidad sin migrar el FMEA completo.

## Requirements

### FCX-001: Esquema de referencia cruzada

**Priority**: MUST

La tabla `fmea_cbm_cross_reference` DEBE almacenar: condition_failure_mode_id (FK → condition_failure_mode_catalog), fmea_failure_mode_id (TEXT — ID del modo FMEA en RxDB), relationship_type (TEXT CHECK: same_as, related_to, evidence_for, supersedes, unknown), confidence (NUMERIC 0-1), notes (TEXT nullable), created_at (TIMESTAMPTZ DEFAULT NOW()).

#### Scenario: Referencia cruzada registrada

- **GIVEN** failure_mode_key=`pump.cavitation` existe en catálogo CBM
- **WHEN** se inserta cross-reference con fmea_failure_mode_id=`FMEA-001-CAV`, relationship_type=`same_as`, confidence=0.95
- **THEN** el vínculo queda establecido; el modo CBM y FMEA se consideran equivalentes

#### Scenario: Relación `supersedes` documentada

- **GIVEN** falla CBM refina clasificación previa del FMEA
- **WHEN** relationship_type=`supersedes`, notes detallan por qué el FMEA original queda obsoleto
- **THEN** el cruce registra que el modo CBM reemplaza al modo FMEA

### FCX-002: Seed de referencias

**Priority**: MUST

La migración DEBE incluir al menos 3 cross-references vinculando modos CBM seed con IDs FMEA hipotéticos.

#### Scenario: Seed cargado post-migración

- **GIVEN** migración ejecutada
- **WHEN** se consulta fmea_cbm_cross_reference
- **THEN** existen al menos 3 registros con confidence ≥ 0.7 cada uno

### FCX-003: Consulta de modos FMEA desde CBM

**Priority**: SHOULD

El sistema DEBE exponer una función o vista que retorne los modos FMEA vinculados a un failure_mode_key CBM.

#### Scenario: Cruce consultado por failure_mode_key

- **GIVEN** pump.cavitation tiene 2 referencias FMEA
- **WHEN** se consulta con failure_mode_key=`pump.cavitation`
- **THEN** retorna ambas referencias con fmea_failure_mode_id y relationship_type

#### Scenario: Modo CBM sin referencia FMEA

- **GIVEN** sensor.drift no tiene cross-references
- **WHEN** se consulta
- **THEN** retorna conjunto vacío (no es error — es esperable para modos nuevos)
