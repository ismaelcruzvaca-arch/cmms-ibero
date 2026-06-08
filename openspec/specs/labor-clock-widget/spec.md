# Spec: labor-clock-widget

## Requirements

### R1: ClockWidget Component

A `<ClockWidget>` component MUST render inside the WorkOrderDrawer showing:
- When idle (no active session): activity code selector + **"Ingresar"** (clock-in) button
- When active (session running): current activity code badge, elapsed time display, and **"Salir"** (clock-out) button
- The elapsed time MUST update every second while active

#### Scenario: Clock-in with activity code

- GIVEN the mechanic has no active session for this WO
- WHEN the mechanic selects 'DIRECT_WORK' and clicks "Ingresar"
- THEN a new labor_record is inserted with start_time=NOW() and activity_code='DIRECT_WORK'

#### Scenario: Clock-out stops the session

- GIVEN the mechanic has an active session showing elapsed time
- WHEN the mechanic clicks "Salir"
- THEN end_time is set on the active session
- AND the widget returns to idle state

### R2: Activity Code Selector

The component MUST present a dropdown or segmented control with the five valid activity codes, each with a Spanish label:
- `DIRECT_WORK` → "Trabajo Directo"
- `WAIT_MATERIAL` → "Espera de Material"
- `WAIT_PERMIT` → "Espera de Permiso"
- `TRAVEL` → "Viaje"
- `BREAK` → "Pausa"

#### Scenario: All codes displayed

- GIVEN the clock widget is idle
- WHEN the mechanic opens the activity code selector
- THEN all five activity codes SHALL be listed with their Spanish labels

### R3: State Display

When a session is active, the widget MUST display:
- The active activity code as a colored badge
- A live elapsed timer (HH:MM:SS format)
- A "Salir" button

#### Scenario: Live timer during active session

- GIVEN a labor_record with start_time=2026-05-24T10:00:00Z
- WHEN 5 minutes have passed and the widget re-renders
- THEN the timer displays "00:05:00"

### R4: Error Handling

If clock-in or clock-out fails (network error, conflict), the widget MUST show a clear error message and allow retry without losing the selected activity code.

#### Scenario: Clock-in fails with retry

- GIVEN the mechanic selects an activity code and clicks "Ingresar"
- WHEN the insert fails (e.g., network error)
- THEN an error message MUST appear
- AND the activity code selector MUST retain its value
- AND the mechanic MAY retry
