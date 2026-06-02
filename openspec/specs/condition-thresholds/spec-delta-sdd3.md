# Delta SDD 3: Catálogo de Umbrales

## ADDED Requirements

### REQ-CTHR-D3-005: Thresholds desde baselines aprendidos
**MUST** — Los umbrales (zone_a_max, zone_b_max, zone_c_max) pueden provenir de dos orígenes: ISO standard (condition_threshold_catalog existente) o learned baseline (condition_baselines activo). El sistema debe implementar reglas de precedencia: si existe baseline activo con sample_count >= 30, los thresholds del baseline tienen prioridad sobre ISO. Si sample_count < 30, se usa ISO.

| Origen | Tabla | Prioridad | Requisito |
|--------|-------|-----------|-----------|
| ISO standard | condition_threshold_catalog | Baja (default) | Siempre disponible |
| Learned baseline | condition_baselines | Alta | sample_count >= 30, baseline_status='active' |

#### Scenario: Baseline activo con suficientes muestras tiene prioridad
- **GIVEN**: Baseline active para vibration.rms (FULL_LOAD) con mean=2.3, std=0.4, sample_count=45; ISO tiene zone_a_max=2.3
- **WHEN**: Sistema consulta thresholds para evaluación de reglas
- **THEN**: Usa thresholds adaptativos: zone_a_max=2.7 (mean+1σ), zone_b_max=3.1 (mean+2σ), zone_c_max=3.5 (mean+3σ). ISO no se usa porque baseline tiene prioridad

#### Scenario: Baseline con muestras insuficientes usa ISO
- **GIVEN**: Baseline active con sample_count=12
- **WHEN**: Sistema evalúa precedencia
- **THEN**: Usa thresholds ISO (baseline no tiene suficientes muestras para ser estadísticamente representativo)

#### Scenario: Sin baseline active usa ISO siempre
- **GIVEN**: Feature sin baseline active en context
- **WHEN**: Sistema consulta thresholds
- **THEN**: Usa ISO standard de condition_threshold_catalog (comportamiento existente)

### REQ-CTHR-D3-006: Precedencia documentada en metadata
**MUST** — Cada evaluación de threshold debe registrar el origen en metadata del resultado: threshold_source ('iso'|'baseline'), baseline_version (si source=baseline), baseline_sample_count.

#### Scenario: Evaluación con metadata de origen
- **GIVEN**: Threshold desde baseline activo v2, sample_count=45
- **WHEN**: evaluate_condition_rules() usa threshold
- **THEN**: Metadata incluye threshold_source='baseline', baseline_version=2, baseline_sample_count=45

## MODIFIED Requirements

### REQ-CTHR-001: Esquema de catálogo de umbrales (Modificado)
**MUST** — La tabla `condition_threshold_catalog` mantiene su esquema. SE AGREGA que los thresholds ISO ya no son la única fuente. El sistema ahora resuelve thresholds mediante función que aplica precedencia: baseline si active + sample_count >= 30, ISO en caso contrario.
(Previously: solo existía fuente ISO en threshold_catalog)

#### Scenario: Resolución de threshold con precedencia
- **GIVEN**: Feature con baseline active (n=45) e ISO registrado (nunca usado)
- **WHEN**: Función get_applicable_thresholds() ejecuta
- **THEN**: Retorna thresholds desde baseline con metadata source='baseline'
