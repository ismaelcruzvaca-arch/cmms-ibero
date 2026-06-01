# Expert Wizard — Specification

## Purpose

Planners perform FMEA using standard AIAG/VDA 1-10 scales with definition tables visible on demand. All five RCM questions use standard reliability engineering wording. RPN and strategy are auto-computed.

## Requirements

### Requirement: WIZARD-EXPERT-01 — 1-10 severity slider with definition table

The system MUST render a `Slider` (MUI) for Severity (1-10) with labels: 1 (Sin efecto), 4 (Menor), 7 (Mayor), 10 (Catastrófico). An info icon SHALL open a modal or tooltip showing the AIAG/VDA severity criteria table (effect on equipment, effect on plant, effect on safety).

#### Scenario: Slider displays mapped label
- GIVEN the Expert wizard is open
- WHEN the user drags the severity slider to position 4
- THEN the label "Menor (4)" is displayed below the slider
- AND clicking the info icon SHOWs the full severity definition table

#### Scenario: Out-of-range slider behavior
- GIVEN the slider range is 1-10
- WHEN the user tries to type a value outside this range in an optional numeric input
- THEN the system MUST clamp to 1-10 or show validation error

### Requirement: WIZARD-EXPERT-02 — 1-10 occurrence and detection sliders

The system MUST provide identical sliders for Occurrence and Detection, each with their own AIAG/VDA definition tables accessible via icon.

Occurrence: 1 (Improblable: ≤1/1.000.000), 5 (Bajo: 1/10.000), 7 (Moderado: 1/500), 10 (Muy alto: ≥1/2)
Detection: 1 (Casi seguro: controles detectan siempre), 5 (Alto: controles detectan probablemente), 7 (Moderado: controles pueden detectar), 10 (Ninguno: no hay controles)

#### Scenario: RPN calculation with exact values
- GIVEN Severity=7, Occurrence=5, Detection=4
- WHEN all three sliders are set
- THEN RPN = 7 × 5 × 4 = 140 is shown in real-time below the sliders
- AND the formula "S({sev}) × O({occ}) × D({det}) = {rpn}" is displayed

### Requirement: WIZARD-EXPERT-03 — Standard RCM questions

The five RCM questions MUST use standard wording:

1. "Is the failure evident to the operator during normal duties?"
2. "Does the failure have a direct adverse effect on safety or environment?"
3. "Can the failure be detected by sensory inspection (visual, sound, vibration)?"
4. "Is the component critical to production (failure stops the process)?"
5. "Is there an effective maintenance task that prevents or mitigates the failure?"

All questions are binary (Yes/No) toggles, with the same DB mapping (q1-q5 BOOLEAN).

#### Scenario: Mixed Yes/No triggers correct strategy
- GIVEN q1=No, q2=Yes, q3=No, q4=Yes, q5=Yes
- WHEN the analysis is saved
- THEN `fn_determine_rcm_strategy(FALSE,TRUE,FALSE,TRUE,TRUE)` returns the expected strategy
- AND the strategy label SHOWs with context-appropriate color (BCM=blue, PM=green, RTF=yellow, REDESIGN=red)

### Requirement: WIZARD-EXPERT-04 — Free-text notes field

The system MUST provide a `<TextField multiline>` for the planner to add notes about the analysis. Notes are stored in `fmea_rcm_analysis.notes`.

#### Scenario: Notes persist across edits
- GIVEN the planner wrote "Vibration analysis recommended monthly" in notes for a BEARING analysis
- WHEN they re-open the same (component, failure_mode) pair
- THEN the notes field is pre-populated with the saved text

### Requirement: WIZARD-EXPERT-05 — Level selector switches between levels without data loss

The system MUST provide a level selector (tabs or radio group) at the top of the wizard: "Rápido | Experto | Ingeniería". Switching levels MUST preserve any already-filled data in React state; only the rendered input type changes.

#### Scenario: Switch from Expert to Quick and back
- GIVEN the planner filled Severity=7 in Expert mode
- WHEN they switch to Quick mode (which shows categorical BAJO/MEDIO/ALTO)
- AND then switch back to Expert mode
- THEN the severity slider still shows 7
- AND the label reflects the stored value

#### Scenario: Switch from Quick to Expert converts categories
- GIVEN the user selected Severity=ALTO in Quick mode (mapped value 9)
- WHEN they switch to Expert mode
- THEN the severity slider MUST show 9
- AND the slider label shows "Mayor (9)"
