# Delta SDD 3: Índice de Salud

## MODIFIED Requirements

### REQ-CHI-001: Función compute_health_index() (Modificado)
**MUST** — `compute_health_index(asset_id UUID, window_end TIMESTAMPTZ)` debe calcular HI usando mapeo por zonas. SE AGREGA que las zonas pueden ser ISO (existente) O adaptativas desde baselines (nuevo). El parámetro `zone_source` en method_config controla el origen: 'iso' (default, comportamiento existente) o 'adaptive'. Si zone_source='adaptive', las zonas se derivan del baseline activo: mean+1σ=zone_a_max, mean+2σ=zone_b_max, mean+3σ=zone_c_max. zone_d_max se determina como max(3σ, ISO fallback).
(Previously: solo soportaba zonas ISO fijas)

| Parámetro | Valores | Default | Efecto |
|-----------|---------|---------|--------|
| zone_source | 'iso' \| 'adaptive' | 'iso' | Origen de zonas A/B/C/D |
| adaptive_sigma | DOUBLE | 3 | Sigma para zone_d_max en modo adaptive |

#### Scenario: HI con zonas adaptativas desde baseline
- **GIVEN**: Baseline active con mean=2.3, std=0.4; zone_source='adaptive', adaptive_sigma=3
- **WHEN**: compute_health_index() calcula para vibration.rms=3.5
- **THEN**: zone_a_max=2.7 (mean+1σ), zone_b_max=3.1 (mean+2σ), zone_c_max=3.5 (mean+3σ). Valor 3.5 en zona C → contribución 0.2

#### Scenario: HI con zonas adaptativas — feature en zona D
- **GIVEN**: Mismo baseline, vibration.rms=4.0 (> mean+3σ=3.5)
- **WHEN**: compute_health_index() evalúa
- **THEN**: zone_d=4.0 → contribución 0.0 (zona D)

#### Scenario: HI sin baseline activo usa ISO fallback
- **GIVEN**: Feature sin baseline active; zone_source='adaptive'
- **WHEN**: compute_health_index() detecta que no hay baseline
- **THEN**: Usa zones ISO de condition_threshold_catalog como fallback; mensaje 'no_baseline_using_iso' en metadata

#### Scenario: HI modo ISO tradicional no afectado
- **GIVEN**: zone_source='iso' (default)
- **WHEN**: compute_health_index() ejecuta
- **THEN**: Comportamiento existente sin cambios (zonas ISO de threshold_catalog)
