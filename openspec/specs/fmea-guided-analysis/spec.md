# FMEA Guided Analysis Wizard — Main Spec

## Purpose

Integrate a 3-level FMEA+RCM wizard into the asset creation/editing form. Mechanics, planners, and reliability engineers each get a tailored interface for failure mode analysis, with auto-computed RPN and maintenance strategy. A planner bandeja surfaces orphan failure occurrences and pending analyses. All specs are additive frontend — backend (tables, triggers, RLS) is already implemented in SDD 1.

## Domain Specs

| Domain | Key Feature | Audience |
|--------|-------------|----------|
| Quick Wizard | Categorical S/O/D, workshop language | Mechanic/Supervisor |
| Expert Wizard | 1-10 sliders, AIAG/VDA tables | Planner |
| Engineering Wizard | FMECA, Action Priority, mitigations | Reliability Engineer |
| Planner Bandeja | Orphan occurrences, pending badge | Planner |

## Cross-Cutting Rules

1. **Wizard is OPTIONAL** — collapsible section gated by toggle "¿Realizar análisis FMEA?" in `AddAssetForm`
2. **Level selector** — tabs or radio group at top: Rápido | Experto | Ingeniería
3. **Progress bar** — "FMEA: X% — N de M modos evaluados" visible at all wizard levels
4. **RPN** = Severity × Occurrence × Detection, computed client-side for preview, confirmed by DB trigger post-save
5. **Strategy** — read-only after DB trigger populates `recommended_strategy`
6. **RLS** — TECHNICIAN writes own analyses (analyzed_by = auth.uid()), PLANNER reads/writes all, ADMIN all (enforced server-side via existing backend)
7. **RxDB** — all 4 collections are pull-only (catalogs) or pull+push (analyses). No direct Supabase calls.

---

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

---

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

---

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

---

# Planner Bandeja — Specification

## Purpose

Planners need a single inbox ("bandeja") that surfaces: (1) orphan failure occurrences created during work order execution (SDD 2), (2) FMEA analyses with incomplete or missing strategies, and (3) a workflow to create new failure modes linked to orphan occurrences.

## Requirements

### Requirement: BANDEJA-01 — Pending analyses badge on nav

The system MUST show a badge count on the planner's navigation item indicating how many FMEA analyses have no `recommended_strategy` (i.e., strategy IS NULL in `fmea_rcm_analysis`).

#### Scenario: Badge reflects real count
- GIVEN there are 5 analyses with `recommended_strategy IS NULL`
- WHEN the planner navigates to the bandeja view
- THEN the nav badge displays "5"
- AND the badge is a small red circle with white text

#### Scenario: Zero pending hides badge
- GIVEN all analyses have a non-null recommended_strategy
- WHEN the planner views the nav
- THEN the badge MUST be hidden (not shown as "0")

### Requirement: BANDEJA-02 — Orphan failure occurrences list

The system MUST display a list of orphan failure occurrences from the `failure_occurrences` table (SDD 2) where no linked `fmea_rcm_analysis` exists for that `(asset_component, failure_mode_description)` pair. Each entry SHOWs: equipment_id, component, failure description, date reported, reporter name.

#### Scenario: Orphan list populated
- GIVEN 3 work orders recorded failures for BOMBA-01 (bearing vibration) with no FMEA link
- WHEN the planner opens the bandeja
- THEN the 3 orphan entries are listed
- AND each shows the reported date and mechanic name

#### Scenario: Empty bandeja
- GIVEN every failure occurrence has a linked FMEA analysis
- WHEN the planner opens the bandeja
- THEN the system SHOWs "No hay ocurrencias de falla pendientes de análisis"
- AND a subtle success icon is displayed

### Requirement: BANDEJA-03 — Filter orphans by component type

The system MUST provide a `<Select>` filter to narrow orphan occurrences by `component_types.name`. Options are populated from the seeded ISO 14224 types (BEA, SEA, SHA, etc.).

#### Scenario: Filter narrows list
- GIVEN 10 orphans across 3 component types
- WHEN the planner selects "BEA (Bearings)" from the filter
- THEN only orphans linked to bearing-type components are shown
- AND the count updates accordingly

#### Scenario: Filter with zero matches
- GIVEN no orphans exist for "VAL (Valves)"
- WHEN the planner selects VAL from the filter
- THEN the list SHOWs "No hay ocurrencias para este tipo de componente"
- AND the filter remains selected

### Requirement: BANDEJA-04 — Create failure mode from orphan

The system MUST provide a "Crear modo de falla" action for each selected orphan. This opens a dialog that: (1) auto-selects the component from the orphan, (2) shows existing failure modes for that component type from `failure_mode_catalog`, (3) allows the planner to pick an existing mode or type a new custom description, and (4) links the orphan to the new analysis row.

#### Scenario: Planner creates analysis from orphan
- GIVEN the planner selected orphan #7 (BOMBA-01, "Rodamiento vibra excesivamente")
- WHEN they click "Crear modo de falla"
- THEN a dialog opens with the component pre-selected
- AND the planner can select "BEA-01: Desgaste excesivo" from the catalog
- AND after saving, orphan #7 is linked to the new analysis row
- AND the orphan disappears from the pending list

#### Scenario: Planner types custom failure mode
- GIVEN the planner cannot find a matching failure mode in the catalog
- WHEN they type "Fisura en jaula del rodamiento" in the custom field
- THEN the system creates a new entry in a failure description field on the analysis
- AND links the orphan to this analysis

### Requirement: BANDEJA-05 — Incomplete analyses shown separately

The system MUST show a separate section "Análisis pendientes" listing all `fmea_rcm_analysis` rows with `recommended_strategy IS NULL`, grouped by asset. Each entry SHOWs: asset, component, failure mode, current RPN, last modified date.

#### Scenario: Pending with high RPN highlighted
- GIVEN an analysis has RPN=280 and strategy IS NULL
- WHEN the bandeja loads
- THEN this entry appears in "Análisis pendientes"
- AND the row is highlighted (yellow background) indicating high risk pending review

#### Scenario: Continue draft analysis
- GIVEN the planner clicks a pending analysis row
- WHEN the analysis opens in the wizard (Level 2 pre-selected)
- THEN all previously saved fields are pre-populated
- AND the RCM questions show their saved Yes/No values
