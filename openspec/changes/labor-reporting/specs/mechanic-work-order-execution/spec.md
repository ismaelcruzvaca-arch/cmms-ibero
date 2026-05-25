# Delta for mechanic-work-order-execution

## MODIFIED Requirements

### R2: Phase-Guided Actions

The drawer MUST render action buttons based on `getAllowedTransitions(phase)`:
- `APPROVED` → **"Iniciar"** button (transitions to INPRG; auto-creates DIRECT_WORK labor_record)
- `INPRG` → **"Completar"** button (transitions to COMP; auto-closes active labor_record)
- `COMP` → **"Cerrar"** button (transitions to CLOSED; auto-sums labor_records → actual_hours)
- `CLOSED` → No action buttons (read-only)
- `WAPPR` → Not shown (filtered by MechanicDashboard)

Each button MUST show a confirmation dialog before executing:
- "¿Estás seguro de marcar como {Iniciada/Completada/Cerrada} esta orden?"

(Previously: No labor record integration. Actions only transitioned lifecycle phase.)

#### Scenario: Scenario 2 — Mechanic starts an approved work order

- GIVEN the work order is in APPROVED phase
- WHEN the mechanic clicks "Iniciar"
- THEN a confirmation dialog appears
- WHEN confirmed
- THEN lifecycle_phase transitions to INPRG
- AND a labor_record is auto-created with activity_code='DIRECT_WORK', technician_id=auth.uid(), start_time=NOW()
- AND the drawer updates reactively
- AND the notes form now appears
- AND the ClockWidget shows elapsed time

#### Scenario: Mechanic completes with open labor session

- GIVEN the work order is in INPRG phase with an active labor_record
- WHEN the mechanic clicks "Completar" with valid notes
- THEN lifecycle_phase transitions to COMP
- AND the active labor_record end_time is set to NOW()

### R5: Transition Execution with Loading

When the mechanic confirms a transition:
1. The drawer MUST show a loading state (CircularProgress overlay or disabled form)
2. The system calls `updateWorkOrder(id, { lifecycle_phase, symptom_note?, cause_note?, action_note? })`
3. For INPRG→COMP: the system MUST also close the active labor_record by setting end_time=NOW()
4. For APPROVED→INPRG: the system MUST also create an initial labor_record with activity_code='DIRECT_WORK'
5. On success: brief success feedback, then close the drawer
6. On error: show error message, keep drawer open, allow retry
7. The work order list MUST update reactively via RxDB subscription

(Previously: No labor record operations within transitions.)

#### Scenario: Network error during transition with labor record

- GIVEN the mechanic confirms APPROVED→INPRG
- WHEN the labor_record insert succeeds but the work_order update fails
- THEN the drawer shows a clear error message
- AND the mechanic can retry
- AND no partial state is left in the UI (orphan labor_record MUST be rolled back)

## ADDED Requirements

### R7: Clock Widget in Drawer

The Drawer MUST embed the `<ClockWidget>` component between the read-only detail section and the action buttons. The widget MUST receive the current `workOrderId` to scope its labor records.

#### Scenario: Clock widget visible in drawer

- GIVEN the mechanic opens a work order drawer for an INPRG work order
- WHEN the drawer renders
- THEN the ClockWidget MUST appear between the detail section and the action buttons

### R8: COMP Validation with Clock State

Before allowing INPRG→COMP, the system MUST validate that an active labor_record exists (end_time IS NULL) for this technician and work order. If no active session exists, the "Completar" button MUST be disabled with tooltip: "Debés registrar Ingreso antes de Completar."

#### Scenario: COMP blocked without clock-in

- GIVEN the work order is in INPRG phase with NO active labor_record
- WHEN the mechanic views the drawer
- THEN the "Completar" button MUST be disabled
- AND the tooltip explains clock-in is required
