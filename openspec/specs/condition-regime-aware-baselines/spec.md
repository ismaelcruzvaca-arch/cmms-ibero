# Spec: Líneas Base por Régimen Operativo

## Purpose

Cada activo puede tener múltiples baselines según su contexto operativo (régimen + RPM + carga). Esto permite detectar desviaciones específicas del contexto actual, no contra una "normalidad" genérica.

## Requirements

### REQ-RBLN-001: Clave compuesta de contexto
**MUST** — La clave única de un baseline es (asset_id, feature_definition_id, method_key, regime, rpm_band, load_band). Un mismo activo puede tener N baselines, uno por combinación de contexto operativo.

| Componente | Ejemplo | Descripción |
|------------|---------|-------------|
| asset_id | BANDA-TR-01 | Activo monitoreado |
| feature_key | vibration.rms | Feature específico |
| method_key | rms_velocity_window | Método de análisis |
| regime | FULL_LOAD | Régimen operativo |
| rpm_band | 1000-1500 | Rango de RPM |
| load_band | 50-75% | Rango de carga |

#### Scenario: Dos baselines para mismo activo, distinto régimen
- **GIVEN** BANDA-TR-01 con datos en FULL_LOAD y IDLE para vibration.rms
- **WHEN** compute_baselines() ejecuta para ambos contextos
- **THEN** Crea 2 baselines: (FULL_LOAD, 1000-1500, 75-100%) y (IDLE, 0-500, 0-25%) con estadísticas distintas (media 2.3 vs 0.8)

#### Scenario: Misma feature con método distinto son baselines separados
- **GIVEN** vibration.rms calculado con rms_velocity_window y rms_acceleration_window
- **WHEN** compute_baselines() procesa ambos métodos
- **THEN** Crea 2 baselines separados, uno por method_key

### REQ-RBLN-002: Rangos de RPM y carga
**MUST** — rpm_band usa bandas: '0-500','500-1000','1000-1500','1500-2000','2000+'. load_band usa: '0-25%','25-50%','50-75%','75-100%'. Al insertar una ventana, el sistema asigna la banda correspondiente según rpm y load registrados.

#### Scenario: Asignación automática de banda
- **GIVEN** Ventana con rpm=1200, load_pct=60%
- **WHEN** compute_baselines() asigna bandas
- **THEN** rpm_band='1000-1500', load_band='50-75%'

#### Scenario: RPM fuera de rango conocido
- **GIVEN** Ventana con rpm=2500
- **WHEN** compute_baselines() asigna banda
- **THEN** rpm_band='2000+'

### REQ-RBLN-003: Fallback a régimen más cercano
**MUST** — Si no existe baseline para el contexto (regime, rpm_band, load_band) de una ventana, el sistema debe usar el baseline del régimen más cercano disponible por distancia euclidiana normalizada (rpm, load), marcando el resultado como "aproximado".

#### Scenario: Régimen sin baseline usa el más cercano
- **GIVEN** Ventana en PARTIAL_LOAD (800 rpm, 40%) pero solo existe baseline para FULL_LOAD (1200 rpm, 80%) e IDLE (300 rpm, 10%)
- **WHEN** compute_baseline_residual() busca baseline
- **THEN** Usa baseline FULL_LOAD (distancia euclidiana menor); resultado marcado `aproximado=true` en metadata

#### Scenario: Régimen exacto existe — no usar aproximado
- **GIVEN** Ventana en FULL_LOAD, 1100 rpm, 70%
- **WHEN** compute_baseline_residual() busca contexto exacto
- **THEN** Usa baseline FULL_LOAD, 1000-1500, 50-75% sin marca aproximado

### REQ-RBLN-004: Distancia euclidiana normalizada para fallback
**MUST** — La función de proximidad normaliza rpm a [0,1] (0-2000+) y load a [0,1] (0-100%), calcula distancia = sqrt((rpm_norm_diff)² + (load_norm_diff)²). Retorna el baseline con menor distancia.

#### Scenario: Selección correcta del más cercano
- **GIVEN** 3 baselines: A (rpm_norm=0.5, load_norm=0.8), B (rpm_norm=0.1, load_norm=0.1), C (rpm_norm=0.4, load_norm=0.6). Ventana en rpm_norm=0.45, load_norm=0.7
- **WHEN** Función de proximidad calcula distancias
- **THEN** Selecciona baseline A (dist=0.11); B tiene dist=0.67, C tiene dist=0.11 (empate resuelto por régimen nominal primero)
