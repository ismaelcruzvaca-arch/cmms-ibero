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
