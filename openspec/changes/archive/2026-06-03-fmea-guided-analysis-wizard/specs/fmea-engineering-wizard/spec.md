# Engineering Wizard — Specification

## Purpose

Reliability engineers perform a full FMECA analysis. Extends Level 2 with failure cause documentation, mitigation actions, and task frequency. Uses Action Priority (H/M/L) as the primary risk metric.

## Requirements

### Requirement: WIZARD-ENGG-01 — All Expert features included

The Engineering wizard MUST include every feature from the Expert wizard: 1-10 sliders with AIAG/VDA tables, standard RCM questions, notes, RPN display, level switching, and progress bar. These are inherited identically.

#### Scenario: Expert features work identically in Engineering mode
- GIVEN the engineer is in Engineering mode
- WHEN they adjust severity, occurrence, or detection
- THEN RPN updates in real-time (same as Expert mode)
- AND the AIAG/VDA definition tables are accessible via info icon

### Requirement: WIZARD-ENGG-02 — Failure cause documentation

The system MUST provide a `<TextField multiline>` labeled "Causa de falla" for documenting the failure mechanism (root cause, contributing factors). Stored in a new column: `fmea_rcm_analysis.failure_cause` (TEXT, nullable).

#### Scenario: Cause field optional but encouraged
- GIVEN the engineer completed S/O/D and RCM
- WHEN they save without filling failure cause
- THEN the row is saved SUCCESSFULLY with `failure_cause = NULL`
- AND no validation error is raised for this field

#### Scenario: Cause with technical description
- GIVEN the engineer writes "Fatiga por corrosión bajo carga cíclica en álabes del impulsor"
- WHEN they save
- THEN `failure_cause` stores the full text
- AND it is displayed when re-opening the analysis

### Requirement: WIZARD-ENGG-03 — Mitigation actions

The system MUST provide a `<TextField multiline>` labeled "Acciones de mitigación / recomendaciones" for documenting proposed mitigation actions. Stored in `fmea_rcm_analysis.mitigation_actions` (TEXT, nullable).

#### Scenario: Multiple mitigation actions documented
- GIVEN the engineer enters "1. Inspección ultrasonido trimestral. 2. Recubrimiento cerámico."
- WHEN saved
- THEN `mitigation_actions` contains the text
- AND is displayed on re-open

### Requirement: WIZARD-ENGG-04 — Recommended task frequency

The system MUST provide a `<Select>` for task frequency with options: `ÚNICA`, `DIARIA`, `SEMANAL`, `MENSUAL`, `TRIMESTRAL`, `SEMESTRAL`, `ANUAL`, `POR_PARADA`. Stored in `fmea_rcm_analysis.recommended_frequency` (TEXT, nullable).

#### Scenario: Frequency selection
- GIVEN the wizard is in Engineering mode
- WHEN the engineer selects `TRIMESTRAL` from the frequency dropdown
- THEN the value is stored in `recommended_frequency`
- AND shown on re-open

### Requirement: WIZARD-ENGG-05 — Action Priority replaces raw RPN

The system MUST compute and display Action Priority (AP) using the AIAG/VDA matrix instead of raw RPN as the primary risk indicator. AP categories: H (High), M (Medium), L (Low). The raw RPN SHALL still be shown as secondary info.

#### Scenario: High AP displayed
- GIVEN Severity=9, Occurrence=7, Detection=5 (RPN=315)
- WHEN the user completes S/O/D selection
- THEN Action Priority SHOWs "H — Alta"
- AND RPN "315" is shown below in smaller text

#### Scenario: Low AP displayed
- GIVEN Severity=3, Occurrence=2, Detection=2 (RPN=12)
- WHEN the user completes S/O/D
- THEN Action Priority SHOWs "L — Baja"
- AND RPN "12" is shown below in smaller text

#### Scenario: AP color coding
- GIVEN Action Priority is computed
- THEN the AP label MUST be color-coded: H=red, M=yellow/amber, L=green
- AND visible at a glance without reading the text
