# Quick Wizard — Specification

## Purpose

Mechanics and supervisors without reliability training can complete an FMEA analysis using simplified categorical ratings and workshop-language RCM questions. All categorical choices map to 1-10 scales internally for RPN computation.

## Requirements

### Requirement: WIZARD-QUICK-01 — Wizard container mounts in AddAssetForm

The wizard MUST render as a collapsible `<Collapse>` section inside `AddAssetForm`, toggled by "¿Realizar análisis FMEA?" switch. When collapsed, no analysis data is collected or sent.

#### Scenario: Collapsed wizard skips analysis
- GIVEN the user is creating a new asset
- WHEN they leave the "¿Realizar análisis FMEA?" switch OFF
- THEN no FMEA data is saved to `fmea_rcm_analysis`
- AND asset creation completes without wizard validation

#### Scenario: Expanding wizard loads component types
- GIVEN the user toggles the switch ON
- WHEN the wizard expands
- THEN it MUST fetch `asset_components` for this asset from RxDB
- AND display a `<Select>` listing each component with its `component_type` name

### Requirement: WIZARD-QUICK-02 — Simplified S/O/D selectors

The system MUST provide three `<Select>` dropdowns for Severity, Occurrence, and Detection using categorical labels that map to numeric ranges internally.

Severity: `BAJO` (1-3), `MEDIO` (4-7), `ALTO` (8-10)
Occurrence: `NUNCA` (1-2), `RARA VEZ` (3-5), `SEGUIDO` (6-8), `SIEMPRE` (9-10)
Detection: `SIEMPRE` (1-2), `A VECES` (3-6), `NO` (7-10)

#### Scenario: All categories selected computes RPN
- GIVEN the user selected Severity=ALTO, Occurrence=SEGUIDO, Detection=A VECES
- WHEN the component and failure mode are also selected
- THEN the system MUST compute RPN = 8 × 6 × 3 = 144 client-side
- AND display the intermediate and final RPN values

#### Scenario: Default states — no selection
- GIVEN the wizard just expanded
- WHEN no S/O/D selector has been changed
- THEN each SHOW a placeholder "Seleccionar..."
- AND RPN shows "—"

### Requirement: WIZARD-QUICK-03 — Workshop-language RCM questions

The five RCM questions MUST use workshop wording:

1. "¿La falla es evidente para el operador?" (Evident failure?)
2. "¿Afecta seguridad o medio ambiente?" (Safety/env impact?)
3. "¿Se puede detectar con inspección sensorial?" (Detectable by senses?)
4. "¿El componente es crítico para producción?" (Critical to production?)
5. "¿Existe una tarea de mantenimiento efectiva?" (Effective maintenance task?)

#### Scenario: All RCM answered triggers strategy
- GIVEN the user answered all 5 questions (Sí/No toggles)
- WHEN the analysis is saved
- THEN the system MUST write to `fmea_rcm_analysis` with q1-q5 values
- AND the DB trigger MUST populate `recommended_strategy` (BCM/PM/RTF/REDESIGN)

#### Scenario: Partial RCM blocks save
- GIVEN the user selected S/O/D values
- WHEN the "Guardar" button is clicked but not all RCM questions have a value
- THEN the system MUST show inline error: "Responda todas las preguntas RCM"
- AND MUST NOT push to RxDB

### Requirement: WIZARD-QUICK-04 — Progress bar updates per component

The system MUST display a progress bar: "FMEA: X% — N de M modos evaluados". M is the count of `failure_mode_catalog` rows for that component's type. N increments when the user completes a full analysis row (S/O/D + RCM + save) for one failure mode.

#### Scenario: Component with 10 failure modes
- GIVEN the asset has a BOMBA component with 10 failure modes
- WHEN the user saves 3 complete analyses
- THEN the bar SHOWs "FMEA: 30% — 3 de 10 modos evaluados"

#### Scenario: Switching components resets progress
- GIVEN the user was analyzing a BOMBA component (3/10 done)
- WHEN they select a MOTOR component in the component selector
- THEN the progress bar resets to reflect the MOTOR's failure mode count
- AND previously saved BOMBA analyses persist in RxDB

### Requirement: WIZARD-QUICK-05 — Save pushes to RxDB

The "Guardar análisis" button MUST upsert into the `fmea_rcm_analysis` RxDB collection with: `component_id`, `failure_mode_id`, `severity` (mapped numeric value), `occurrence`, `detection`, `q1`-`q5`, `analyzed_by` = current user. The computed RPN is sent as a preview; the DB trigger recalculates and confirms.

#### Scenario: Save succeeds with strategy confirmation
- GIVEN the user completed all fields for BEARING-SEAL leakage
- WHEN they click "Guardar análisis"
- THEN the row is upserted to RxDB
- AND post-sync the `recommended_strategy` is read back from the DB trigger
- AND displayed: "Estrategia recomendada: {BCM/PM/RTF/REDESIGN}"

#### Scenario: Unique constraint violation — existing analysis
- GIVEN an analysis for component BEARING-01 + failure mode SEAL-LEAK already exists
- WHEN the user re-selects the same pair and tries to save
- THEN the system MUST update the existing row (upsert by UNIQUE(component_id, failure_mode_id))
- AND show: "Análisis actualizado"
