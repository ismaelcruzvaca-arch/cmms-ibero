# Spec: Política de Aprendizaje de Líneas Base

## Purpose

Define reglas SQL-enforzadas sobre cuándo una ventana de condición puede o NO actualizar la línea base. Protege contra aprender deterioro como normalidad.

## Requirements

### REQ-LPLY-001: Restricciones de actualización del baseline
**MUST** — `compute_baselines()` NO debe incluir ventanas que violen las reglas de aprendizaje. Implementado como filtros en la función o CHECK triggers.

| Regla | Condición | Efecto |
|-------|-----------|--------|
| G2/G3 | quality_flag IN ('G2','G3') | ❌ Excluida |
| Evento activo | asset_id tiene evento condition_events abierto | ❌ Excluida |
| Fuente candidate | source_key con validation_status='candidate' | ❌ Excluida |
| Dato tardío | measured_at > NOW() - INTERVAL '24h' | ❌ Excluida |
| Tendencia activa | R² > 0.5 AND slope ≠ 0 en feature | ❌ Excluida |
| Residual sostenido | Últimas 5 ventanas con z > 2 | ❌ Excluida |

#### Scenario: G2 bloquea actualización
- **GIVEN** Ventana con quality_flag='G2' para asset con baseline active
- **WHEN** compute_baselines() procesa ventana
- **THEN** Ventana excluida del cálculo; baseline no se modifica

#### Scenario: Evento activo bloquea aprendizaje
- **GIVEN** asset BANDA-TR-01 con evento active en condition_events
- **WHEN** compute_baselines() itera ventanas de ese asset
- **THEN** Ninguna ventana del asset se incluye mientras el evento esté abierto

#### Scenario: Tendencia significativa excluye ventanas
- **GIVEN** feature con R²=0.7 y slope=0.03 detectado en últimas 10 ventanas
- **WHEN** compute_baselines() evalúa si incluir nuevas ventanas
- **THEN** Ventanas recientes excluidas; baseline no incorpora deterioro

### REQ-LPLY-002: Condiciones que SÍ permiten actualización
**MUST** — Una ventana SÍ actualiza el baseline si cumple TODAS: quality_flag IN ('G0','G1'), sin evento activo, fuente active/field_trial, sin tendencia significativa, sin residual sostenido.

| Regla | Condición | Efecto |
|-------|-----------|--------|
| G0/G1 | quality_flag='G0' OR 'G1' | ✅ Incluida |
| Régimen nominal | regime conocido en baselines del asset | ✅ Incluida |
| Fuente active | source_key.validation_status='active' | ✅ Incluida |
| EWMA decay | Las ventanas más recientes tienen mayor peso | ✅ Aplicado |

#### Scenario: Ventana G0 en régimen nominal actualiza baseline (EWMA)
- **GIVEN** Ventana G0, FULL_LOAD, fuente active, sin tendencia ni residual sostenido
- **WHEN** compute_baselines() procesa
- **THEN** Ventana incluida con peso EWMA (mayor peso a más reciente)

### REQ-LPLY-003: Rebaseline post-mantenimiento
**MUST** — Al cerrar OT con intervention_type en maintenance_intervention_types, el baseline activo pasa a needs_review. No se aprende hasta completar período de estabilización (default 20 ventanas). Luego se propone nuevo candidate.

#### Scenario: Estabilización bloquea aprendizaje temprano
- **GIVEN** OT cerrada hace 5 ventanas para BANDA-TR-01, período de estabilización=20
- **WHEN** compute_baselines() ejecuta
- **THEN** Ventanas post-mantenimiento NO se incluyen en el baseline anterior; permanece needs_review

#### Scenario: Estabilización completa permite nuevo baseline
- **GIVEN** 25 ventanas post-mantenimiento recolectadas, todas G0/G1
- **WHEN** compute_baselines() ejecuta con flag post_maintenance=True
- **THEN** Nuevo baseline candidate creado con baseline_version=2

### REQ-LPLY-004: Política de calidad para actualización
**MUST** — quality_filter del baseline se define al crearlo: 'G0' si 100% ventanas G0, 'G1' si hay al menos una G1. Un baseline G0 puede aceptar ventanas G1 pero degrada su quality_filter.

#### Scenario: Baseline G0 acepta ventana G1 y degrada a G1
- **GIVEN** Baseline con quality_filter='G0' (100% G0 hasta ahora)
- **WHEN** compute_baselines() incluye una ventana G1
- **THEN** quality_filter del baseline → 'G1'; mean/stddev recalculados
