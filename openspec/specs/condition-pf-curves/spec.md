# Spec: Curvas P-F (Potencial-Funcional)

## Purpose

Catálogo de curvas P-F que definen el intervalo entre la detección de falla potencial (P) y la falla funcional (F) para cada combinación asset_class + failure_mode. Consultadas por el módulo de recomendaciones para calcular ventanas de intervención.

## Requirements

### PFC-001: Esquema de curvas P-F

**Priority**: MUST

La tabla `condition_pf_curves` DEBE almacenar: id (UUID PK), asset_class (TEXT not null), failure_mode_key (FK → condition_failure_mode_catalog), potential_failure_point (TEXT — descripción del punto P), functional_failure_point (TEXT — descripción del punto F), pf_interval_days (INTEGER NOT NULL), inspection_interval_days (INTEGER nullable), intervention_window_days (INTEGER nullable), confidence (NUMERIC 0-1 DEFAULT 0.5), validation_status (TEXT DEFAULT 'draft'), notes (TEXT nullable).

#### Scenario: Curva P-F registrada para rodamiento

- **GIVEN** failure_mode_key=`bearing.outer_race`, asset_class=`centrifugal_pump`
- **WHEN** se inserta con pf_interval_days=30, inspection_interval_days=7, intervention_window_days=14
- **THEN** la curva queda disponible para calcular ventanas de intervención

#### Scenario: Misma falla, distinta clase de activo

- **GIVEN** bearing.outer_race para centrifugal_pump (pf=30d) y para centrifugal_fan (pf=45d)
- **WHEN** se consulta por asset_class
- **THEN** cada clase tiene su propia curva P-F

### PFC-002: Seed de curvas P-F

**Priority**: MUST

La migración DEBE incluir al menos 3 configuraciones seed: bearing.outer_race (30d), rotating.misalignment (60d), pump.cavitation (14d).

#### Scenario: Seed cargado post-migración

- **GIVEN** migración ejecutada
- **WHEN** se consulta condition_pf_curves
- **THEN** existen al menos 3 registros con asset_class y pf_interval_days poblados, todos con validation_status=`seed`

### PFC-003: Consulta de ventana de intervención

**Priority**: SHOULD

El sistema DEBE exponer una función `get_intervention_window(p_asset_class TEXT, p_failure_mode_key TEXT)` que retorne pf_interval_days, inspection_interval_days e intervention_window_days para la combinación.

#### Scenario: Ventana de intervención calculada desde RUL + P-F

- **GIVEN** rul_hours=720 (30d), pf_interval_days=30, inspection_interval_days=7
- **WHEN** se consulta get_intervention_window
- **THEN** intervention_window_days sugiere inspección dentro de 7 días
