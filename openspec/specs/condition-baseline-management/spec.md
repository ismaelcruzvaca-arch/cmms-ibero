# Spec: Gestión de Líneas Base de Condición

## Purpose

La tabla `condition_baselines` almacena líneas base estadísticas por activo, feature y contexto operativo. Cada baseline representa la "normalidad" aprendida del activo en un régimen específico. El lifecycle es versionado: no se sobreescribe, se crean nuevas versiones.

## Requirements

### REQ-BMAN-001: Esquema de líneas base
**MUST** — La tabla `condition_baselines` debe almacenar: asset_id UUID FK, feature_definition_id UUID FK, method_key VARCHAR FK, measurement_point_id UUID nullable, regime VARCHAR, rpm_band VARCHAR, load_band VARCHAR, mean DOUBLE PRECISION, stddev DOUBLE PRECISION, median DOUBLE PRECISION, mad DOUBLE PRECISION, p95 DOUBLE PRECISION, p99 DOUBLE PRECISION, sample_count INT, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ nullable, baseline_status VARCHAR, baseline_version INT, quality_filter VARCHAR, created_by UUID, approved_by UUID nullable.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| asset_id | UUID FK | Activo objetivo |
| feature_definition_id | UUID FK | Feature medida |
| method_key | VARCHAR FK | Método de análisis |
| measurement_point_id | UUID | Punto de medición (opcional) |
| regime | VARCHAR | Régimen operativo |
| rpm_band | VARCHAR | Banda de RPM |
| load_band | VARCHAR | Banda de carga |
| mean | DOUBLE | Media de la ventana |
| stddev | DOUBLE | Desviación estándar |
| median | DOUBLE | Mediana (robusta) |
| mad | DOUBLE | MAD (robusta) |
| p95 / p99 | DOUBLE | Percentiles |
| sample_count | INT | Ventanas en el cálculo |
| valid_from/valid_to | TIMESTAMPTZ | Vigencia temporal |
| baseline_status | VARCHAR | draft, candidate, active, frozen, needs_review, deprecated |
| baseline_version | INT | Versión secuencial |
| quality_filter | VARCHAR | G0, G1, etc. |
| created_by / approved_by | UUID | Usuarios responsables |

#### Scenario: Baseline creada con estadísticas completas
- **GIVEN** asset_id=`BANDA-TR-01`, feature_key=`vibration.rms`, method_key=`rms_velocity_window`, regime=`FULL_LOAD`, 30 ventanas G0/G1
- **WHEN** compute_baselines() calcula media=2.3, stddev=0.4, p95=3.0, p99=3.4, sample_count=30
- **THEN** Se registra en condition_baselines con baseline_status=`draft`, baseline_version=1

#### Scenario: Baseline versionada — no se sobreescribe
- **GIVEN** baseline activa v1 para (asset, feature, method, regime), se requiere recalcular con nuevos datos
- **WHEN** Se inserta nuevo cálculo
- **THEN** Se crea baseline_version=2; v1 permanece como `frozen` para auditoría

### REQ-BMAN-002: Ciclo de vida del baseline
**MUST** — Los estados deben seguir: draft → candidate → active → frozen, con needs_review como transición desde active/frozen, deprecated como terminal desde cualquier estado.

#### Scenario: Promoción draft → candidate → active
- **GIVEN** baseline en draft con sample_count >= 30
- **WHEN** Se promueve a candidate, luego se aprueba
- **THEN** baseline_status cambia a candidate, luego active; approved_by y valid_from se setean

#### Scenario: Deprecación de baseline obsoleto
- **GIVEN** baseline active v1 reemplazada por v2
- **THEN** v1 pasa a deprecated; no se usa en evaluaciones de reglas

### REQ-BMAN-003: Función compute_baselines()
**MUST** — `compute_baselines(asset_id UUID, feature_definition_id UUID, method_key VARCHAR)` calcula estadísticas rolling window sobre condition_windows con calidad G0/G1, agrupando por (asset, feature, method, regime, rpm_band, load_band).

#### Scenario: Baselines computadas para cada contexto operativo
- **GIVEN** 30 ventanas G0/G1 en FULL_LOAD y 20 en IDLE para mismo asset+feature
- **WHEN** compute_baselines() ejecuta
- **THEN** Retorna 2 baselines: una para FULL_LOAD (n=30), otra para IDLE (n=20)

### REQ-BMAN-004: Aprobación de baselines
**MUST** — Un baseline candidate requiere aprobación (manual o automática) para transicionar a active. Aprobación automática si sample_count >= 30 y quality_filter = 'G0' consistentemente.

#### Scenario: Aprobación automática por criterios
- **GIVEN** baseline candidate con sample_count=45 y 100% ventanas G0
- **WHEN** Sistema evalúa criterios de auto-aprobación
- **THEN** baseline_status → active sin intervención manual

#### Scenario: Baseline no aprueba por muestras insuficientes
- **GIVEN** baseline candidate con sample_count=12
- **WHEN** Sistema evalúa auto-aprobación
- **THEN** Permanece candidate; requiere aprobación manual

### REQ-BMAN-005: Rebaseline post-mantenimiento
**MUST** — Al cerrar una OT de intervención relevante, el baseline activo pasa a needs_review. Tras período de estabilización (default 20 ventanas), se propone nuevo candidate.

#### Scenario: OT cerrada dispara needs_review
- **GIVEN** asset BANDA-TR-01 con baseline active v1, OT de reemplazo de rodamiento se cierra
- **WHEN** Sistema detecta cierre de OT con intervention_type='bearing_replacement'
- **THEN** baseline_status → needs_review; se inicia período de estabilización

#### Scenario: Estabilización completa genera nuevo candidate
- **GIVEN** 20 ventanas G0/G1 post-estabilización recolectadas
- **WHEN** compute_baselines() ejecuta con datos post-mantenimiento
- **THEN** Nuevo baseline candidate creado con baseline_version=2; v1 queda frozen
