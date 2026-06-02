# Spec: Explicabilidad de Detección de Anomalías

## Purpose

Cada evento de anomalía debe ser explicable: qué feature, qué desviación, contra qué baseline (versión), qué regla disparó, en qué régimen. La información se almacena en condition_events.message (texto estructurado) y condition_event_sources (referencias).

## Requirements

### REQ-DEXP-001: Estructura de explicación en eventos
**MUST** — Cada condition_event generado por detección SDD 3 debe almacenar en message un texto estructurado (JSON) con: feature_key, deviation_type (z_score|innovation|trend|compound), deviation_value, baseline_version (si aplica), rule_name, regime_at_event, approximate_flag, source_window_ids UUID[], and additional_context JSONB.

#### Scenario: Evento de anomalía con explicación completa
- **GIVEN** Regla z_score_threshold dispara para vibration.rms, z=3.5, baseline v2, FULL_LOAD
- **THEN** condition_event.message = {"feature_key":"vibration.rms","deviation_type":"z_score","deviation_value":3.5,"baseline_version":2,"rule_name":"RMS Z>3 Sostenido","regime":"FULL_LOAD","approximate":false,"source_window_ids":["W-123","W-124","W-125"],"additional_context":{"deviation_level":"critical","z_scores":[3.2,3.5,3.1],"duration_windows":3}}

#### Scenario: Evento de innovación guarda estado Kalman
- **GIVEN** Regla innovation_threshold dispara
- **THEN** message.deviation_type='innovation'; deviation_value=0.45 (última innovación); additional_context contiene state_estimate, kalman_gain, innovation_variance

### REQ-DEXP-002: Trazabilidad via condition_event_sources
**MUST** — La tabla condition_event_sources almacena referencias a los condition_analysis_results (residual, kalman_state, trend_slope) que contribuyeron al evento. Cada source registra: condition_event_id, analysis_result_id, contribution_type (primary|contributing|contextual).

#### Scenario: Evento compuesto con múltiples fuentes
- **GIVEN** Regla compound_anomaly (z_score AND trend) dispara
- **WHEN** Se crea event_sources
- **THEN** 2 registros: residual (contribution_type='primary'), trend_slope (contribution_type='contributing')

#### Scenario: Evento simple con una fuente
- **GIVEN** Regla z_score_threshold dispara
- **WHEN** Se crea event_sources
- **THEN** 1 registro: residual (contribution_type='primary')

### REQ-DEXP-003: TrendChart con bandas de baseline
**MUST** — El componente TrendChart (recharts) debe renderizar en la subtab "Tendencias": línea de time-series del feature, bandas de baseline (mean ± 1σ/2σ/3σ como áreas sombreadas), líneas de z-score threshold (z=2, z=3), marcadores de eventos de anomalía. Todo el texto de UI en español.

#### Scenario: TrendChart muestra bandas y evento
- **GIVEN** Feature vibration.rms con baseline (mean=2.3, std=0.4), 30 ventanas time-series, 1 evento en t₀
- **WHEN** TrendChart renderiza
- **THEN** Muestra: línea de valores, banda mean±1σ (verde claro), mean±2σ (amarillo), mean±3σ (rojo), línea threshold z=2 (naranja punteada), línea threshold z=3 (roja punteada), marcador de evento en t₀

#### Scenario: TrendChart para feature sin baseline
- **GIVEN** Feature sin baseline activo
- **WHEN** TrendChart renderiza
- **THEN** Muestra solo línea de time-series sin bandas; nota "Sin línea base disponible"
