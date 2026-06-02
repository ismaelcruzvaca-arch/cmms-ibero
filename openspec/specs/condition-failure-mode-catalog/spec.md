# Spec: Catálogo CBM de Modos de Falla

## Purpose

Catálogo operativo de modos de falla orientado a Condition-Based Maintenance (CBM), separado del FMEA de diseño en RxDB. Cada modo pertenece a una asset_class, con metadata de severidad, detectabilidad y referencias cruzadas a normas ISO 14224.

## Requirements

### FMC-001: Esquema del catálogo de modos de falla

**Priority**: MUST

La tabla `condition_failure_mode_catalog` DEBE almacenar: failure_mode_key (TEXT UNIQUE), asset_class (TEXT), name (TEXT), description (TEXT), failure_mechanism (TEXT), typical_causes (TEXT[]), typical_effects (TEXT[]), severity_default (TEXT CHECK: low/medium/high/critical), detectability (TEXT CHECK: easy/medium/hard), iso14224_taxonomy_ref (TEXT nullable), fmea_ref (TEXT nullable), validation_status (TEXT DEFAULT 'draft').

#### Scenario: Modo de falla de activo registrado

- **GIVEN** asset_class=`centrifugal_pump`
- **WHEN** se inserta failure_mode_key=`pump.cavitation` con severity_default=`critical`, detectability=`medium`
- **THEN** el registro se crea con validation_status=`draft`, listo para revisión

#### Scenario: Modo de falla de sensor registrado

- **GIVEN** asset_class=`sensor`
- **WHEN** se inserta failure_mode_key=`sensor.stuck` con severity_default=`high`
- **THEN** el modo queda disponible para diagnósticos, aunque no corresponde a falla de activo sino a falla de instrumentación

### FMC-002: Modos de falla semilla

**Priority**: MUST

La migración DEBE incluir seed con al menos 10 modos de falla: pump.cavitation, rotating.misalignment, rotating.unbalance, bearing.outer_race, bearing.inner_race, impeller.damage, seal.leakage, electrical.stator_fault, sensor.stuck, sensor.drift.

#### Scenario: Seed cargado post-migración

- **GIVEN** migración ejecutada
- **WHEN** se consulta `condition_failure_mode_catalog`
- **THEN** existen al menos 10 registros con failure_mode_key únicos y validation_status=`seed`

### FMC-003: Modos por clase de activo

**Priority**: MUST

El catálogo DEBE permitir filtrar modos de falla por asset_class para restringir diagnósticos solo a modos aplicables al activo.

#### Scenario: Consulta por asset_class retorna solo modos relevantes

- **GIVEN** centrifugal_pump tiene modos pump.cavitation, seal.leakage, impeller.damage
- **WHEN** se filtra por asset_class=`electric_motor`
- **THEN** solo retorna electrical.stator_fault, bearing.outer_race, bearing.inner_race

### FMC-004: Referencia cruzada a norma ISO 14224

**Priority**: SHOULD

iso14224_taxonomy_ref DEBE contener código según ISO 14224 (ej. `PMP/CP/xx`) cuando el modo tenga equivalente en la norma.

#### Scenario: Modo con referencia ISO 14224

- **GIVEN** pump.cavitation con taxonomy_ref=`PMP/CP/CAV`
- **WHEN** se consulta el registro
- **THEN** la referencia está presente; modos sin equivalente (ej. sensor.drift) DEBEN tener NULL

### FMC-005: Ciclo de validación de modos

**Priority**: MUST

validation_status DEBE soportar: draft, seed, bench_validated, field_validated, superseded.

#### Scenario: Modo promovido a field_validated

- **GIVEN** modo pump.cavitation en estado bench_validated
- **WHEN** se confirma en terreno con evidencia empírica
- **THEN** validation_status cambia a field_validated; el histórico de cambios se preserva en tabla de auditoría
