# Spec: Índice de Salud y Velocidad de Degradación

## Requirements

### REQ-CHI-001: Función compute_health_index()
**Priority**: MUST
**Description**: `compute_health_index(asset_id UUID, window_end TIMESTAMPTZ)` debe calcular HI usando mapeo lineal por zonas ISO: zona A=1.0, B=0.7, C=0.2, D=0.0, y promedio ponderado entre features según default_weight de cada feature_definition.

#### Scenario: Feature en zona A contribuye 1.0
- **WHEN**: vibration.rms = 1.5 mm/s, zone_a_max=2.3 (valor debajo del umbral A)
- **THEN**: Contribución al HI = 1.0 (zona A)

#### Scenario: Feature en zona C contribuye 0.2
- **WHEN**: vibration.rms = 5.8 mm/s, zone_b_max=4.5, zone_c_max=7.1 (valor entre B y C)
- **THEN**: Contribución al HI = 0.2 (zona C)

#### Scenario: Feature en zona D contribuye 0.0
- **WHEN**: vibration.rms = 9.0 mm/s, excediendo zone_c_max=7.1
- **THEN**: Contribución al HI = 0.0 (zona D)

#### Scenario: HI promedio ponderado multi-feature
- **WHEN**: Feature A (peso=1.0) contribuye 1.0, Feature B (peso=0.5) contribuye 0.7
- **THEN**: HI = (1.0×1.0 + 0.5×0.7) / (1.0 + 0.5) = 0.90

### REQ-CHI-002: Modificadores de calidad en HI
**Priority**: MUST
**Description**: El HI debe aplicar modificadores multiplicativos por quality_flag: G0=1.0, G1=0.8, G2=0.5, G3=0.0, anulando features con calidad insuficiente.

#### Scenario: Feature G3 no contribuye
- **WHEN**: Feature en zona A (contribución 1.0) con quality_flag=G3
- **THEN**: Contribución efectiva = 1.0 × 0.0 = 0.0 — el feature es ignorado

#### Scenario: Feature G2 con contribución reducida
- **WHEN**: Feature con quality_flag=G2 y contribución base 0.7
- **THEN**: Contribución efectiva = 0.7 × 0.5 = 0.35

#### Scenario: Todos los features G3 — HI indefinido
- **WHEN**: Ningún feature tiene quality_flag ≥ G2 (todos G3)
- **THEN**: compute_health_index() retorna HI=NULL con confidence=0.0 y mensaje de advertencia

### REQ-CHI-003: Función compute_degradation_velocity()
**Priority**: MUST
**Description**: `compute_degradation_velocity(asset_id UUID, window_hours INT DEFAULT 168)` debe calcular dHI/dt mediante regresión lineal sobre ventana rodante de 168h.

#### Scenario: dHI/dt calculado con datos suficientes
- **WHEN**: ≥5 lecturas consecutivas en mismo régimen dentro de 168h con R² ≥ 0.5
- **THEN**: Retorna slope, r_squared, point_count

### REQ-CHI-004: Restricciones de dHI/dt
**Priority**: MUST
**Description**: dHI/dt solo debe calcularse con mínimo 5 puntos consecutivos en mismo régimen y R² ≥ 0.5.

#### Scenario: Datos insuficientes — slope NULL
- **WHEN**: Solo 3 lecturas en el mismo régimen dentro del período
- **THEN**: Retorna slope=NULL, r_squared=NULL, point_count=3 con advertencia

#### Scenario: R² bajo invalida pendiente
- **WHEN**: 8 lecturas producen regresión con R²=0.3
- **THEN**: Retorna slope=NULL — la pendiente no es accionable
