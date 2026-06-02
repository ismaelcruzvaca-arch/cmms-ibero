# Spec: Política de Datos Tardíos

## Purpose

Controlar el impacto operativo de datos de condición que llegan con retraso: guardar para histórico y tendencias, pero no disparar eventos ni OTs automáticas.

## Requirements

| ID | Priority | Description |
|----|----------|-------------|
| REQ-CLDP-001 | MUST | `late_event_cutoff_hours` configurable por source_type (default 24h) |
| REQ-CLDP-002 | MUST | Gate: ingested_at − measured_at > cutoff → guardar, no eventos/OTs |
| REQ-CLDP-003 | MUST | CSV histórico: cutoff=0, nunca genera eventos |
| REQ-CLDP-004 | SHOULD | Datos >7d: solo histórico, no recalcular Health Index |

### REQ-CLDP-001: Cutoff configurable por source_type

El sistema DEBE permitir `late_event_cutoff_hours` por source_type con default 24h. Fuentes `candidate` y `csv` DEBEN tener cutoff=0.

#### Scenario: Edge con cutoff default 24h

- **WHEN**: Ingesta desde `edge` con measured_at 20h atrás
- **THEN**: Dato procesado normalmente (dentro del cutoff)

#### Scenario: CSV cutoff=0 — nunca genera eventos

- **WHEN**: Ingesta desde CSV con measured_at de cualquier antigüedad
- **THEN**: Dato guardado para histórico, nunca dispara reglas ni OTs

### REQ-CLDP-002: Gate de datos tardíos

El sistema DEBE evaluar `ingested_at − measured_at > late_event_cutoff_hours`. Si excede, guardar dato pero NO generar eventos automáticos ni OTs.

#### Scenario: Dato con 48h de retraso en edge (cutoff 24h)

- **WHEN**: Ingesta con measured_at=`2026-05-31T10:00Z`, ingested_at=`2026-06-02T10:00Z` (48h diff)
- **THEN**: condition_windows y feature_values persisten con late_data_flag=true. No se disparan reglas ni OTs.

#### Scenario: Dato dentro del cutoff — procesamiento normal

- **WHEN**: measured_at=`2026-06-02T08:00Z`, ingested_at=`2026-06-02T10:00Z` (2h diff)
- **THEN**: Dato procesado normalmente, reglas y eventos evaluados

### REQ-CLDP-003: CSV histórico sin eventos

El sistema DEBE forzar cutoff=0 para source_type `csv`. Datos de CSV siempre son históricos.

#### Scenario: CSV con datos de ayer

- **WHEN**: Batch CSV confirmado con measured_at de hace 24h
- **THEN**: Datos persisten en feature_values, pero late_data_flag=true, sin eventos generados

### REQ-CLDP-004: Datos con más de 7 días

El sistema DEBERÍA tratar datos con >7d de retraso como solo histórico: persistir pero no recalcular Health Index.

#### Scenario: Dato de hace 30 días

- **WHEN**: Ingesta con measured_at de 30 días atrás
- **THEN**: Dato persiste con late_data_flag=true y hi_skip=true. No afecta Health Index actual.
